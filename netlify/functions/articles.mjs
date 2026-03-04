// articles.mjs - Serve pre-verified articles (Netlify Functions v2)
import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const url = new URL(req.url);
  
  try {
    const store = getStore("articles");
    let index;
    try {
      index = await store.get("_index", { type: "json" });
    } catch (e) { index = null; }

    if (!index || !index.articles || !index.articles.length) {
      return new Response(JSON.stringify({ articles: [], count: 0 }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    const cat = url.searchParams.get("cat");
    let articles = index.articles;
    if (cat && cat !== "all") {
      articles = articles.filter(a => a.cat === cat);
    }

    const limit = parseInt(url.searchParams.get("limit")) || 200;
    articles = articles.slice(0, limit);

    return new Response(JSON.stringify({ articles, count: articles.length, total: index.articles.length, updated: index.updated }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = { path: "/api/articles" };
