const test = require('node:test');
const assert = require('node:assert/strict');
const chatbotRouter = require('../routes/chatbot');
const db = require('../db');
const { DEFAULT_HOURS } = require('../utils/clinicSchedule');

const originalFetch = global.fetch;
const originalDbQuery = db.query;
const originalGroqApiKey = process.env.GROQ_API_KEY;
const originalGroqModel = process.env.GROQ_MODEL;

function routeHandler(path, method) {
  const layer = chatbotRouter.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `Expected ${method.toUpperCase()} ${path} route`);
  return layer.route.stack.at(-1).handle;
}

function responseCapture() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function ask(question, scheduleRows = DEFAULT_HOURS) {
  db.query = async (sql) => {
    assert.match(sql, /FROM clinic_operating_hours/);
    assert.doesNotMatch(sql, /clinic_closures|appointments|users|payments|staff/i);
    if (scheduleRows instanceof Error) throw scheduleRows;
    return { rows: scheduleRows };
  };
  const response = responseCapture();
  try {
    await routeHandler('/', 'post')({
      body: { messages: [{ role: 'user', content: question }] },
    }, response);
    return response;
  } finally {
    db.query = originalDbQuery;
  }
}

test('invalid Groq API key falls back to the keyword clinic FAQ', async () => {
  process.env.GROQ_API_KEY = 'invalid-test-key';
  global.fetch = async () => ({ ok: false, status: 401 });

  const response = await ask('Tell me more about Skin Goddess.');

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.fallback, true);
  assert.match(response.body.answer, /skingoddess456@gmail\.com/);
});

test('missing Groq API key still serves a keyword clinic FAQ answer', async () => {
  delete process.env.GROQ_API_KEY;
  global.fetch = async () => {
    throw new Error('Fetch should not run when the key is missing.');
  };

  const response = await ask('Tell me more about Skin Goddess.');

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.fallback, true);
  assert.match(response.body.answer, /services and prices/);
});

test('contact fallback uses the clinic email shown on customer-facing pages', async () => {
  delete process.env.GROQ_API_KEY;
  const response = await ask('What is your contact email?');

  assert.match(response.body.answer, /skingoddess456@gmail\.com/);
  assert.doesNotMatch(response.body.answer, /info@skingoddess\.ph/);
});

test('services and pricing questions use verified information instead of generated answers', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  global.fetch = async () => {
    throw new Error('Verified services and pricing questions must not use generated answers.');
  };

  const response = await ask('What services and prices do you offer?');

  assert.match(response.body.answer, /Services page/);
  assert.doesNotMatch(response.body.answer, /info@skingoddess\.ph/);
});

test('opening-hours answers use the current customer-facing weekly schedule without AI generation', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  global.fetch = async () => {
    throw new Error('Opening-hours questions should use the verified schedule directly.');
  };
  const schedule = DEFAULT_HOURS.map((day) => day.weekday === 2
    ? { ...day, is_open: true, opening_time: '10:30:00', closing_time: '17:15:00' }
    : day.weekday === 4 ? { ...day, is_open: false } : day);

  const response = await ask('What are your opening hours?', schedule);

  assert.match(response.body.answer, /Tuesday: 10:30 AM–5:15 PM/);
  assert.match(response.body.answer, /Thursday: Closed/);
  assert.match(response.body.answer, /Asia\/Manila/);
});

test('AI context includes public hours only, not private schedule or customer fields', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Please check Book Now for current availability.' } }] }),
    };
  };
  const schedule = DEFAULT_HOURS.map((day) => ({
    ...day,
    internal_note: 'PRIVATE NOTE',
    customer_name: 'PRIVATE CUSTOMER',
  }));

  await ask('Tell me more about Skin Goddess.', schedule);

  const systemPrompt = requestBody.messages[0].content;
  assert.match(systemPrompt, /Regular weekly operating hours \(Asia\/Manila\)/);
  assert.match(systemPrompt, /Sunday: 9 AM–6 PM/);
  assert.match(systemPrompt, /2nd floor, KW Plaza Building, Pasong Buaya 2, Imus, Cavite/);
  assert.match(systemPrompt, /\+63 945 611 9436/);
  assert.match(systemPrompt, /skingoddess456@gmail\.com/);
  assert.doesNotMatch(systemPrompt, /info@skingoddess\.ph/);
  assert.match(systemPrompt, /Only provide information intended for customers/);
  assert.doesNotMatch(systemPrompt, /PRIVATE NOTE|PRIVATE CUSTOMER/);
});

test('unavailable schedule is not guessed in the hours fallback', async () => {
  delete process.env.GROQ_API_KEY;
  global.fetch = async () => {
    throw new Error('Fetch should not run when the key is missing.');
  };

  const response = await ask('What are your opening hours?', new Error('Schedule unavailable'));

  assert.match(response.body.answer, /can’t confirm.*weekly hours/i);
  assert.doesNotMatch(response.body.answer, /9 AM|6 PM/);
});

test('Groq network errors fall back to a safe clinic FAQ response', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  global.fetch = async () => {
    throw new Error('Test network failure.');
  };

  const response = await ask('Can you diagnose my skin condition?');

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.fallback, true);
  assert.match(response.body.answer, /can’t provide medical advice/i);
});

test('AI answers containing outdated contact details are replaced with the verified fallback', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  const outdatedDetails = [
    'Contact us at info@skingoddess.ph for more information.',
    'Call +63 900 123 4567 for more information.',
    'The clinic is located in Las Piñas.',
    'The clinic is open Monday to Saturday.',
  ];

  for (const detail of outdatedDetails) {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: detail } }] }),
    });

    const response = await ask('Tell me more about Skin Goddess.');

    assert.equal(response.body.fallback, true);
    assert.match(response.body.answer, /skingoddess456@gmail\.com/);
    assert.doesNotMatch(response.body.answer, /info@skingoddess\.ph|Las Piñas|Monday to Saturday/);
  }
});

test.after(() => {
  global.fetch = originalFetch;
  db.query = originalDbQuery;
  if (originalGroqApiKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqApiKey;
  if (originalGroqModel === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = originalGroqModel;
});
