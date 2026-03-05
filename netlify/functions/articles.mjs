// articles.mjs - Serve verified articles
// Only serves articles with os > 0 (real Sonnet verification)
// Old headline-only fake articles (os=0) are filtered out
import { getStore } from "@netlify/blobs";

const VALID_CATS = new Set(['news','science','health','climate','finance','labor','justice','international','tech','consciousness','holometry']);

export default async (req, context) => {
  const url = new URL(req.url);

  try {
    const store = getStore("articles");

    const [ra, rb, rl] = await Promise.allSettled([
      store.get("_index_a", { type: "json" }).catch(() => null),
      store.get("_index_b", { type: "json" }).catch(() => null),
      store.get("_index",   { type: "json" }).catch(() => null),
    ]);

    const aa = ra.value?.articles || [];
    const ab = rb.value?.articles || [];
    const al = rl.value?.articles || [];

    // Merge, dedup, sort newest first
    const seen = new Set();
    let articles = [...aa, ...ab, ...al].filter(a => {
      if (!a?.id || seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    }).sort((a, b) => (b.verified || 0) - (a.verified || 0));

    // Only serve real verified articles with valid tabs
    articles = articles.filter(a => parseFloat(a.os || 0) > 0 && VALID_CATS.has(a.cat));

    const total = articles.length;

    // Filter by category
    const cat = url.searchParams.get("cat");
    if (cat && cat !== "all") articles = articles.filter(a => a.cat === cat);

    // Filter by subcategory
    const subcat = url.searchParams.get("subcat");
    if (subcat) articles = articles.filter(a => a.subcat === subcat);

    // Apply limit
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
