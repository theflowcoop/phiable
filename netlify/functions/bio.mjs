// bio.mjs - Generate featured contributor bio via Claude API
// POST /api/bio  {name, tab, sourceId}  → {bio}

export default async (req, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: "no api key" }), { status: 500, headers });

  try {
    const { name, tab } = await req.json();
    if (!name) return new Response(JSON.stringify({ error: "name required" }), { status: 400, headers });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "interleaved-thinking-2025-05-14"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content: `Write a 2-3 sentence bio of ${name} for Phiable's ${tab || 'general'} feed.

Phiable follows people who think deeply, speak honestly, and show up for their communities. Base the bio ONLY on what ${name} has actually and publicly demonstrated — specific work, specific stances, specific community they serve. Do not use words like "passionate", "dedicated", "inspiring", or "thought leader". Do not flatter. Write like you are telling a friend why this person is worth following.

Search for real, specific things they have done first. Then write the bio. Return ONLY the bio text — no labels, no quotes, no preamble.`
        }]
      })
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "Claude API error");

    const bio = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();

    if (!bio) throw new Error("no bio generated");

    return new Response(JSON.stringify({ bio }), { status: 200, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
};

export const config = { path: "/api/bio" };
