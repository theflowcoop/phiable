// verify.mjs - Verification endpoint (Netlify Functions v2)
// POST: queues article for verification, returns immediately
// GET:  polls blob store for result
import { getStore } from "@netlify/blobs";

function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return 'v' + Math.abs(h);
}

export default async (req, context) => {
  const url = new URL(req.url);
  const verStore = getStore("verifications");

  // === GET: Poll for result ===
  if (req.method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return new Response(JSON.stringify({ error: "key required" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });

    try {
      const result = await verStore.get(key, { type: "json" });
      if (result && result.corridors) {
        return new Response(JSON.stringify({ status: "done", ...result }), {
          headers: { "Content-Type": "application/json" }
        });
      }
    } catch (e) { /* not found yet */ }

    return new Response(JSON.stringify({ status: "pending" }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // === POST: Check cache, then queue ===
  let body;
  try { body = await req.json(); } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { title, source, text, question } = body;
  if (!title && !text) return new Response(JSON.stringify({ error: "Title or text required" }), {
    status: 400, headers: { "Content-Type": "application/json" }
  });

  const key = hashKey((title || text.slice(0, 200)) + '|' + (source || 'manual') + '|' + (question || ''));

  // Check cache first - return immediately if already verified
  try {
    const cached = await verStore.get(key, { type: "json" });
    if (cached && cached.corridors) {
      return new Response(JSON.stringify({ status: "done", key, ...cached, cached: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
  } catch (e) { /* cache miss */ }

  // Queue for worker - return immediately with queued status
  // Worker runs on schedule and processes the queue
  try {
    const queueStore = getStore("worker_queue");
    const queueItem = {
      key,
      title: title || '',
      source: source || '',
      sourceId: body.sourceId || '',
      url: body.url || '',
      cat: body.cat || '',
      thumb: body.thumb || '',
      text: text ? text.slice(0, 3000) : '',
      question: question || '',
      queuedAt: Date.now()
    };
    await queueStore.setJSON(key, queueItem);
  } catch (e) {
    console.error('[verify] Queue write failed:', e.message);
    // Still return queued — worker will catch it on next run
  }

  return new Response(JSON.stringify({ status: "queued", key }), {
    headers: { "Content-Type": "application/json" }
  });
};

export const config = { path: "/api/verify" };
