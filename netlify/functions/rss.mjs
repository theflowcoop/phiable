// rss.mjs - RSS proxy (Netlify Functions v2)

const SOURCES = {
  // NEWS
  propublica:{url:'https://www.propublica.org/feeds/propublica/main',cat:'news'},
  bellingcat:{url:'https://www.bellingcat.com/feed/',cat:'news'},
  intercept:{url:'https://theintercept.com/feed/?rss',cat:'news'},
  lever:{url:'https://www.levernews.com/rss/',cat:'news'},
  markup:{url:'https://themarkup.org/feeds/rss.xml',cat:'news',cats:['news','tech']},
  '404media':{url:'https://www.404media.co/rss/',cat:'news',cats:['news','tech']},
  dropsite:{url:'https://www.dropsitenews.com/feed',cat:'news'},
  mpu:{url:'https://perfectunion.us/rss/',cat:'news'},
  steady:{url:'https://steady.substack.com/feed',cat:'news'},
  // NATURE
  outside:{url:'https://www.outsideonline.com/feed/',cat:'nature'},
  trailrunner:{url:'https://www.trailrunnermag.com/feed/',cat:'nature'},
  adventurejournal:{url:'https://www.adventure-journal.com/feed/',cat:'nature'},
  northspore:{url:'https://www.youtube.com/feeds/videos.xml?channel_id=UC1IFVMqMSbqnMEBBRkVsgOA',cat:'nature'},
  fungiperfecti:{url:'https://fungi.com/blogs/fungi-perfecti.atom',cat:'nature'},
  fungifoundation:{url:'https://www.ffungi.org/blog?format=rss',cat:'nature'},
  nama:{url:'https://namyco.org/feed/',cat:'nature'},
  mushroomhour:{url:'https://mushroomhour.substack.com/feed',cat:'nature'},
  // SCIENCE
  quanta:{url:'https://api.quantamagazine.org/feed/',cat:'science'},
  veritasium:{url:'https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA',cat:'science'},
  spacetime:{url:'https://www.youtube.com/feeds/videos.xml?channel_id=UC7_gcs09iThXybpVgjHZ_7g',cat:'science'},
  sabine:{url:'https://www.youtube.com/feeds/videos.xml?channel_id=UC1yNl2E66ZzKApQdRuTQ4tw',cat:'science'},
  toe:{url:'https://www.youtube.com/feeds/videos.xml?channel_id=UCddiUEpeqJcYeBxX1IVBKvQ',cat:'science'},
  carroll:{url:'https://www.preposterousuniverse.com/podcast/feed/podcast/',cat:'science'},
  physicsworld:{url:'https://physicsworld.com/feed/',cat:'science'},
  startswithabang:{url:'https://bigthink.com/starts-with-a-bang/feed/',cat:'science'},
  // HEALTH
  statnews:{url:'https://www.statnews.com/feed/',cat:'health'},
  retractionwatch:{url:'https://retractionwatch.com/feed/',cat:'health'},
  // MUSIC
  beato:{url:'https://www.youtube.com/feeds/videos.xml?channel_id=UCJquYOG5EL82sKTfH9aMA9Q',cat:'music'},
  tetragrammaton:{url:'https://www.youtube.com/feeds/videos.xml?channel_id=UCfk49Grfln4BkQfqlbPMRuQ',cat:'music'},
  hypebot:{url:'https://www.hypebot.com/feed/',cat:'music'},
  bandcamp:{url:'https://daily.bandcamp.com/feed',cat:'music'},
  digitalmusicnews:{url:'https://www.digitalmusicnews.com/feed/',cat:'music'},
  soundonsound:{url:'https://www.soundonsound.com/feed/all',cat:'music'},
  reverb:{url:'https://reverb.com/news/feed',cat:'music'},
  // HOBBIES
  bonsaitonight:{url:'https://bonsaitonight.com/feed/',cat:'hobbies'},
  bonsaiempire:{url:'https://www.bonsaiempire.com/feed',cat:'hobbies'},
  herons:{url:'https://www.herons.co.uk/blog/feed/',cat:'hobbies'},
  crataegus:{url:'https://crataegus.com/feed/',cat:'hobbies'},
  electrek:{url:'https://electrek.co/feed/',cat:'hobbies'},
  surronster:{url:'https://www.youtube.com/feeds/videos.xml?channel_id=UCqBz3SVpb0er5iLIrGNBYcA',cat:'hobbies'},
  ebr:{url:'https://electricbikereview.com/feed/',cat:'hobbies'},
  micromobility:{url:'https://micromobility.io/feed',cat:'hobbies'},
  surron:{url:'https://www.surron.com/blogs/news.atom',cat:'hobbies'},
  // CONSCIOUSNESS
  doubleblind:{url:'https://doubleblindmag.com/feed/',cat:'consciousness'},
  maps:{url:'https://maps.org/feed/',cat:'consciousness'},
  thirdwave:{url:'https://thethirdwave.co/feed/',cat:'consciousness'},
  chacruna:{url:'https://chacruna.net/feed/',cat:'consciousness'},
  stamets:{url:'https://paulstamets.substack.com/feed',cat:'consciousness'},
  // GAMING
  minecraft:{url:'https://www.minecraft.net/en-us/feeds/community-content/rss',cat:'gaming'},
  xisuma:{url:'https://www.youtube.com/feeds/videos.xml?channel_id=UCU9pX8hKcrx06XfOB-VQLdw',cat:'gaming'},
  roblox:{url:'https://blog.roblox.com/feed/',cat:'gaming'},
  // HOLOMETRY
  '3b1b':{url:'https://www.youtube.com/feeds/videos.xml?channel_id=UCYO_jab_esuFRV4b17AJtAw',cat:'holometry'},
  numberphile:{url:'https://www.youtube.com/feeds/videos.xml?channel_id=UCoxcjq-8xIDTYp3uz647V5A',cat:'holometry'},
  quantamath:{url:'https://api.quantamagazine.org/feed/?tags=mathematics',cat:'holometry'},
};

export default async (req, context) => {
  const url = new URL(req.url);
  const src = url.searchParams.get("src");

  if (src === "catalog") {
    const catalog = Object.entries(SOURCES).map(([id, s]) => ({
      id, url: s.url, cat: s.cat, cats: s.cats || [s.cat]
    }));
    return new Response(JSON.stringify(catalog), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=900" }
    });
  }

  if (!src || !SOURCES[src]) {
    return new Response(JSON.stringify({ error: "Unknown source", available: Object.keys(SOURCES) }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const r = await fetch(SOURCES[src].url, {
      headers: { "User-Agent": "Phiable/2.0 (news verification; phiable.netlify.app)" }
    });
    if (!r.ok) return new Response(`<e>HTTP ${r.status}</e>`, {
      status: r.status, headers: { "Content-Type": "application/xml" }
    });
    const xml = await r.text();
    return new Response(xml, {
      headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=900" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = { path: "/api/rss" };
