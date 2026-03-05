// ============================================================
// phicron2.mjs — Phiable Article Cron v5 — BACKGROUND FUNCTION
// Self-triggering background function. Runs continuously.
// Verifies 3 articles, saves each immediately, then triggers itself.
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
// RULE 4: SAFETY GUARD comments must stay in the code.
//
// RULE 5: Never lower MAX_ARTICLES below 5000.
//
// ============================================================
//
// BACKGROUND FUNCTION NOTES:
// - Netlify background functions have a 15 MINUTE timeout (not 60s)
// - Triggered via POST to /.netlify/functions/phicron2-background
// - Self-triggers via fetch to keep running continuously
// - Concurrency lock prevents overlapping runs
// - To START: POST to /api/phicron-trigger?secret=phiable-reset-2026
// - To STOP:  POST to /api/phicron-trigger?secret=phiable-reset-2026&stop=true
//
// ============================================================

import { getStore } from "@netlify/blobs";

const CLAUDE_TIMEOUT_MS  = 60000;
const BLOB_TIMEOUT_MS    = 8000;
const RSS_TIMEOUT_MS     = 8000;
const FETCH_TIMEOUT_MS   = 15000;
const ITEMS_PER_SOURCE   = 10;
const MAX_ARTICLES       = 5000;
const ARTICLES_PER_BATCH = 3;
const PAUSE_BETWEEN_MS   = 2000; // brief pause between articles

const SUBCATEGORIES = {
  news:          ['Investigative', 'Government/Political', 'Corporate', 'International', 'Civil Rights'],
  science:       ['Physics/Cosmology', 'Biology/Evolution', 'Mathematics', 'Climate Science', 'Emerging Research'],
  health:        ['Pharmaceutical Accountability', 'Clinical Research', 'Public Health Policy', 'Mental Health', 'Psychedelic/Integrative', 'Food/Industry'],
  climate:       ['Fossil Fuel Industry', 'Policy/Regulation', 'Extreme Weather', 'Clean Energy', 'Ecosystem'],
  finance:       ['Corporate Corruption', 'Markets/Economy', 'Labor/Wages', 'Political Money', 'Housing'],
  labor:         ['Union/Organizing', 'Workplace Safety', 'Wage Theft', 'Gig Economy', 'International Labor'],
  justice:       ['Incarceration', 'Policing', 'Courts/Law', 'Immigration', 'Civil Rights'],
  international: ['China', 'Middle East', 'Europe', 'Corruption/Crime', 'War/Conflict'],
  tech:          ['Surveillance/Privacy', 'AI/Automation', 'Platform Accountability', 'Cybersecurity', 'Regulation'],
  consciousness: ['Psychedelic Research', 'UAP/Anomalous', 'Cross-Cultural/Ancient', 'Neuroscience', 'Philosophy of Mind'],
  holometry:     ['Mathematics', 'Physics', 'Cosmology', 'Information Theory', 'Foundations'],
};

const DEFAULT_CONFIG = {
  sources: [
    { id: 'propublica',      name: 'ProPublica',          url: 'https://www.propublica.org/feeds/propublica/main',               cat: 'news',          active: true },
    { id: 'ap',              name: 'AP',                  url: 'https://feeds.apnews.com/rss/apf-topnews',                       cat: 'news',          active: true },
    { id: 'reuters',         name: 'Reuters',             url: 'https://feeds.reuters.com/reuters/topNews',                      cat: 'news',          active: true },
    { id: 'bbc',             name: 'BBC',                 url: 'http://feeds.bbci.co.uk/news/rss.xml',                           cat: 'news',          active: true },
    { id: 'npr',             name: 'NPR',                 url: 'https://feeds.npr.org/1001/rss.xml',                             cat: 'news',          active: true },
    { id: 'guardian',        name: 'The Guardian',        url: 'https://www.theguardian.com/world/rss',                          cat: 'news',          active: true },
    { id: 'aljazeera',       name: 'Al Jazeera',          url: 'https://www.aljazeera.com/xml/rss/all.xml',                      cat: 'news',          active: true },
    { id: 'bellingcat',      name: 'Bellingcat',          url: 'https://www.bellingcat.com/feed/',                               cat: 'news',          active: true },
    { id: 'intercept',       name: 'The Intercept',       url: 'https://theintercept.com/feed/?lang=en',                         cat: 'news',          active: true },
    { id: 'lever',           name: 'The Lever',           url: 'https://www.levernews.com/feed/',                                cat: 'news',          active: true },
    { id: 'markup',          name: 'The Markup',          url: 'https://themarkup.org/feeds/rss.xml',                            cat: 'news',          active: true },
    { id: 'fourzerofour',    name: '404 Media',           url: 'https://www.404media.co/rss/',                                   cat: 'news',          active: true },
    { id: 'dropsite',        name: 'Drop Site',           url: 'https://www.dropsitenews.com/feed',                              cat: 'news',          active: true },
    { id: 'mpu',             name: 'More Perfect Union',  url: 'https://perfectunion.us/rss/',                                   cat: 'news',          active: true },
    { id: 'quanta',          name: 'Quanta',              url: 'https://www.quantamagazine.org/feed/',                           cat: 'science',       active: true },
    { id: 'newscientist',    name: 'New Scientist',       url: 'https://www.newscientist.com/feed/home/',                        cat: 'science',       active: true },
    { id: 'sciencedaily',    name: 'Science Daily',       url: 'https://www.sciencedaily.com/rss/all.xml',                       cat: 'science',       active: true },
    { id: 'thescientist',    name: 'The Scientist',       url: 'https://www.the-scientist.com/rss',                              cat: 'science',       active: true },
    { id: 'mongabay',        name: 'Mongabay',            url: 'https://news.mongabay.com/feed/',                                cat: 'science',       active: true },
    { id: 'earthobs',        name: 'Earth Observatory',   url: 'https://earthobservatory.nasa.gov/feeds/earth-observatory.rss',  cat: 'science',       active: true },
    { id: 'sciam',           name: 'Scientific American', url: 'https://rss.sciam.com/ScientificAmerican-Global',                cat: 'science',       active: true },
    { id: 'conversation',    name: 'The Conversation',    url: 'https://theconversation.com/us/articles.atom',                   cat: 'science',       active: true },
    { id: 'undark',          name: 'Undark',              url: 'https://undark.org/feed/',                                       cat: 'science',       active: true },
    { id: 'knowable',        name: 'Knowable Magazine',   url: 'https://knowablemagazine.org/rss.xml',                           cat: 'science',       active: true },
    { id: 'statnews',        name: 'STAT News',           url: 'https://www.statnews.com/feed/',                                 cat: 'health',        active: true },
    { id: 'kff',             name: 'Kaiser Health News',  url: 'https://kffhealthnews.org/feed/',                                cat: 'health',        active: true },
    { id: 'retraction',      name: 'Retraction Watch',    url: 'https://retractionwatch.com/feed/',                              cat: 'health',        active: true },
    { id: 'medpage',         name: 'MedPage Today',       url: 'https://www.medpagetoday.com/rss/headlines.xml',                 cat: 'health',        active: true },
    { id: 'bmj',             name: 'The BMJ',             url: 'https://www.bmj.com/rss/current.xml',                            cat: 'health',        active: true },
    { id: 'madinamerica',    name: 'Mad in America',      url: 'https://www.madinamerica.com/feed/',                             cat: 'health',        active: true },
    { id: 'maps',            name: 'MAPS',                url: 'https://maps.org/feed/',                                         cat: 'health',        active: true },
    { id: 'psychalpha',      name: 'Psychedelic Alpha',   url: 'https://psychedelicalpha.com/feed',                              cat: 'health',        active: true },
    { id: 'stamets',         name: 'Paul Stamets',        url: 'https://paulstamets.substack.com/feed',                          cat: 'health',        active: true },
    { id: 'cspi',            name: 'CSPI',                url: 'https://www.cspinet.org/rss.xml',                                cat: 'health',        active: true },
    { id: 'insideclimate',   name: 'Inside Climate News', url: 'https://insideclimatenews.org/feed/',                            cat: 'climate',       active: true },
    { id: 'carbonbrief',     name: 'Carbon Brief',        url: 'https://www.carbonbrief.org/feed',                               cat: 'climate',       active: true },
    { id: 'yale360',         name: 'Yale E360',           url: 'https://e360.yale.edu/feed',                                     cat: 'climate',       active: true },
    { id: 'guardianclimate', name: 'Guardian Climate',    url: 'https://www.theguardian.com/environment/climate-crisis/rss',     cat: 'climate',       active: true },
    { id: 'grist',           name: 'Grist',               url: 'https://grist.org/feed/',                                        cat: 'climate',       active: true },
    { id: 'desmog',          name: 'DeSmog',              url: 'https://www.desmog.com/feed/',                                   cat: 'climate',       active: true },
    { id: 'wolfstreet',      name: 'Wolf Street',         url: 'https://wolfstreet.com/feed/',                                   cat: 'finance',       active: true },
    { id: 'nakedcap',        name: 'Naked Capitalism',    url: 'https://www.nakedcapitalism.com/feed',                           cat: 'finance',       active: true },
    { id: 'opensecrets',     name: 'OpenSecrets',         url: 'https://www.opensecrets.org/news/feed',                          cat: 'finance',       active: true },
    { id: 'planetmoney',     name: 'Planet Money',        url: 'https://feeds.npr.org/510289/podcast.xml',                       cat: 'finance',       active: true },
    { id: 'documented',      name: 'Documented',          url: 'https://documented.net/feed',                                    cat: 'finance',       active: true },
    { id: 'prospect',        name: 'American Prospect',   url: 'https://prospect.org/feed/',                                     cat: 'finance',       active: true },
    { id: 'inthesetimes',    name: 'In These Times',      url: 'https://inthesetimes.com/feed',                                  cat: 'labor',         active: true },
    { id: 'workday',         name: 'Workday Magazine',    url: 'https://workdaymagazine.org/feed/',                              cat: 'labor',         active: true },
    { id: 'labornotes',      name: 'Labor Notes',         url: 'https://labornotes.org/feed',                                    cat: 'labor',         active: true },
    { id: 'currentaffairs',  name: 'Current Affairs',     url: 'https://www.currentaffairs.org/feed',                            cat: 'labor',         active: true },
    { id: 'theappeal',       name: 'The Appeal',          url: 'https://theappeal.org/feed/',                                    cat: 'justice',       active: true },
    { id: 'marshall',        name: 'Marshall Project',    url: 'https://www.themarshallproject.org/feeds/posts',                 cat: 'justice',       active: true },
    { id: 'bolts',           name: 'Bolts Magazine',      url: 'https://boltsmag.org/feed/',                                    cat: 'justice',       active: true },
    { id: 'occrp',           name: 'OCCRP',               url: 'https://www.occrp.org/en/rss',                                   cat: 'international', active: true },
    { id: 'reutersworld',    name: 'Reuters World',       url: 'https://feeds.reuters.com/reuters/worldNews',                    cat: 'international', active: true },
    { id: 'bbcworld',        name: 'BBC World',           url: 'http://feeds.bbci.co.uk/news/world/rss.xml',                     cat: 'international', active: true },
    { id: 'sixthtone',       name: 'Sixth Tone',          url: 'https://www.sixthtone.com/rss',                                  cat: 'international', active: true },
    { id: 'cdt',             name: 'China Digital Times', url: 'https://chinadigitaltimes.net/feed/',                            cat: 'international', active: true },
    { id: 'rfa',             name: 'Radio Free Asia',     url: 'https://www.rfa.org/english/rss2.xml',                           cat: 'international', active: true },
    { id: 'nhkworld',        name: 'NHK World',           url: 'https://www3.nhk.or.jp/rss/news/cat0.xml',                       cat: 'international', active: true },
    { id: 'thewire',         name: 'The Wire India',      url: 'https://thewire.in/feed',                                        cat: 'international', active: true },
    { id: 'arstechnica',     name: 'Ars Technica',        url: 'https://feeds.arstechnica.com/arstechnica/index',                cat: 'tech',          active: true },
    { id: 'theregister',     name: 'The Register',        url: 'https://www.theregister.com/headlines.atom',                     cat: 'tech',          active: true },
    { id: 'mittech',         name: 'MIT Tech Review',     url: 'https://www.technologyreview.com/feed/',                         cat: 'tech',          active: true },
    { id: 'eff',             name: 'EFF Deeplinks',       url: 'https://www.eff.org/rss/updates.xml',                            cat: 'tech',          active: true },
    { id: 'simonw',          name: 'Simon Willison',      url: 'https://simonwillison.net/atom/everything/',                     cat: 'tech',          active: true },
    { id: 'aeon',            name: 'Aeon',                url: 'https://aeon.co/feed.rss',                                       cat: 'consciousness', active: true },
    { id: 'nautilus',        name: 'Nautilus',            url: 'https://nautil.us/feed/',                                        cat: 'consciousness', active: true },
    { id: 'chacruna',        name: 'Chacruna',            url: 'https://chacruna.net/feed/',                                     cat: 'consciousness', active: true },
    { id: 'neurosciencenews',name: 'Neuroscience News',   url: 'https://neurosciencenews.com/feed/',                             cat: 'consciousness', active: true },
    { id: 'thedebrief',      name: 'The Debrief',         url: 'https://thedebrief.org/feed/',                                   cat: 'consciousness', active: true },
    { id: 'liberationtimes', name: 'Liberation Times',    url: 'https://www.liberationtimes.com/feed',                           cat: 'consciousness', active: true },
    { id: 'quantamath',      name: 'Quanta Math',         url: 'https://www.quantamagazine.org/mathematics/feed/',               cat: 'holometry',     active: true },
    { id: 'johnbaez',        name: 'John Baez',           url: 'https://johncarlosbaez.wordpress.com/feed/',                     cat: 'holometry',     active: true },
    { id: 'scottaaronson',   name: 'Scott Aaronson',      url: 'https://scottaaronson.blog/?feed=rss2',                          cat: 'holometry',     active: true },
    { id: 'terrytao',        name: 'Terry Tao',           url: 'https://terrytao.wordpress.com/feed/',                           cat: 'holometry',     active: true },
    { id: 'inference',       name: 'Inference Magazine',  url: 'https://inference-review.com/rss',                               cat: 'holometry',     active: true },
    { id: 'sabine',          name: 'Sabine Hossenfelder', url: 'https://backreaction.blogspot.com/feeds/posts/default',          cat: 'holometry',     active: true },
  ],
  searchTerms: [
    { term: 'psilocybin clinical trial',     cat: 'consciousness', active: true },
    { term: 'DMT neuroscience research',     cat: 'consciousness', active: true },
    { term: 'UAP Pentagon disclosure',       cat: 'consciousness', active: true },
    { term: 'cross-cultural shamanism',      cat: 'consciousness', active: true },
    { term: 'Göbekli Tepe discovery',        cat: 'consciousness', active: true },
    { term: 'psychedelic therapy FDA',       cat: 'consciousness', active: true },
    { term: 'Apollonian gasket mathematics', cat: 'holometry',     active: true },
    { term: 'Riemann hypothesis proof',      cat: 'holometry',     active: true },
    { term: 'quantum gravity research',      cat: 'holometry',     active: true },
    { term: 'holographic principle physics', cat: 'holometry',     active: true },
    { term: 'emergence complexity theory',   cat: 'holometry',     active: true },
    { term: 'fractal geometry research',     cat: 'holometry',     active: true },
  ],
  updated: new Date().toISOString()
};

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms))
  ]);
}

function hashKey(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = Math.imul(31, h) + str.charCodeAt(i) | 0; }
  return Math.abs(h).toString(36);
}

async function fetchRSS(source) {
  const r = await withTimeout(
    fetch(source.url, { headers: { 'User-Agent': 'Phiable/1.0 RSS Reader' } }),
    RSS_TIMEOUT_MS, `fetch ${source.id}`
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function parseRSS(xml, source) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>|<entry>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < ITEMS_PER_SOURCE) {
    const block = match[1] || match[2];
    const title  = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]?.trim();
    const link   = (block.match(/<link[^>]*>(?:<!\[CDATA\[)?(https?:\/\/[^\s<\]]+)/) ||
                    block.match(/<link[^>]+href="(https?:\/\/[^"]+)"/) ||
                    block.match(/<guid[^>]*>(https?:\/\/[^\s<]+)/) || [])[1]?.trim();
    const pub    = (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/) ||
                    block.match(/<published[^>]*>([\s\S]*?)<\/published>/) || [])[1]?.trim();
    const thumb  = (block.match(/url="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/) ||
                    block.match(/<media:thumbnail[^>]+url="([^"]+)"/) || [])[1];
    if (title && link) {
      items.push({
        title: title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"'),
        url: link, sourceId: source.id, sourceName: source.name, cat: source.cat,
        ts: pub ? new Date(pub).getTime() || Date.now() : Date.now(),
        thumb: thumb || null
      });
    }
  }
  return items;
}

async function fetchArticleBody(url) {
  try {
    const r = await withTimeout(
      fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }),
      FETCH_TIMEOUT_MS, `fetch body`
    );
    if (!r.ok) return null;
    const html = await r.text();
    const lower = html.toLowerCase();
    const paywallSignals = ['subscribe to read','subscription required','subscriber only','sign in to read','create an account to read','premium content','this content is for subscribers','unlock this article'];
    if (paywallSignals.some(s => lower.includes(s)) && html.length < 5000) return null;
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'')
      .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').trim();
    if (text.length < 200) return null;
    return text.slice(0, 4000);
  } catch(e) { return null; }
}

async function verifyArticle(article, apiKey) {
  const subcats = SUBCATEGORIES[article.cat] || [];
  const prompt = `You are Phiable's verification engine. Find three genuinely independent angles on this piece, derive what they FORCE to be true (forced fourth), and what that implies beyond the article (extension).

SOURCE: ${article.sourceName}
HEADLINE: ${article.title}
BODY: ${article.body}

Use web search to find at least 2 independent sources that corroborate, contextualize, or contradict the claims. Sources must be editorially independent.

Classify into one sub-category from: ${subcats.join(', ')}

Return ONLY raw JSON, no markdown:
{"corridors":[{"angle":"label","finding":"precise sentence"},{"angle":"label","finding":"precise sentence"},{"angle":"label","finding":"precise sentence"}],"forced_fourth":"what all three force to be true — not stated in article","extension":"one thing forced to also be true beyond this article","subcategory":"one sub-category","os":0.0}

Scoring: 0.90-1.00 perfect closure, 0.70-0.89 strong, 0.50-0.69 partial, 0.30-0.49 weak, 0.10-0.29 open/essay, 0.00-0.09 unverifiable. Subtract 0.15 if corridors share parent company.`;

  let messages = [{ role: 'user', content: prompt }];
  for (let turn = 0; turn < 10; turn++) {
    const r = await withTimeout(
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, tools: [{ type: 'web_search_20250305', name: 'web_search' }], messages })
      }),
      CLAUDE_TIMEOUT_MS, `verify`
    );
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
    let txt = '';
    data.content?.forEach(b => { if (b.type === 'text') txt += b.text; });
    const hasToolUse = data.content?.some(b => b.type === 'tool_use');
    if (!hasToolUse || data.stop_reason === 'end_turn') {
      if (!txt.trim()) throw new Error('Empty response');
      const match = txt.replace(/```json|```/g,'').trim().match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');
      return JSON.parse(match[0]);
    }
    messages.push({ role: 'assistant', content: data.content });
    const toolResults = data.content
      .filter(b => b.type === 'tool_use')
      .map(b => ({
        type: 'tool_result',
        tool_use_id: b.id,
        content: b.type === 'tool_use' && b.name === 'web_search'
          ? (b.output ? JSON.stringify(b.output) : 'Search returned no results.')
          : 'Done.'
      }));
    messages.push({ role: 'user', content: toolResults });
  }
  throw new Error('Max turns exceeded');
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async (req, context) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response('No API key', { status: 500 });

  const url = new URL(req.url);

  // Stop command
  if (url.searchParams.get('stop') === 'true') {
    const artStore = getStore('articles');
    await artStore.setJSON('_cron_stop', { stopped: true, ts: Date.now() });
    return new Response('Phicron stopped', { status: 200 });
  }

  const artStore = getStore('articles');
  const verStore = getStore('verifications');

  // Check stop flag
  try {
    const stopFlag = await artStore.get('_cron_stop', { type: 'json' });
    if (stopFlag?.stopped) {
      console.log('[cron] Stop flag set, halting');
      return new Response('stopped', { status: 200 });
    }
  } catch(e) { /* no stop flag, continue */ }

  // ── SAFETY GUARD 1: LOAD INDEX ────────────────────────────────────────────
  let index;
  let attempts = 0;
  while (attempts < 3) {
    try {
      index = await withTimeout(artStore.get('_index_a', { type: 'json' }), BLOB_TIMEOUT_MS, 'load index');
      if (index) break;
    } catch(e) {
      attempts++;
      if (attempts < 3) await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (!index) {
    try {
      const existing = await withTimeout(artStore.list(), BLOB_TIMEOUT_MS, 'list store');
      if (existing?.blobs?.length > 0) {
        console.error('[cron] SAFETY ABORT: index load failed but store has data');
        return new Response('safety_abort', { status: 200 });
      }
      index = { articles: [], updated: null };
    } catch(e) {
      console.error('[cron] SAFETY ABORT: cannot verify store state');
      return new Response('safety_abort', { status: 200 });
    }
  }
  // ── END SAFETY GUARD 1 ────────────────────────────────────────────────────

  const originalCount = index.articles.length;
  console.log(`[cron] ${originalCount} articles in store`);

  // Load or init config
  let config;
  try { config = await withTimeout(artStore.get('_config', { type: 'json' }), BLOB_TIMEOUT_MS, 'load config'); }
  catch(e) { config = null; }
  if (!config) {
    config = DEFAULT_CONFIG;
    try { await withTimeout(artStore.setJSON('_config', config), BLOB_TIMEOUT_MS, 'write config'); }
    catch(e) { console.warn('[cron] Could not write default config'); }
  }

  const verifiedIds = new Set(index.articles.map(a => a.id));
  const candidates = [];

  // Fetch all RSS sources in parallel
  const rssResults = await Promise.allSettled(
    config.sources.filter(s => s.active).map(source =>
      fetchRSS(source).then(xml => ({ source, items: parseRSS(xml, source) }))
    )
  );
  for (const r of rssResults) {
    if (r.status === 'rejected') continue;
    for (const item of r.value.items) {
      const key = hashKey(item.title + '|' + item.sourceId);
      if (!verifiedIds.has(key)) candidates.push({ ...item, key });
    }
  }

  if (candidates.length === 0) {
    console.log('[cron] No new candidates found');
    return new Response('no_candidates', { status: 200 });
  }

  // Pick ARTICLES_PER_BATCH random candidates
  const toVerify = candidates.sort(() => Math.random() - 0.5).slice(0, ARTICLES_PER_BATCH);
  console.log(`[cron] ${candidates.length} candidates, verifying ${toVerify.length}`);

  // ── SAFETY GUARD 2: VERIFY AND SAVE EACH IMMEDIATELY ─────────────────────
  for (const article of toVerify) {
    try {
      article.body = await fetchArticleBody(article.url);
      if (!article.body) {
        console.log(`[cron] Skipped (no body): ${article.title?.slice(0,50)}`);
        continue;
      }

      const result = await verifyArticle(article, apiKey);
      await withTimeout(verStore.setJSON(article.key, result), BLOB_TIMEOUT_MS, 'store verification');

      const newEntry = {
        id: article.key, ti: article.title, si: article.sourceId, sn: article.sourceName,
        cat: article.cat, subcat: result.subcategory || null, url: article.url,
        thumb: article.thumb || null, corridors: result.corridors,
        forced_fourth: result.forced_fourth, extension: result.extension,
        os: result.os || 0, verified: Date.now(), deepVerified: false
      };

      // Load fresh index before each save to avoid race conditions
      let fresh;
      try { fresh = await withTimeout(artStore.get('_index_a', { type: 'json' }), BLOB_TIMEOUT_MS, 'load fresh'); }
      catch(e) { fresh = index; }
      if (!fresh) fresh = index;

      const freshCount = fresh.articles.length;
      fresh.articles = [newEntry, ...fresh.articles.filter(a => a.id !== newEntry.id)];
      if (fresh.articles.length > MAX_ARTICLES) fresh.articles = fresh.articles.slice(0, MAX_ARTICLES);
      fresh.updated = new Date().toISOString();

      if (fresh.articles.length >= freshCount) {
        await withTimeout(artStore.setJSON('_index_a', fresh), BLOB_TIMEOUT_MS, 'save index');
        index = fresh;
        verifiedIds.add(article.key);
        console.log(`[cron] ✓ Verified (${Math.round((result.os||0)*100)}/100): ${article.title?.slice(0,60)}`);
      } else {
        console.warn(`[cron] SAFETY SKIP save — would shrink index`);
      }

      await new Promise(r => setTimeout(r, PAUSE_BETWEEN_MS));

    } catch(e) {
      console.warn(`[cron] ✗ Failed: ${article.title?.slice(0,40)} — ${e.message}`);
    }
  }
  // ── END SAFETY GUARD 2 ────────────────────────────────────────────────────

  // Daily backup
  try {
    const today = new Date().toISOString().slice(0,10);
    await withTimeout(artStore.setJSON(`_index_backup_${today}`, index), BLOB_TIMEOUT_MS, 'backup');
  } catch(e) { /* non-fatal */ }

  console.log(`[cron] Batch done. Total: ${index.articles.length}`);

  return new Response(JSON.stringify({ ok: true, total: index.articles.length }), { status: 200 });
};

export const config = { schedule: '* * * * *' };
