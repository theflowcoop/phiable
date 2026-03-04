// cron.mjs - Server-side article verification (Netlify Scheduled Function v2)
// Runs every 2 hours. Fetches all RSS in parallel. Fast verify (no web_search).
// Queues articles for worker.mjs deep verification with web_search.
// Hard timeouts on every async op. Nothing can hang.

import { getStore } from "@netlify/blobs";

const MAX_VERIFY_PER_RUN = 10;
const CLAUDE_TIMEOUT_MS  = 15000;
const BLOB_TIMEOUT_MS    = 5000;
const RSS_TIMEOUT_MS     = 8000;
const ITEMS_PER_SOURCE   = 3;

const SOURCES = {
  // NEWS
  propublica:       { url: 'https://www.propublica.org/feeds/propublica/main', cat: 'news' },
  bellingcat:       { url: 'https://www.bellingcat.com/feed/', cat: 'news' },
  intercept:        { url: 'https://theintercept.com/feed/?rss', cat: 'news' },
  lever:            { url: 'https://www.levernews.com/rss/', cat: 'news' },
  markup:           { url: 'https://themarkup.org/feeds/rss.xml', cat: 'news', cats: ['news','tech'] },
  '404media':       { url: 'https://www.404media.co/rss/', cat: 'news', cats: ['news','tech'] },
  dropsite:         { url: 'https://www.dropsitenews.com/feed', cat: 'news' },
  mpu:              { url: 'https://perfectunion.us/rss/', cat: 'news' },
  steady:           { url: 'https://steady.substack.com/feed', cat: 'news' },
  // NATURE
  outside:          { url: 'https://www.outsideonline.com/feed/', cat: 'nature' },
  trailrunner:      { url: 'https://www.trailrunnermag.com/feed/', cat: 'nature' },
  adventurejournal: { url: 'https://www.adventure-journal.com/feed/', cat: 'nature' },
  northspore:       { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1IFVMqMSbqnMEBBRkVsgOA', cat: 'nature' },
  fungiperfecti:    { url: 'https://fungi.com/blogs/fungi-perfecti.atom', cat: 'nature' },
  fungifoundation:  { url: 'https://www.ffungi.org/blog?format=rss', cat: 'nature' },
  nama:             { url: 'https://namyco.org/feed/', cat: 'nature' },
  mushroomhour:     { url: 'https://mushroomhour.substack.com/feed', cat: 'nature' },
  // SCIENCE
  quanta:           { url: 'https://api.quantamagazine.org/feed/', cat: 'science' },
  veritasium:       { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA', cat: 'science' },
  spacetime:        { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC7_gcs09iThXybpVgjHZ_7g', cat: 'science' },
  sabine:           { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1yNl2E66ZzKApQdRuTQ4tw', cat: 'science' },
  toe:              { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCddiUEpeqJcYeBxX1IVBKvQ', cat: 'science' },
  carroll:          { url: 'https://www.preposterousuniverse.com/podcast/feed/podcast/', cat: 'science' },
  physicsworld:     { url: 'https://physicsworld.com/feed/', cat: 'science' },
  startswithabang:  { url: 'https://bigthink.com/starts-with-a-bang/feed/', cat: 'science' },
  // HEALTH
  statnews:         { url: 'https://www.statnews.com/feed/', cat: 'health' },
  retractionwatch:  { url: 'https://retractionwatch.com/feed/', cat: 'health' },
  // MUSIC
  beato:            { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCJquYOG5EL82sKTfH9aMA9Q', cat: 'music' },
  tetragrammaton:   { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCfk49Grfln4BkQfqlbPMRuQ', cat: 'music' },
  hypebot:          { url: 'https://www.hypebot.com/feed/', cat: 'music' },
  bandcamp:         { url: 'https://daily.bandcamp.com/feed', cat: 'music' },
  digitalmusicnews: { url: 'https://www.digitalmusicnews.com/feed/', cat: 'music' },
  soundonsound:     { url: 'https://www.soundonsound.com/feed/all', cat: 'music' },
  reverb:           { url: 'https://reverb.com/news/feed', cat: 'music' },
  // HOBBIES
  bonsaitonight:    { url: 'https://bonsaitonight.com/feed/', cat: 'hobbies' },
  bonsaiempire:     { url: 'https://www.bonsaiempire.com/feed', cat: 'hobbies' },
  herons:           { url: 'https://www.herons.co.uk/blog/feed/', cat: 'hobbies' },
  crataegus:        { url: 'https://crataegus.com/feed/', cat: 'hobbies' },
  electrek:         { url: 'https://electrek.co/feed/', cat: 'hobbies' },
  surronster:       { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCqBz3SVpb0er5iLIrGNBYcA', cat: 'hobbies' },
  ebr:              { url: 'https://electricbikereview.com/feed/', cat: 'hobbies' },
  micromobility:    { url: 'https://micromobility.io/feed', cat: 'hobbies' },
  surron:           { url: 'https://www.surron.com/blogs/news.atom', cat: 'hobbies' },
  // CONSCIOUSNESS
  doubleblind:      { url: 'https://doubleblindmag.com/feed/', cat: 'consciousness' },
  maps:             { url: 'https://maps.org/feed/', cat: 'consciousness' },
  thirdwave:        { url: 'https://thethirdwave.co/feed/', cat: 'consciousness' },
  chacruna:         { url: 'https://chacruna.net/feed/', cat: 'consciousness' },
  stamets:          { url: 'https://paulstamets.substack.com/feed', cat: 'consciousness' },
  // GAMING
  minecraft:        { url: 'https://www.minecraft.net/en-us/feeds/community-content/rss', cat: 'gaming' },
  xisuma:           { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCU9pX8hKcrx06XfOB-VQLdw', cat: 'gaming' },
  roblox:           { url: 'https://blog.roblox.com/feed/', cat: 'gaming' },
  // FINANCE
  wolfstreet:       { url: 'https://wolfstreet.com/feed/', cat: 'finance' },
  nakedcapitalism:  { url: 'https://www.nakedcapitalism.com/feed', cat: 'finance' },
  calculatedrisk:   { url: 'https://www.calculatedriskblog.com/feeds/posts/default', cat: 'finance' },
  opensecrets:      { url: 'https://www.opensecrets.org/news/feed', cat: 'finance' },
  publicintegrity:  { url: 'https://publicintegrity.org/feed', cat: 'finance' },
  marginalrev:      { url: 'https://marginalrevolution.com/feed', cat: 'finance' },
  labornotesorg:    { url: 'https://labornotes.org/feed', cat: 'finance' },
  epi:              { url: 'https://www.epi.org/feed/', cat: 'finance' },
  inequalityorg:    { url: 'https://inequality.org/feed/', cat: 'finance' },
  mrmoneymustache:  { url: 'https://www.mrmoneymustache.com/feed/', cat: 'finance' },
  financialsamurai: { url: 'https://financialsamurai.com/feed', cat: 'finance' },
  planetmoney:      { url: 'https://feeds.npr.org/510289/podcast.xml', cat: 'finance' },
  freakonomics:     { url: 'https://freakonomics.com/feed/', cat: 'finance' },
  web3goinggreat:   { url: 'https://www.web3isgoinggreat.com/feed.xml', cat: 'finance' },
  gaoreports:       { url: 'https://www.gao.gov/rss/reports.xml', cat: 'finance' },
  // HOLOMETRY
  '3b1b':           { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCYO_jab_esuFRV4b17AJtAw', cat: 'holometry' },
  numberphile:      { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCoxcjq-8xIDTYp3uz647V5A', cat: 'holometry' },
  quantamath:       { url: 'https://api.quantamagazine.org/feed/?tags=mathematics', cat: 'holometry' },
};

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT: ${label} exceeded ${ms}ms`)), ms)
    )
  ]);
}

function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return 'v' + Math.abs(h);
}

async function fetchSource(sourceId, source) {
  const r = await withTimeout(
    fetch(source.url, { headers: { 'User-Agent': 'Phiable/2.0 (phiable.netlify.app)' } }),
    RSS_TIMEOUT_MS, `RSS ${sourceId}`
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function parseItems(xml, sourceId, cat) {
  const items = [];
  const isAtom = xml.includes('<entry>') || xml.includes('<feed');
  const itemTag = isAtom ? 'entry' : 'item';
  const itemRe = new RegExp(`<${itemTag}[^>]*>([\\s\\S]*?)<\\/${itemTag}>`, 'g');
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < ITEMS_PER_SOURCE) {
    const block = m[1];
    const title = (block.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                   block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '';
    const link  = (block.match(/<link[^>]*href="([^"]+)"/) ||
                   block.match(/<link[^>]*>(https?[^<]+)<\/link>/) ||
                   block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
    const thumb = (block.match(/<media:thumbnail[^>]*url="([^"]+)"/) ||
                   block.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/) || [])[1] || '';
    const cleanTitle = title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').trim();
    const cleanLink = link.trim();
    if (cleanTitle && cleanLink) items.push({ title: cleanTitle, url: cleanLink, thumb, sourceId, cat });
  }
  return items;
}

async function fastVerify(article, apiKey) {
  const { title, sourceId } = article;
  const prompt = `Analyze this news article from three independent angles.

Article: "${title}" (source: ${sourceId})

Reason from 3 different perspectives (policy/legal, scientific/technical, economic/social, historical, affected parties). For each angle write one plain sentence. Like explaining to a smart friend. No jargon. No opinions. No loaded adjectives. Just what the evidence shows.

Then one sentence: what all three angles together force to be true. Specific to this story, not generic.

Then one sentence: what must also be true if that conclusion holds. Not yet reported. Required by the pattern.

Return ONLY valid JSON, no markdown:
{"corridors":[{"angle":"2-4 word label","finding":"one plain sentence"}],"forced_fourth":"one plain sentence","extension":"one plain sentence"}`;

  const response = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      })
    }),
    CLAUDE_TIMEOUT_MS, `fastVerify "${title.slice(0,40)}"`
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'API error');
  let txt = '';
  if (data.content) data.content.forEach(b => { if (b.type === 'text') txt += b.text; });
  const match = txt.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse JSON');
  return JSON.parse(match[0]);
}

export default async (req, context) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('[cron] No API key'); return new Response('No API key', { status: 500 }); }

  const verStore = getStore('verifications');
  const artStore = getStore('articles');
  const queueStore = getStore('worker_queue');

  // Load index
  let index;
  try { index = await withTimeout(artStore.get('_index', { type: 'json' }), BLOB_TIMEOUT_MS, 'load index'); }
  catch (e) { console.warn(`[cron] Index load: ${e.message}`); index = null; }
  if (!index) index = { articles: [], updated: null };

  const verifiedIds = new Set(index.articles.map(a => a.id));
  const queuedThisRun = new Set();
  const stats = { fetched: 0, alreadyVerified: 0, verified: 0, queued: 0, failed: 0, skippedSources: 0 };
  const newEntries = [];

  // Fetch all sources in parallel
  console.log(`[cron] Fetching ${Object.keys(SOURCES).length} sources in parallel...`);
  const fetchResults = await Promise.allSettled(
    Object.entries(SOURCES).map(([sourceId, source]) =>
      fetchSource(sourceId, source).then(xml => ({ sourceId, source, xml }))
    )
  );

  // Collect candidates
  const candidates = [];
  for (const result of fetchResults) {
    if (result.status === 'rejected') { stats.skippedSources++; continue; }
    const { sourceId, source, xml } = result.value;
    const items = parseItems(xml, sourceId, source.cat);
    stats.fetched += items.length;
    for (const item of items) {
      const key = hashKey(item.title + '|' + sourceId + '|');
      if (!verifiedIds.has(key) && !queuedThisRun.has(key)) {
        queuedThisRun.add(key);
        candidates.push({ ...item, key });
      } else {
        stats.alreadyVerified++;
      }
    }
  }

  console.log(`[cron] ${candidates.length} candidates, verifying up to ${MAX_VERIFY_PER_RUN}`);

  // Fast verify up to cap, queue rest for worker
  for (let i = 0; i < candidates.length; i++) {
    const article = candidates[i];

    if (i < MAX_VERIFY_PER_RUN) {
      // Fast verify (no web_search)
      try {
        console.log(`[cron] Fast verify: ${article.title.slice(0, 60)}`);
        const result = await fastVerify(article, apiKey);
        await withTimeout(verStore.setJSON(article.key, result), BLOB_TIMEOUT_MS, `blob write ${article.key}`);
        newEntries.push({
          id: article.key, title: article.title,
          source: article.sourceId, sourceId: article.sourceId,
          cat: article.cat, url: article.url, thumb: article.thumb,
          corridors: result.corridors, forced_fourth: result.forced_fourth, extension: result.extension,
          verified: Date.now(), deepVerified: false
        });
        verifiedIds.add(article.key);
        stats.verified++;
      } catch (e) {
        console.warn(`[cron] Failed "${article.title.slice(0,40)}": ${e.message}`);
        stats.failed++;
      }
    } else {
      // Queue for worker deep verification
      try {
        await withTimeout(
          queueStore.setJSON(article.key, { ...article, queuedAt: Date.now() }),
          BLOB_TIMEOUT_MS, `queue ${article.key}`
        );
        stats.queued++;
      } catch (e) { /* non-fatal */ }
    }
  }

  // Save index
  if (newEntries.length > 0) {
    index.articles = [...newEntries, ...index.articles];
    if (index.articles.length > 2000) index.articles = index.articles.slice(0, 2000);
    index.updated = new Date().toISOString();
    try { await withTimeout(artStore.setJSON('_index', index), BLOB_TIMEOUT_MS, 'save index'); }
    catch (e) { console.error(`[cron] Failed to save index: ${e.message}`); }
  }

  const summary = `[cron] Done. sources=${Object.keys(SOURCES).length} skipped=${stats.skippedSources} fetched=${stats.fetched} alreadyVerified=${stats.alreadyVerified} verified=${stats.verified} queued=${stats.queued} failed=${stats.failed}`;
  console.log(summary);
  return new Response(summary, { status: 200 });
};

export const config = { schedule: '*/5 * * * *' };
