// verify.mjs - Verification endpoint (ES module)
// GET ?key=xxx → check if result is ready (polling)
// POST → check cache, return cached or queue background verification

import { getStore } from "@netlify/blobs";

function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return 'v' + Math.abs(h);
}

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  const store = getStore("verifications");
  const artStore = getStore("articles");

  // === GET: Poll for result ===
  if (event.httpMethod === 'GET') {
    const key = event.queryStringParameters?.key;
    if (!key) return { statusCode: 400, headers, body: JSON.stringify({ error: 'key required' }) };

    try {
      const result = await store.get(key, { type: "json" });
      if (result && result.corridors) {
        return { statusCode: 200, headers, body: JSON.stringify({ status: 'done', ...result }) };
      }
    } catch (e) { /* not found */ }

    return { statusCode: 200, headers, body: JSON.stringify({ status: 'pending' }) };
  }

  // === POST: Check cache or queue background verification ===
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { title, source, text, question } = body;
  if (!title && !text) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Title or text required' }) };

  const key = hashKey((title || text.slice(0, 200)) + '|' + (source || 'manual') + '|' + (question || ''));

  // Check cache first
  try {
    const cached = await store.get(key, { type: "json" });
    if (cached && cached.corridors) {
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'done', key, ...cached, cached: true }) };
    }
  } catch (e) { /* cache miss */ }

  // Queue background verification
  try {
    const bgUrl = new URL(event.rawUrl);
    bgUrl.pathname = '/.netlify/functions/verify-background';
    
    await fetch(bgUrl.origin + bgUrl.pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: event.body
    });
  } catch (e) {
    // Background invocation failed - try to note this
    console.log('[phi] background invoke fail:', e.message);
  }

  // Return immediately with the key for polling
  return { statusCode: 202, headers, body: JSON.stringify({ status: 'queued', key }) };
};
