// cron.mjs - Server-side article verification (Netlify Scheduled Function v2)
// Runs every 2 hours. Fetches all RSS feeds, finds unverified articles, verifies with Claude.
// No client involvement. Users just read pre-verified content from /api/articles.

import { getStore } from "@netlify/blobs";

// ── Same source list as rss.mjs ──────────────────────────────────────────────
const SOURCES = {
  // NEWS
  propublica:      { url: 'https://www.propublica.org/feeds/propublica/main', cat: 'news' },
  bellingcat:      { url: 'https://www.bellingcat.com/feed/', cat: 'news' },
  intercept:       { url: 'https://theintercept.com/feed/?rss', cat: 'news' },
  lever:           { url: 'https://www.levernews.com/rss/', cat: 'news' },
  markup:          { url: 'https://themarkup.org/feeds/rss.xml', cat: 'news', cats: ['news','tech'] },
  '404media':      { url: 'https://www.404media.co/rss/', cat: 'news', cats: ['news','tech'] },
  dropsite:        { url: 'https://www.dropsitenews.com/feed', cat: 'news' },
  mpu:             { url: 'https://perfectunion.us/rss/', cat: 'news' },
  steady:          { url: 'https://steady.substack.com/feed', cat: 'news' },
  // NATURE
  outside:         { url: 'https://www.outsideonline.com/feed/', cat: 'nature' },
  trailrunner:     { url: 'https://www.trailrunnermag.com/feed/', cat: 'nature' },
  adventurejournal:{ url: 'https://www.adventure-journal.com/feed/', cat: 'nature' },
  northspore:      { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1IFVMqMSbqnMEBBRkVsgOA', cat: 'nature' },
  fungiperfecti:   { url: 'https://fungi.com/blogs/fungi-perfecti.atom', cat: 'nature' },
  fungifoundation: { url: 'https://www.ffungi.org/blog?format=rss', cat: 'nature' },
  nama:            { url: 'https://namyco.org/feed/', cat: 'nature' },
  mushroomhour:    { url: 'https://mushroomhour.substack.com/feed', cat: 'nature' },
  // SCIENCE
  quanta:          { url: 'https://api.quantamagazine.org/feed/', cat: 'science' },
  veritasium:      { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA', cat: 'science' },
  spacetime:       { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC7_gcs09iThXybpVgjHZ_7g', cat: 'science' },
  sabine:          { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1yNl2E66ZzKApQdRuTQ4tw', cat: 'science' },
  toe:             { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCddiUEpeqJcYeBxX1IVBKvQ', cat: 'science' },
  carroll:         { url: 'https://www.preposterousuniverse.com/podcast/feed/podcast/', cat: 'science' },
  physicsworld:    { url: 'https://physicsworld.com/feed/', cat: 'science' },
  startswithabang: { url: 'https://bigthink.com/starts-with-a-bang/feed/', cat: 'science' },
  // HEALTH
  statnews:        { url: 'https://www.statnews.com/feed/', cat: 'health' },
  retractionwatch: { url: 'https://retractionwatch.com/feed/', cat: 'health' },
  // MUSIC
  beato:           { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCJquYOG5EL82sKTfH9aMA9Q', cat: 'music' },
  tetragrammaton:  { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCfk49Grfln4BkQfqlbPMRuQ', cat: 'music' },
  hypebot:         { url: 'https://www.hypebot.com/feed/', cat: 'music' },
  bandcamp:        { url: 'https://daily.bandcamp.com/feed', cat: 'music' },
  digitalmusicnews:{ url: 'https://www.digitalmusicnews.com/feed/', cat: 'music' },
  soundonsound:    { url: 'https://www.soundonsound.com/feed/all', cat: 'music' },
  reverb:          { url: 'https://reverb.com/news/feed', cat: 'music' },
  // HOBBIES
  bonsaitonight:   { url: 'https://bonsaitonight.com/feed/', cat: 'hobbies' },
  bonsaiempire:    { url: 'https://www.bonsaiempire.com/feed', cat: 'hobbies' },
  herons:          { url: 'https://www.herons.co.uk/blog/feed/', cat: 'hobbies' },
  crataegus:       { url: 'https://crataegus.com/feed/', cat: 'hobbies' },
  electrek:        { url: 'https://electrek.co/feed/', cat: 'hobbies' },
  surronster:      { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCqBz3SVpb0er5iLIrGNBYcA', cat: 'hobbies' },
  ebr:             { url: 'https://electricbikereview.com/feed/', cat: 'hobbies' },
  micromobility:   { url: 'https://micromobility.io/feed', cat: 'hobbies' },
  surron:          { url: 'https://www.surron.com/blogs/news.atom', cat: 'hobbies' },
  // CONSCIOUSNESS
  doubleblind:     { url: 'https://doubleblindmag.com/feed/', cat: 'consciousness' },
  maps:            { url: 'https://maps.org/feed/', cat: 'consciousness' },
  thirdwave:       { url: 'https://thethirdwave.co/feed/', cat: 'consciousness' },
  chacruna:        { url: 'https://chacruna.net/feed/', cat: 'consciousness' },
  stamets:         { url: 'https://paulstamets.substack.com/feed', cat: 'consciousness' },
  // GAMING
  minecraft:       { url: 'https://www.minecraft.net/en-us/feeds/community-content/rss', cat: 'gaming' },
  xisuma:          { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCU9pX8hKcrx06XfOB-VQLdw', cat: 'gaming' },
  roblox:          { url: 'https://blog.roblox.com/feed/', cat: 'gaming' },
  // HOLOMETRY
  '3b1b':          { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCYO_jab_esuFRV4b17AJtAw', cat: 'holometry' },
  numberphile:     { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCoxcjq-8xIDTYp3uz647V5A', cat: 'holometry' },
  quantamath:      { url: 'https://api.quantamagazine.org/feed/?tags=mathematics', cat: 'holometry' },
};

// ── Hash function (same as verify.mjs) ──────────────────────────────────────
function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return 'v' + Math.abs(h);
}

// ── Parse RSS/Atom XML, return array of {title, url, thumb} ─────────────────
function parseItems(xml, sourceId, cat) {
  const items = [];

  // Detect Atom vs RSS
  const isAtom = xml.includes('<entry>') || xml.includes('<feed');

  const itemTag = isAtom ? 'entry' : 'item';
  const itemRe = new RegExp(`<${itemTag}[^>]*>([\\s\\S]*?)<\\/${itemTag}>`, 'g');
  let m;

  while ((m = itemRe.exec(xml)) !== null && items.length < 5) {
    const block = m[1];

    const title = (block.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                   block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '';

    const link  = (block.match(/<link[^>]*href="([^"]+)"/) ||
                   block.match(/<link[^>]*>(https?[^<]+)<\/link>/) ||
                   block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';

    const thumb = (block.match(/<media:thumbnail[^>]*url="([^"]+)"/) ||
                   block.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/) ||
                   block.match(/<img[^>]*src="([^"]+)"/) || [])[1] || '';

    const cleanTitle = title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').trim();
    const cleanLink  = link.trim();

    if (cleanTitle && cleanLink) {
      items.push({ title: cleanTitle, url: cleanLink, thumb, sourceId, cat });
    }
  }

  return items;
}

// ── Verify one article with Claude + web_search ──────────────────────────────
async function verifyArticle(article, apiKey) {
  const { title, url, sourceId } = article;

  const prompt = `I need you to verify a claim or news article by searching from 3 completely different angles.

Subject: "${title}" from ${sourceId}

Search 3 different types of sources about this (e.g. a government record, a different news outlet, an expert or organization, a scientific paper, a public database). For each angle, write one plain sentence about what that source found. Write like you are explaining to a smart friend over coffee. No jargon. No opinions. No adjectives like "alarming" or "shocking" or "notable." Just state what the evidence shows.

Then state in one plain sentence what all three angles together force to be true, even though no single source said it. This must be specific to this exact story. Do not write something generic. Connect it to the actual people, events, and facts involved.

Then state one specific thing that must also be true if that conclusion holds. Something that has not been reported yet but that the pattern of evidence requires. Again, be specific to this story.

Return ONLY valid JSON, no markdown, no backticks:
{"corridors":[{"angle":"2-4 word label","finding":"plain sentence about this specific story"}],"forced_fourth":"plain sentence specific to this story","extension":"plain sentence specific to this story"}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'API error');

  let txt = '';
  if (data.content) data.content.forEach(b => { if (b.type === 'text') txt += b.text; });

  const clean = txt.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse JSON from Claude response');

  return JSON.parse(match[0]);
}

// ── Main cron handler ────────────────────────────────────────────────────────
export default async (req, context) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[cron] No ANTHROPIC_API_KEY set');
    return new Response('No API key', { status: 500 });
  }

  const verStore = getStore('verifications');
  const artStore = getStore('articles');

  // Load existing article index
  let index;
  try { index = await artStore.get('_index', { type: 'json' }); } catch (e) { index = null; }
  if (!index) index = { articles: [], updated: null };

  // Build set of already-verified article IDs for fast lookup
  const verifiedIds = new Set(index.articles.map(a => a.id));

  const MAX_VERIFICATIONS_PER_RUN = 10;
const stats = { fetched: 0, alreadyVerified: 0, verified: 0, failed: 0, skipped: 0 };
  const newEntries = [];

  // Process each source
  for (const [sourceId, source] of Object.entries(SOURCES)) {
    let xml;
    try {
      const r = await fetch(source.url, {
        headers: { 'User-Agent': 'Phiable/2.0 (news verification; phiable.netlify.app)' },
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) { stats.skipped++; continue; }
      xml = await r.text();
    } catch (e) {
      console.warn(`[cron] Failed to fetch ${sourceId}: ${e.message}`);
      stats.skipped++;
      continue;
    }

    const items = parseItems(xml, sourceId, source.cat);
    stats.fetched += items.length;

    for (const article of items) {
      const key = hashKey(article.title + '|' + sourceId + '|');

      // Skip if already verified
      if (verifiedIds.has(key)) {
        stats.alreadyVerified++;
        continue;
      }

      // Stop if we've hit the per-run cap
      if (stats.verified >= MAX_VERIFICATIONS_PER_RUN) break;

      // Verify with Claude
      try {
        console.log(`[cron] Verifying: ${article.title.slice(0, 60)}...`);
        const result = await verifyArticle(article, apiKey);

        // Cache in verifications store (same key verify.mjs uses)
        await verStore.setJSON(key, result);

        // Build article index entry
        const entry = {
          id: key,
          title: article.title,
          source: sourceId,
          sourceId,
          cat: article.cat,
          url: article.url,
          thumb: article.thumb,
          corridors: result.corridors,
          forced_fourth: result.forced_fourth,
          extension: result.extension,
          verified: Date.now()
        };

        newEntries.push(entry);
        verifiedIds.add(key);
        stats.verified++;

        // Small delay between API calls to be respectful
        await new Promise(r => setTimeout(r, 500));

      } catch (e) {
        console.warn(`[cron] Verification failed for "${article.title.slice(0,40)}": ${e.message}`);
        stats.failed++;
      }
    }

    if (stats.verified >= MAX_VERIFICATIONS_PER_RUN) {
      console.log('[cron] Per-run cap reached, will continue next run.');
      break;
    }
  }

  // Merge new entries into index (newest first)
  if (newEntries.length > 0) {
    index.articles = [...newEntries, ...index.articles];
    if (index.articles.length > 2000) index.articles = index.articles.slice(0, 2000);
    index.updated = new Date().toISOString();
    await artStore.setJSON('_index', index);
  }

  const summary = `[cron] Done. fetched=${stats.fetched} alreadyVerified=${stats.alreadyVerified} verified=${stats.verified} failed=${stats.failed} skipped=${stats.skipped}`;
  console.log(summary);

  return new Response(summary, { status: 200 });
};

// Run every 2 hours
export const config = {
  schedule: '0 */2 * * *'
};
