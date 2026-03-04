// verify-background.mjs - Background verification (ES module)
// Runs async (up to 15 min), returns 202 immediately
// Does the actual Anthropic API call, writes result to blobs

import { getStore } from "@netlify/blobs";

function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return 'v' + Math.abs(h);
}

export const handler = async (event) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.log('[phi-bg] no API key'); return; }

  let body;
  try { body = JSON.parse(event.body); } catch (e) { console.log('[phi-bg] bad JSON'); return; }

  const { title, source, text, question, url, sourceId, cat, thumb } = body;
  if (!title && !text) { console.log('[phi-bg] no title or text'); return; }

  const key = hashKey((title || text.slice(0, 200)) + '|' + (source || 'manual') + '|' + (question || ''));

  // Double-check cache (another request may have filled it)
  const store = getStore("verifications");
  try {
    const existing = await store.get(key, { type: "json" });
    if (existing && existing.corridors) {
      console.log('[phi-bg] already cached:', key);
      return;
    }
  } catch (e) { /* miss, proceed */ }

  // Build prompt
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
    console.log('[phi-bg] calling API for:', key, title?.slice(0, 60));
    
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
    if (!response.ok) { console.log('[phi-bg] API error:', data.error?.message); return; }

    let txt = '';
    if (data.content) data.content.forEach(b => { if (b.type === 'text') txt += b.text; });

    const clean = txt.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);

    if (match) {
      const result = JSON.parse(match[0]);

      // Write to verification cache
      await store.setJSON(key, result);
      console.log('[phi-bg] cached verification:', key);

      // Write to articles index for new users
      if (title && sourceId) {
        const artStore = getStore("articles");
        let index;
        try {
          index = await artStore.get("_index", { type: "json" });
        } catch (e) { index = null; }
        if (!index) index = { articles: [], updated: null };

        const entry = {
          id: key, title,
          source: source || '', sourceId: sourceId || '',
          cat: cat || '', url: url || '', thumb: thumb || '',
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
        console.log('[phi-bg] indexed article:', title?.slice(0, 60));
      }
    } else {
      console.log('[phi-bg] could not parse result:', txt.slice(0, 200));
    }
  } catch (e) {
    console.log('[phi-bg] error:', e.message);
  }
};
