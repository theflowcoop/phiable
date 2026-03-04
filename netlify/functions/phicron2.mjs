// ============================================================
// phicron2.mjs — Phiable Article Cron + Fast Verify
// Netlify Scheduled Function. Runs every 10 minutes.
//
// ⚠️  BLOB STORE SAFETY RULES — READ BEFORE EDITING ⚠️
//
// On 2026-03-04 a session replaced this file with a version
// whose index initialization wrote index=[] on any load error.
// The cron ran on a cold start, found the load failed, wrote
// an empty index, and wiped 1600+ articles and ~$100 of
// verification work. This must never happen again.
//
// RULE 1: If index load fails after retries → ABORT THE RUN.
//         Never initialize index=[] unless store is provably new.
//
// RULE 2: Never save an index smaller than what you loaded.
//         If newCount < oldCount → SKIP THE SAVE.
//
// RULE 3: After every successful save, write a dated backup key
//         _index_backup_YYYY-MM-DD so restore.mjs can recover.
//
// RULE 4: The SAFETY GUARD comments below must stay in the code.
//         If you are editing this file and they are missing,
//         add them back before deploying.
//
// RULE 5: Never raise MAX_ARTICLES below 5000 without discussion.
//         The old 2000 cap was silently dropping older articles.
//
// ============================================================

import { getStore } from "@netlify/blobs";

const MAX_VERIFY_PER_RUN = 20;
const CLAUDE_TIMEOUT_MS  = 20000;
const BLOB_TIMEOUT_MS    = 8000;   // raised from 5000 — blob ops need more time
const RSS_TIMEOUT_MS     = 8000;
const ITEMS_PER_SOURCE   = 15;
const MAX_ARTICLES       = 5000;   // raised from 2000 — never silently drop old articles

const SOURCES = {
  // ── NEWS ──
  propublica:       { url: 'https://www.propublica.org/feeds/propublica/main', cat: 'news' },
  ap:               { url: 'https://feeds.apnews.com/rss/apf-topnews', cat: 'news' },
  reuters:          { url: 'https://feeds.reuters.com/reuters/topNews', cat: 'news' },
  bbc:              { url: 'http://feeds.bbci.co.uk/news/rss.xml', cat: 'news' },
  nprnews:          { url: 'https://feeds.npr.org/1001/rss.xml', cat: 'news' },
  guardian:         { url: 'https://www.theguardian.com/world/rss', cat: 'news' },
  aljazeera:        { url: 'https://www.aljazeera.com/xml/rss/all.xml', cat: 'news' },
  bellingcat:       { url: 'https://www.bellingcat.com/feed/', cat: 'news' },
  intercept:        { url: 'https://theintercept.com/feed/?lang=en', cat: 'news' },
  lever:            { url: 'https://www.levernews.com/feed/', cat: 'news' },
  markup:           { url: 'https://themarkup.org/feeds/rss.xml', cat: 'news' },
  fourzerofourmedia: { url: 'https://www.404media.co/rss/', cat: 'news' },
  dropsite:         { url: 'https://www.dropsitenews.com/feed', cat: 'news' },
  mpu:              { url: 'https://perfectunion.us/rss/', cat: 'news' },
  steady:           { url: 'https://steady.substack.com/feed', cat: 'news' },
  vspehar:          { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCuJ2-m4RQSQ9EtHBvQp6eEQ', cat: 'news' },
  matthewcooke:     { url: 'https://matthewcooke.substack.com/feed', cat: 'news' },
  reddit_worldnews: { url: 'https://www.reddit.com/r/worldnews/.rss', cat: 'news' },
  // ── NATURE ──
  natgeo:           { url: 'https://www.nationalgeographic.com/feed/rss', cat: 'nature' },
  audubon:          { url: 'https://www.audubon.org/rss.xml', cat: 'nature' },
  rewilding:        { url: 'https://rewildingeurope.com/feed/', cat: 'nature' },
  iucn:             { url: 'https://www.iucn.org/rss.xml', cat: 'nature' },
  allaboutbirds:    { url: 'https://www.allaboutbirds.org/news/feed/', cat: 'nature' },
  earthobservatory: { url: 'https://earthobservatory.nasa.gov/feeds/earth-observatory.rss', cat: 'nature' },
  treehugger:       { url: 'https://www.treehugger.com/feeds/all', cat: 'nature' },
  mongabay:         { url: 'https://news.mongabay.com/feed/', cat: 'nature' },
  // ── SCIENCE ──
  quanta:           { url: 'https://www.quantamagazine.org/feed/', cat: 'science' },
  veritasium:       { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA', cat: 'science' },
  spacetime:        { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC7_gcs09iThXybpVgjHZ_7g', cat: 'science' },
  sabine:           { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1yNl2E66ZzKApQdRuTQ4tw', cat: 'science' },
  carroll:          { url: 'https://www.preposterousuniverse.com/podcast/feed/', cat: 'science' },
  siegel:           { url: 'https://bigthink.com/feed/', cat: 'science' },
  threeb1b:         { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCYO_jab_esuFRV4b17AJtAg', cat: 'science' },
  sciencedaily:     { url: 'https://www.sciencedaily.com/rss/all.xml', cat: 'science' },
  newscientist:     { url: 'https://www.newscientist.com/feed/home/', cat: 'science' },
  // ── HEALTH ──
  huberman:         { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC2D2CMWXMOVWx7giW1n3LIg', cat: 'health' },
  peterattia:       { url: 'https://peterattiamd.com/feed/', cat: 'health' },
  rhondapatrick:    { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCcnub-5KT-BnUgomJpfHiww', cat: 'health' },
  medscape:         { url: 'https://www.medscape.com/rss/public', cat: 'health' },
  statnews:         { url: 'https://www.statnews.com/feed/', cat: 'health' },
  nih_news:         { url: 'https://www.nih.gov/rss/news.xml', cat: 'health' },
  retraction:       { url: 'https://retractionwatch.com/feed/', cat: 'health' },
  // ── MUSIC ──
  darol_anger:      { url: 'https://darolanger.substack.com/feed', cat: 'music' },
  jessewelles:      { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCpKWFJJFkuJbYfbP9DmHWaA', cat: 'music' },
  beato:            { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCJquYOG5EL82sKTfH9aMA9Q', cat: 'music' },
  allaboutjazz:     { url: 'https://www.allaboutjazz.com/rss/news.rss', cat: 'music' },
  pitchfork:        { url: 'https://pitchfork.com/rss/news/', cat: 'music' },
  bandcamp:         { url: 'https://daily.bandcamp.com/feed/', cat: 'music' },
  folkworks:        { url: 'https://folkworks.org/feed/', cat: 'music' },
  henhouse:         { url: 'https://www.henhousestudios.com/blog/feed/', cat: 'music' },
  // ── COMEDY ──
  theonion:         { url: 'https://www.theonion.com/rss', cat: 'comedy' },
  hardtimes:        { url: 'https://thehardtimes.net/feed/', cat: 'comedy' },
  mcsweeney:        { url: 'https://www.mcsweeneys.net/feed', cat: 'comedy' },
  reductress:       { url: 'https://reductress.com/feed/', cat: 'comedy' },
  chortle:          { url: 'https://www.chortle.co.uk/feed/', cat: 'comedy' },
  elle_cordova:     { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCB3nT7nBwOENBMxJtjO35nA', cat: 'comedy' },
  // ── ART ──
  hyperallergic:    { url: 'https://hyperallergic.com/feed/', cat: 'art' },
  colossal:         { url: 'https://www.thisiscolossal.com/feed/', cat: 'art' },
  designboom:       { url: 'https://www.designboom.com/feed/', cat: 'art' },
  artnews:          { url: 'https://www.artnews.com/feed/', cat: 'art' },
  it_nice_that:     { url: 'https://www.itsnicethat.com/feed', cat: 'art' },
  brainpickings:    { url: 'https://www.themarginalian.org/feed/', cat: 'art' },
  streetartutopia:  { url: 'https://www.streetartutopia.com/feed/', cat: 'art' },
  // ── HOBBIES ──
  atlasobscura:     { url: 'https://www.atlasobscura.com/feeds/latest', cat: 'hobbies' },
  hackaday:         { url: 'https://hackaday.com/feed/', cat: 'hobbies' },
  makezine:         { url: 'https://makezine.com/feed/', cat: 'hobbies' },
  nickofferman:     { url: 'https://nickofferman.substack.com/feed', cat: 'hobbies' },
  seriouseats:      { url: 'https://www.seriouseats.com/feedburner.xml', cat: 'hobbies' },
  // ── OUTDOORS ──
  backpacker:       { url: 'https://www.backpacker.com/feed/', cat: 'outdoors' },
  thetrek:          { url: 'https://thetrek.co/feed/', cat: 'outdoors' },
  rei_blog:         { url: 'https://www.rei.com/blog/feed', cat: 'outdoors' },
  gearjunkie:       { url: 'https://gearjunkie.com/feed', cat: 'outdoors' },
  bearfoottheory:   { url: 'https://www.bearfoottheory.com/feed/', cat: 'outdoors' },
  // ── CONSCIOUSNESS ──
  aeon_psych:       { url: 'https://aeon.co/feed.rss', cat: 'consciousness' },
  nautilus:         { url: 'https://nautil.us/feed/', cat: 'consciousness' },
  qualia_research:  { url: 'https://qualiaresearchinstitute.org/feed', cat: 'consciousness' },
  soulboom:         { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCpLFi_8EMPMfBEZWbQ2FzNg', cat: 'consciousness' },
  jgl:              { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCh0ZCiLyMVs0QiNd-2E0CAg', cat: 'consciousness' },
  garronnoone:      { url: 'https://feeds.acast.com/public/shows/how-are-ye-gettin-on', cat: 'consciousness' },
  chacruna:         { url: 'https://chacruna.net/feed/', cat: 'consciousness' },
  neurosciencenews: { url: 'https://neurosciencenews.com/feed/', cat: 'consciousness' },
  // ── TECH ──
  hackernews:       { url: 'https://hnrss.org/frontpage', cat: 'tech' },
  simonw:           { url: 'https://simonwillison.net/atom/everything/', cat: 'tech' },
  benedictevans:    { url: 'https://www.ben-evans.com/benedictevans/rss.xml', cat: 'tech' },
  wired:            { url: 'https://www.wired.com/feed/rss', cat: 'tech' },
  arstechnica:      { url: 'https://feeds.arstechnica.com/arstechnica/index', cat: 'tech' },
  theregister:      { url: 'https://www.theregister.com/headlines.atom', cat: 'tech' },
  techcrunch:       { url: 'https://techcrunch.com/feed/', cat: 'tech' },
  kottke:           { url: 'https://kottke.org/feed', cat: 'tech' },
  lizdev:           { url: 'https://lizthe.dev/feed', cat: 'tech' },
  // ── FINANCE ──
  wolfstreet:       { url: 'https://wolfstreet.com/feed/', cat: 'finance' },
  planetmoney:      { url: 'https://feeds.npr.org/510289/podcast.xml', cat: 'finance' },
  nakedcapitalism:  { url: 'https://www.nakedcapitalism.com/feed', cat: 'finance' },
  labornotesorg:    { url: 'https://labornotes.org/feed', cat: 'finance' },
  opensecrets:      { url: 'https://www.opensecrets.org/news/feed', cat: 'finance' },
  // ── GAMING ──
  kotaku:           { url: 'https://kotaku.com/rss', cat: 'gaming' },
  polygon:          { url: 'https://www.polygon.com/rss/index.xml', cat: 'gaming' },
  eurogamer:        { url: 'https://www.eurogamer.net/?format=rss', cat: 'gaming' },
  rockpapershotgun: { url: 'https://www.rockpapershotgun.com/feed/', cat: 'gaming' },
  // ── SPORTS ──
  espn:             { url: 'https://www.espn.com/espn/rss/news', cat: 'sports' },
  guardian_sport:   { url: 'https://www.theguardian.com/sport/rss', cat: 'sports' },
  theathletic:      { url: 'https://theathletic.com/feed/', cat: 'sports' },
  deadspin:         { url: 'https://deadspin.com/rss', cat: 'sports' },
  cycling_weekly:   { url: 'https://www.cyclingweekly.com/feed', cat: 'sports' },
  velonews:         { url: 'https://www.velonews.com/feed/', cat: 'sports' },
  ultiworld:        { url: 'https://ultiworld.com/feed/', cat: 'sports' },
  // ── HOLOMETRY ──
  vsauce:           { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC6nSFpj9HTCZ5t-N3Rm3-HA', cat: 'holometry' },
  terrytao:         { url: 'https://terrytao.wordpress.com/feed/', cat: 'holometry' },
  scottaaronson:    { url: 'https://scottaaronson.blog/?feed=rss2', cat: 'holometry' },
  numberphile:      { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCoxcjq-8xIDTYp3uz647V5A', cat: 'holometry' },
  wolfram:          { url: 'https://blog.wolfram.com/feed/', cat: 'holometry' },
  standupmaths:     { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCSju5G2aFaWMqn-_0YBtq5A', cat: 'holometry' },
  johncbaez:        { url: 'https://johncarlosbaez.wordpress.com/feed/', cat: 'holometry' },
  quanta_math:      { url: 'https://www.quantamagazine.org/mathematics/feed/', cat: 'holometry' },
};

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms)
    )
  ]);
}

async function fetchSource(sourceId, source) {
  const r = await withTimeout(
    fetch(source.url, { headers: { 'User-Agent': 'Phiable/1.0 RSS Reader' } }),
    RSS_TIMEOUT_MS, `fetch ${sourceId}`
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function hashKey(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = Math.imul(31, h) + str.charCodeAt(i) | 0; }
  return Math.abs(h).toString(36);
}

function parseItems(xml, sourceId, cat) {
  try {
    const doc = new (require ? require('node-html-parser').parse : DOMParser)(xml, 'text/xml');
    // Use regex for server-side parsing (Netlify functions don't have DOMParser)
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>|<entry>([\s\S]*?)<\/entry>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < ITEMS_PER_SOURCE) {
      const block = match[1] || match[2];
      const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]?.trim();
      const link = (block.match(/<link[^>]*>(?:<!\[CDATA\[)?(https?:\/\/[^\s<\]]+)/) ||
                    block.match(/<link[^>]+href="(https?:\/\/[^"]+)"/) ||
                    block.match(/<guid[^>]*>(https?:\/\/[^\s<]+)/)    ||[])[1]?.trim();
      const pub  = (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/) ||
                    block.match(/<published[^>]*>([\s\S]*?)<\/published>/) || [])[1]?.trim();
      const thumb= (block.match(/url="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/) ||
                    block.match(/<media:thumbnail[^>]+url="([^"]+)"/) ||
                    block.match(/<enclosure[^>]+url="([^"]+\.(?:jpg|jpeg|png|webp))"/) || [])[1];
      if (title && link) {
        items.push({ title: title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"'),
          url: link, sourceId, cat,
          ts: pub ? new Date(pub).getTime() || Date.now() : Date.now(),
          thumb: thumb || null });
      }
    }
    return items;
  } catch(e) { return []; }
}

async function fastVerifyBatch(articles, apiKey) {
  const list = articles.map((a,i) => `${i+1}. "${a.title}" (${a.sourceId})`).join('\n');
  const r = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role:'user', content:
          `For each article, provide fast geometric verification. Return ONLY a JSON array of ${articles.length} objects:\n${list}\n\n` +
          `Each object: {"corridors":[{"angle":"label","finding":"one sentence"}],"forced_fourth":"what 3 angles force","extension":"one forced implication","os":0.0}` +
          `\nos = overall score 0.0-1.0. No markdown.`
        }]
      })
    }),
    CLAUDE_TIMEOUT_MS, 'fast verify batch'
  );
  const data = await r.json();
  let txt = '';
  if (data.content) data.content.forEach(b => { if (b.type === 'text') txt += b.text; });
  const match = txt.replace(/```json|```/g, '').trim().match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Could not parse JSON array');
  const results = JSON.parse(match[0]);
  if (!Array.isArray(results) || results.length !== articles.length) throw new Error('Result count mismatch');
  return results;
}

export default async (req, context) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('[cron] No API key'); return new Response('No API key', { status: 500 }); }

  const verStore = getStore('verifications');
  const artStore = getStore('articles');
  const queueStore = getStore('worker_queue');

  // ── SAFETY GUARD 1: LOAD INDEX WITH RETRIES ──────────────────────────────
  // DO NOT REMOVE OR SIMPLIFY THIS BLOCK.
  // History: 2026-03-04 — a naive `index = []` on load failure wiped the store.
  // This block retries 3 times, then checks if the store has data before
  // deciding it is safe to initialize empty. If store has data but load failed,
  // we ABORT rather than risk overwriting with an empty index.
  // ─────────────────────────────────────────────────────────────────────────
  let index;
  let indexLoadAttempts = 0;
  while (indexLoadAttempts < 3) {
    try {
      index = await withTimeout(artStore.get('_index_a', { type: 'json' }), BLOB_TIMEOUT_MS, 'load index');
      if (index) break;
    } catch (e) {
      indexLoadAttempts++;
      console.warn(`[cron] Index load attempt ${indexLoadAttempts} failed: ${e.message}`);
      if (indexLoadAttempts < 3) await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!index) {
    try {
      const existingKeys = await withTimeout(artStore.list(), BLOB_TIMEOUT_MS, 'list store');
      const hasData = existingKeys && existingKeys.blobs && existingKeys.blobs.length > 0;
      if (hasData) {
        // SAFETY ABORT — store has data but index load failed.
        // Do not initialize empty. Do not overwrite. Just stop.
        console.error('[cron] SAFETY ABORT: index load failed but store has data. Protecting existing articles.');
        return new Response(JSON.stringify({ ok: false, reason: 'safety_abort_index_load_failed' }), { status: 200 });
      }
      // Store is genuinely new — safe to initialize
      console.log('[cron] New store, initializing empty index');
      index = { articles: [], updated: null };
    } catch(e) {
      // Cannot verify store state — abort to be safe
      console.error('[cron] SAFETY ABORT: cannot verify store state:', e.message);
      return new Response(JSON.stringify({ ok: false, reason: 'safety_abort_cannot_verify_store' }), { status: 200 });
    }
  }
  // ── END SAFETY GUARD 1 ────────────────────────────────────────────────────

  const originalCount = index.articles.length;
  const verifiedIds = new Set(index.articles.map(a => a.id));
  const queuedThisRun = new Set();
  const stats = { fetched: 0, alreadyVerified: 0, verified: 0, queued: 0, failed: 0, skippedSources: 0 };
  const newEntries = [];

  // Fetch all sources in parallel
  console.log(`[cron] Fetching ${Object.keys(SOURCES).length} sources...`);
  const fetchResults = await Promise.allSettled(
    Object.entries(SOURCES).map(([sourceId, source]) =>
      fetchSource(sourceId, source).then(xml => ({ sourceId, source, xml }))
    )
  );

  const candidates = [];
  for (const result of fetchResults) {
    if (result.status === 'rejected') { stats.skippedSources++; continue; }
    const { sourceId, source, xml } = result.value;
    const items = parseItems(xml, sourceId, source.cat);
    stats.fetched += items.length;
    for (const item of items) {
      const key = hashKey(item.title + '|' + sourceId);
      if (!verifiedIds.has(key) && !queuedThisRun.has(key)) {
        queuedThisRun.add(key);
        candidates.push({ ...item, key });
      } else {
        stats.alreadyVerified++;
      }
    }
  }

  console.log(`[cron] ${candidates.length} new candidates, verifying up to ${MAX_VERIFY_PER_RUN}`);

  const toVerify = candidates.slice(0, MAX_VERIFY_PER_RUN);
  const toQueue  = candidates.slice(MAX_VERIFY_PER_RUN);

  // Parallel fast verify in batches of 3
  const BATCH_SIZE = 3;
  const batches = [];
  for (let i = 0; i < toVerify.length; i += BATCH_SIZE) batches.push(toVerify.slice(i, i + BATCH_SIZE));

  const batchResults = await Promise.allSettled(
    batches.map(batch => fastVerifyBatch(batch, apiKey).then(results =>
      results.map((result, i) => ({ article: batch[i], result }))
    ))
  );

  const verifyResults = batchResults.flatMap(r =>
    r.status === 'fulfilled' ? r.value.map(v => ({ status: 'fulfilled', value: v })) :
    batches[batchResults.indexOf(r)].map(() => ({ status: 'rejected', reason: r.reason }))
  );

  for (const r of verifyResults) {
    if (r.status === 'fulfilled') {
      const { article, result } = r.value;
      try {
        await withTimeout(verStore.setJSON(article.key, result), BLOB_TIMEOUT_MS, `blob write ${article.key}`);
        newEntries.push({
          id: article.key, ti: article.title, si: article.sourceId, sn: article.sourceId,
          cat: article.cat, url: article.url, thumb: article.thumb || null,
          corridors: result.corridors, forced_fourth: result.forced_fourth,
          extension: result.extension, os: result.os || 0.82,
          verified: Date.now(), deepVerified: false
        });
        verifiedIds.add(article.key);
        stats.verified++;
      } catch (e) {
        console.warn(`[cron] Blob write failed "${article.title.slice(0,40)}": ${e.message}`);
        stats.failed++;
      }
    } else {
      console.warn(`[cron] Verify failed: ${r.reason?.message}`);
      stats.failed++;
    }
  }

  // Queue remainder for worker
  await Promise.allSettled(
    toQueue.map(article =>
      withTimeout(
        queueStore.setJSON(article.key, { ...article, queuedAt: Date.now() }),
        BLOB_TIMEOUT_MS, `queue ${article.key}`
      ).then(() => { stats.queued++; }).catch(() => {})
    )
  );

  // ── SAFETY GUARD 2: SAVE INDEX ────────────────────────────────────────────
  // DO NOT REMOVE THIS BLOCK.
  // History: same 2026-03-04 incident. We also guard on save.
  // Never write an index smaller than what we loaded (originalCount).
  // Always write a dated backup key for restore.mjs to use.
  // ─────────────────────────────────────────────────────────────────────────
  if (newEntries.length > 0) {
    index.articles = [...newEntries, ...index.articles];
    // Cap at MAX_ARTICLES — raise this constant, never lower it
    if (index.articles.length > MAX_ARTICLES) index.articles = index.articles.slice(0, MAX_ARTICLES);
    index.updated = new Date().toISOString();

    const newCount = index.articles.length;
    if (newCount < originalCount) {
      // SAFETY ABORT — would write fewer articles than we started with
      console.error(`[cron] SAFETY ABORT save: would write ${newCount} but had ${originalCount}. Skipping save.`);
    } else {
      try {
        await withTimeout(artStore.setJSON('_index_a', index), BLOB_TIMEOUT_MS, 'save index');
        console.log(`[cron] Saved index: ${newCount} articles (+${newEntries.length} new)`);

        // Write daily backup — restore.mjs reads these keys
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const backupKey = `_index_backup_${today}`;
        try {
          await withTimeout(artStore.setJSON(backupKey, index), BLOB_TIMEOUT_MS, 'backup');
          console.log(`[cron] Backup written: ${backupKey}`);
        } catch(e) {
          // Backup failure is non-fatal — log it but don't abort
          console.warn(`[cron] Backup write failed (non-fatal): ${e.message}`);
        }
      } catch (e) {
        console.error(`[cron] Failed to save index: ${e.message}`);
      }
    }
  }
  // ── END SAFETY GUARD 2 ────────────────────────────────────────────────────

  const summary = `[cron] Done. sources=${Object.keys(SOURCES).length} skipped=${stats.skippedSources} fetched=${stats.fetched} existing=${stats.alreadyVerified} verified=${stats.verified} queued=${stats.queued} failed=${stats.failed} total=${index.articles.length}`;
  console.log(summary);
  return new Response(summary, { status: 200 });
};

export const config = { schedule: '*/10 * * * *' };
