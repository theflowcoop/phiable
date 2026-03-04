// articles.mjs - Serve pre-verified articles (ES module)
// GET → returns all verified articles from the index

import { getStore } from "@netlify/blobs";

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'GET only' }) };

  try {
    const store = getStore("articles");
    let index;
    try {
      index = await store.get("_index", { type: "json" });
    } catch (e) { index = null; }

    if (!index || !index.articles || !index.articles.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ articles: [], count: 0 }) };
    }

    const cat = event.queryStringParameters?.cat;
    let articles = index.articles;
    if (cat && cat !== 'all') {
      articles = articles.filter(a => a.cat === cat);
    }

    const limit = parseInt(event.queryStringParameters?.limit) || 200;
    articles = articles.slice(0, limit);

    return { statusCode: 200, headers,
      body: JSON.stringify({ articles, count: articles.length, total: index.articles.length, updated: index.updated }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
