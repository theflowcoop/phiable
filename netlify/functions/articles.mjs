// articles.mjs - Serve pre-verified articles (Netlify Functions v2)
// Merges _index_a (cron.mjs) + _index_b (cron2.mjs) + legacy _index
import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const url = new URL(req.url);

  try {
    const store = getStore("articles");

    // Load all three shards in parallel
    const [ra, rb, rl] = await Promise.allSettled([
      store.get("_index_a", { type: "json" }).catch(() => null),
      store.get("_index_b", { type: "json" }).catch(() => null),
      store.get("_index",   { type: "json" }).catch(() => null),
    ]);

    const aa = ra.value?.articles || [];
    const ab = rb.value?.articles || [];
    const al = rl.value?.articles || [];

    // Merge, dedup by id, sort newest first
    const seen = new Set();
    let articles = [...aa, ...ab, ...al].filter(a => {
      if (!a?.id || seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    }).sort((a, b) => (b.verified || 0) - (a.verified || 0));

    const total = articles.length;

    // Filter by category
    const cat = url.searchParams.get("cat");
    if (cat && cat !== "all") articles = articles.filter(a => a.cat === cat);

    // Apply limit — default 5000 to match store cap
    const limit = parseInt(url.searchParams.get("limit")) || 5000;
    articles = articles.slice(0, limit);

    return new Response(JSON.stringify({
      articles, count: articles.length, total, updated: new Date().toISOString()
    }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=30" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = { path: "/api/articles" };
