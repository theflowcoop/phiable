// featured.mjs - GET and POST featured contributors per tab
// GET  /api/featured?tab=science  → returns saved contributor or null
// POST /api/featured              → body: {tab, sourceId, sourceName, imageUrl, bio} → saves to blobs

import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const store = getStore("featured_contributors");

  // GET: load featured contributor for a tab
  if (req.method === "GET") {
    const url = new URL(req.url);
    const tab = url.searchParams.get("tab");
    if (!tab) {
      return new Response(JSON.stringify({ error: "tab required" }), { status: 400, headers });
    }
    try {
      const data = await store.get(tab, { type: "json" });
      return new Response(JSON.stringify(data || null), { status: 200, headers });
    } catch (e) {
      return new Response(JSON.stringify(null), { status: 200, headers });
    }
  }

  // POST: save featured contributor
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const { tab, sourceId, sourceName, cat, imageUrl, bio } = body;
      if (!tab || !sourceId || !bio) {
        return new Response(JSON.stringify({ error: "tab, sourceId, bio required" }), { status: 400, headers });
      }
      const record = { tab, sourceId, sourceName, cat, imageUrl, bio, savedAt: Date.now() };
      await store.setJSON(tab, record);
      return new Response(JSON.stringify({ ok: true, record }), { status: 200, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers });
};

export const config = { path: "/api/featured" };
