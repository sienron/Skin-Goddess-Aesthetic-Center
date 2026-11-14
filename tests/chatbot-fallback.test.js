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

  const response = await ask('Where is the clinic located?');

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.fallback, true);
  assert.match(response.body.answer, /KW Plaza Building/);
});

test('missing Groq API key still serves a keyword clinic FAQ answer', async () => {
  delete process.env.GROQ_API_KEY;
  global.fetch = async () => {
    throw new Error('Fetch should not run when the key is missing.');
  };

  const response = await ask('How can I book an appointment?');

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.fallback, true);
  assert.match(response.body.answer, /Book Now/);
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

  await ask('How do I book an appointment?', schedule);

  const systemPrompt = requestBody.messages[0].content;
  assert.match(systemPrompt, /Regular weekly operating hours \(Asia\/Manila\)/);
  assert.match(systemPrompt, /Sunday: 9 AM–6 PM/);
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

test.after(() => {
  global.fetch = originalFetch;
  db.query = originalDbQuery;
  if (originalGroqApiKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqApiKey;
  if (originalGroqModel === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = originalGroqModel;
});
