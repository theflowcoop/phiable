// verify.mjs - Verification endpoint (Netlify Functions v2)
import { getStore } from "@netlify/blobs";

function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return 'v' + Math.abs(h);
}

export default async (req, context) => {
  const url = new URL(req.url);
  const store = getStore("verifications");

  // === GET: Poll for result ===
  if (req.method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return new Response(JSON.stringify({ error: "key required" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });

    try {
      const result = await store.get(key, { type: "json" });
      if (result && result.corridors) {
        return new Response(JSON.stringify({ status: "done", ...result }), {
          headers: { "Content-Type": "application/json" }
        });
      }
    } catch (e) { /* not found */ }

    return new Response(JSON.stringify({ status: "pending" }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // === POST: Check cache or do inline verification ===
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

  // Check cache first
  try {
    const cached = await store.get(key, { type: "json" });
    if (cached && cached.corridors) {
      return new Response(JSON.stringify({ status: "done", key, ...cached, cached: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
  } catch (e) { /* cache miss */ }

  // Do verification inline (background functions need Lambda format, so we verify here)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: "No API key" }), {
    status: 500, headers: { "Content-Type": "application/json" }
  });

  let subject;
  if (text) {
    subject = `the following text:\n\n"${text.slice(0, 3000)}"`;
  } else {
    subject = `"${title}"${source ? ' from ' + source : ''}`;
  }

  const questionLine = question
    ? `\n\nThe person specifically wants to know: ${question}\nFocus your three angles on answering this question.\n`
    : '';

  const prompt = `I need you to verify a claim or news article by searching from 3 completely different angles.

Subject: ${subject}${questionLine}

Search 3 different types of sources about this (e.g. a government record, a different news outlet, an expert or organization, a scientific paper, a public database). For each angle, write one plain sentence about what that source found. Write like you are explaining to a smart friend over coffee. No jargon. No opinions. No adjectives like "alarming" or "shocking" or "notable." Just state what the evidence shows.

Then state in one plain sentence what all three angles together force to be true, even though no single source said it. This must be specific to this exact story. Do not write something generic. Connect it to the actual people, events, and facts involved.

Then state one specific thing that must also be true if that conclusion holds. Something that has not been reported yet but that the pattern of evidence requires. Again, be specific to this story.

Return ONLY valid JSON, no markdown, no backticks:
{"corridors":[{"angle":"2-4 word label","finding":"plain sentence about this specific story"}],"forced_fourth":"plain sentence specific to this story","extension":"plain sentence specific to this story"}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (!response.ok) return new Response(JSON.stringify({ error: data.error?.message || 'API error' }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });

    let txt = '';
    if (data.content) data.content.forEach(b => { if (b.type === 'text') txt += b.text; });

    const clean = txt.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);

    if (match) {
      const result = JSON.parse(match[0]);

      // Cache to blobs
      await store.setJSON(key, result);

      // Also update articles index
      if (title && body.sourceId) {
        const artStore = getStore("articles");
        let index;
        try { index = await artStore.get("_index", { type: "json" }); } catch (e) { index = null; }
        if (!index) index = { articles: [], updated: null };

        const entry = {
          id: key, title,
          source: source || '', sourceId: body.sourceId || '',
          cat: body.cat || '', url: body.url || '', thumb: body.thumb || '',
          corridors: result.corridors,
          forced_fourth: result.forced_fourth,
          extension: result.extension,
          verified: Date.now()
        };

        index.articles = index.articles.filter(a => a.id !== key);
        index.articles.unshift(entry);
        if (index.articles.length > 2000) index.articles = index.articles.slice(0, 2000);
        index.updated = new Date().toISOString();

        await artStore.setJSON("_index", index);
      }

      return new Response(JSON.stringify({ status: "done", key, ...result }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "Could not parse result" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = { path: "/api/verify" };
