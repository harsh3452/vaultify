// llm_test.js
const { fetch } = require('undici'); // npm i undici
const LM_API_URL = process.env.LM_API_URL || 'http://localhost:1234/v1/chat/completions';
const LM_MODEL_NAME = process.env.LM_MODEL_NAME || 'deepseek/deepseek-r1-0528-qwen3-8b';
const LM_API_KEY = process.env.LM_API_KEY || ''; // optional

async function test() {
  console.log('Testing LM endpoint:', LM_API_URL, ' model:', LM_MODEL_NAME);
  const payload = {
    model: LM_MODEL_NAME,
    messages: [
      { role: 'system', content: 'You are a test. Reply with one word: OK' },
      { role: 'user', content: 'ping' }
    ],
    max_tokens: 10,
    temperature: 0.0
  };

  try {
    const controller = new AbortController();
    const timeoutMs = 15000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(LM_API_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
        ...(LM_API_KEY ? { Authorization: `Bearer ${LM_API_KEY}` } : {})
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    console.log('HTTP status:', res.status, res.statusText);
    const text = await res.text();
    console.log('\nRAW RESPONSE BODY (truncated 4000 chars):\n', text.substring(0, 4000));

    // try to parse and extract assistant text
    try {
      const json = JSON.parse(text);
      const alt =
        (json.choices && json.choices[0] && (json.choices[0].message?.content || json.choices[0].text || json.choices[0].content)) ||
        json.output?.[0]?.content || json.result || json.answer;
      console.log('\nExtracted assistant text (if any):\n', alt);
    } catch (e) {
      console.warn('\nResponse not valid JSON — raw body printed above.');
    }
  } catch (err) {
    console.error('Request failed:', err.message || err);
  }
}

test();
// End of llm_test.js