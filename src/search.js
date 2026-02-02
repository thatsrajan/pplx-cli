import { randomUUID } from 'crypto';
import { createParser } from 'eventsource-parser';
import { BASE_URL, MODEL_MAP } from './constants.js';
import { ChromeBridge } from './chrome-bridge.js';

/**
 * Search Perplexity using the SSE-based main client.
 * Uses Chrome bridge (CDP) to bypass Cloudflare TLS fingerprinting.
 */
export async function* search(query, cookies, opts = {}) {
  const {
    mode = 'auto',
    model,
    sources = ['web'],
    language = 'en-US',
    incognito = false,
    followUp = null,
  } = opts;

  const modeKey = mode === 'deep-research' ? 'deep-research' : mode;
  const modelPref = model
    ? (MODEL_MAP[modeKey]?.[model] ?? model)
    : (MODEL_MAP[modeKey]?.default ?? 'turbo');

  const body = JSON.stringify({
    query_str: query,
    params: {
      attachments: followUp?.attachments ?? [],
      frontend_context_uuid: randomUUID(),
      frontend_uuid: randomUUID(),
      is_incognito: incognito,
      language,
      last_backend_uuid: followUp?.backend_uuid ?? null,
      mode: mode === 'auto' ? 'concise' : 'copilot',
      model_preference: modelPref,
      source: 'default',
      sources,
      version: '2.18',
    },
  });

  const bridge = new ChromeBridge();
  try {
    await bridge.connect();

    const results = [];
    const parser = createParser({
      onEvent(event) {
        if (event.data === '{}') return;
        try {
          const json = JSON.parse(event.data);
          parseNestedText(json);
          results.push(json);
        } catch (e) {
          if (process.env.PPLX_VERBOSE) {
            console.error('SSE parse error:', e.message);
          }
        }
      }
    });

    let gotFinal = false;
    for await (const chunk of bridge.fetchSSE(
      `${BASE_URL}/rest/sse/perplexity_ask`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }
    )) {
      parser.feed(chunk);
      while (results.length > 0) {
        const r = results.shift();
        if (r.final_sse_message) gotFinal = true;
        yield r;
      }
      if (gotFinal) break;
    }

    while (results.length > 0) {
      yield results.shift();
    }
  } finally {
    bridge.close();
  }
}

function parseNestedText(json) {
  if (json.text && typeof json.text === 'string') {
    try {
      const parsed = JSON.parse(json.text);
      if (Array.isArray(parsed)) {
        for (const step of parsed) {
          if (step.step_type === 'FINAL' && step.content?.answer) {
            try {
              const answerData = JSON.parse(step.content.answer);
              json.answer = answerData.answer ?? '';
              json.chunks = answerData.chunks ?? [];
            } catch {}
            break;
          }
        }
      }
      json.text = parsed;
    } catch {}
  }
}
