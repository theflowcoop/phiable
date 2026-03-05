// verify.mjs - Verification endpoint (Netlify Functions v2)
// POST: verifies article immediately using Claude + web_search, caches result
// GET:  polls blob store for result (for slow verifications)
import { getStore } from "@netlify/blobs";

const CLAUDE_TIMEOUT_MS = 55000;

function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return 'v' + Math.abs(h);
}

async function runVerification(title, source, text, question, cat, apiKey) {
  const prompt = `You are Phiable's verification engine. Find three genuinely independent angles on this piece, derive what they FORCE to be true (forced fourth), and what that implies beyond the article (extension).

SOURCE: ${source || 'unknown'}
HEADLINE: ${title || ''}
${text ? 'BODY: ' + text.slice(0, 2000) : ''}
${question ? 'QUESTION: ' + question : ''}

Use web search to find at least 2 independent sources that corroborate, contextualize, or contradict the claims. Sources must be editorially independent.

Return ONLY raw JSON, no markdown:
{"corridors":[{"angle":"label","finding":"precise sentence"},{"angle":"label","finding":"precise sentence"},{"angle":"label","finding":"precise sentence"}],"forced_fourth":"what all three force to be true","extension":"one thing forced to also be true beyond this article","os":0.0}

Scoring: 0.90-1.00 perfect closure, 0.70-0.89 strong, 0.50-0.69 partial, 0.30-0.49 weak, 0.10-0.29 open/essay. Subtract 0.15 if corridors share parent company.`;

  let messages = [{ role: 'user', content: prompt }];

  for (let turn = 0; turn < 10; turn++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
        messages
      })
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);

    let txt = '';
    data.content?.forEach(b => { if (b.type === 'text') txt += b.text; });
    const hasToolUse = data.content?.some(b => b.type === 'tool_use');

    if (!hasToolUse || data.stop_reason === 'end_turn') {
      if (!txt.trim()) throw new Error('Empty response');
      const match = txt.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');
      return JSON.parse(match[0]);
    }

    // Pass actual search results back to Claude
    messages.push({ role: 'assistant', content: data.content });
    const toolResults = data.content
      .filter(b => b.type === 'tool_use')
      .map(b => ({
        type: 'tool_result',
        tool_use_id: b.id,
        content: (b.output ? JSON.stringify(b.output) : 'No results found.')
      }));
    messages.push({ role: 'user', content: toolResults });
  }
  throw new Error('Max turns exceeded');
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
      if (result?.corridors) {
        return new Response(JSON.stringify({ status: "done", ...result }), {
          headers: { "Content-Type": "application/json" }
        });
      }
    } catch (e) { /* not found yet */ }
    return new Response(JSON.stringify({ status: "pending" }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // === POST: Check cache, then verify inline ===
  let body;
  try { body = await req.json(); } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { title, source, text, question, cat } = body;
  if (!title && !text) return new Response(JSON.stringify({ error: "Title or text required" }), {
    status: 400, headers: { "Content-Type": "application/json" }
  });

  const key = hashKey((title || text.slice(0, 200)) + '|' + (source || 'manual') + '|' + (question || ''));

  // Check cache first
  try {
    const cached = await verStore.get(key, { type: "json" });
    if (cached?.corridors) {
      return new Response(JSON.stringify({ status: "done", key, ...cached, cached: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
  } catch (e) { /* cache miss */ }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: "No API key" }), {
    status: 500, headers: { "Content-Type": "application/json" }
  });

  // Verify inline — return immediately with queued, then complete async
  // For Netlify: context.waitUntil keeps function alive after response
  const verifyPromise = runVerification(title, source, text, question, cat, apiKey)
    .then(async result => {
      await verStore.setJSON(key, result);
      console.log(`[verify] Done: ${title?.slice(0,50)}`);
    })
    .catch(e => console.error(`[verify] Failed: ${e.message}`));

  if (context?.waitUntil) {
    context.waitUntil(verifyPromise);
    return new Response(JSON.stringify({ status: "queued", key }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Fallback: wait for result (older Netlify runtime)
  try {
    const result = await Promise.race([
      runVerification(title, source, text, question, cat, apiKey),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), CLAUDE_TIMEOUT_MS))
    ]);
    await verStore.setJSON(key, result);
    return new Response(JSON.stringify({ status: "done", key, ...result }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error(`[verify] inline failed: ${e.message}`);
    return new Response(JSON.stringify({ status: "queued", key }), {
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = { path: "/api/verify" };
