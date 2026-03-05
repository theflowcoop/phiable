// config.mjs — Read and update Phiable source/term config
// GET  /api/config              → returns current _config
// POST /api/config?secret=...   → updates _config
//
// POST body examples:
// Add source:    { "action": "addSource",    "source":   { "id":"x", "name":"X", "url":"https://...", "cat":"news" } }
// Remove source: { "action": "removeSource", "id": "x" }
// Add term:      { "action": "addTerm",      "term": { "term": "quantum gravity", "cat": "holometry" } }
// Remove term:   { "action": "removeTerm",   "term": "quantum gravity" }
// Toggle source: { "action": "toggleSource", "id": "x", "active": false }
// Toggle term:   { "action": "toggleTerm",   "term": "quantum gravity", "active": false }

import { getStore } from "@netlify/blobs";

const SECRET = 'phiable-reset-2026';
const BLOB_TIMEOUT_MS = 8000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms))
  ]);
}

export default async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const store = getStore('articles');

  // GET — return current config
  if (req.method === 'GET') {
    try {
      const config = await withTimeout(store.get('_config', { type: 'json' }), BLOB_TIMEOUT_MS, 'load config');
      if (!config) return new Response(JSON.stringify({ ok: false, error: 'No config found. Phicron will write default on next run.' }), { status: 404, headers });
      return new Response(JSON.stringify({ ok: true, config }), { status: 200, headers });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers });
    }
  }

  // POST — update config
  if (req.method === 'POST') {
    const url = new URL(req.url);
    if (url.searchParams.get('secret') !== SECRET) {
      return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers });
    }

    let body;
    try { body = await req.json(); }
    catch(e) { return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), { status: 400, headers }); }

    let config;
    try {
      config = await withTimeout(store.get('_config', { type: 'json' }), BLOB_TIMEOUT_MS, 'load config');
    } catch(e) { config = null; }
    if (!config) return new Response(JSON.stringify({ ok: false, error: 'No config found. Wait for phicron to run first.' }), { status: 404, headers });

    const { action } = body;

    if (action === 'addSource') {
      const { source } = body;
      if (!source?.id || !source?.url || !source?.cat) return new Response(JSON.stringify({ ok: false, error: 'source needs id, url, cat' }), { status: 400, headers });
      if (config.sources.find(s => s.id === source.id)) return new Response(JSON.stringify({ ok: false, error: 'Source already exists' }), { status: 400, headers });
      config.sources.push({ ...source, active: true });
    }
    else if (action === 'removeSource') {
      config.sources = config.sources.filter(s => s.id !== body.id);
    }
    else if (action === 'toggleSource') {
      const s = config.sources.find(s => s.id === body.id);
      if (s) s.active = body.active ?? !s.active;
    }
    else if (action === 'addTerm') {
      const { term } = body;
      if (!term?.term || !term?.cat) return new Response(JSON.stringify({ ok: false, error: 'term needs term and cat' }), { status: 400, headers });
      if (config.searchTerms.find(t => t.term === term.term)) return new Response(JSON.stringify({ ok: false, error: 'Term already exists' }), { status: 400, headers });
      config.searchTerms.push({ ...term, active: true });
    }
    else if (action === 'removeTerm') {
      config.searchTerms = config.searchTerms.filter(t => t.term !== body.term);
    }
    else if (action === 'toggleTerm') {
      const t = config.searchTerms.find(t => t.term === body.term);
      if (t) t.active = body.active ?? !t.active;
    }
    else {
      return new Response(JSON.stringify({ ok: false, error: `Unknown action: ${action}` }), { status: 400, headers });
    }

    config.updated = new Date().toISOString();

    try {
      await withTimeout(store.setJSON('_config', config), BLOB_TIMEOUT_MS, 'save config');
      return new Response(JSON.stringify({ ok: true, action, sources: config.sources.length, terms: config.searchTerms.length }), { status: 200, headers });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers });
    }
  }

  return new Response('Method not allowed', { status: 405, headers });
};

export const config = { path: '/api/config' };
