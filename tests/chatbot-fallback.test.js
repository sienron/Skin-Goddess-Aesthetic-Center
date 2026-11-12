const test = require('node:test');
const assert = require('node:assert/strict');
const chatbotRouter = require('../routes/chatbot');

const originalFetch = global.fetch;
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

async function ask(question) {
  const response = responseCapture();
  await routeHandler('/', 'post')({
    body: { messages: [{ role: 'user', content: question }] },
  }, response);
  return response;
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
  if (originalGroqApiKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqApiKey;
  if (originalGroqModel === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = originalGroqModel;
});
