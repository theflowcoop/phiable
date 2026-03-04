// cron.mjs - Server-side article verification (Netlify Scheduled Function v2)
// Runs every 2 hours. Fetches all RSS in parallel. Fast verify (no web_search).
// Queues articles for worker.mjs deep verification with web_search.
// Hard timeouts on every async op. Nothing can hang.

import { getStore } from "@netlify/blobs";

const MAX_VERIFY_PER_RUN = 20;
const CLAUDE_TIMEOUT_MS  = 20000;
const BLOB_TIMEOUT_MS    = 5000;
const RSS_TIMEOUT_MS     = 8000;
const ITEMS_PER_SOURCE   = 15;

const SOURCES = {
  // NEWS
  propublica:       { url: 'https://www.propublica.org/feeds/propublica/main', cat: 'news' },
  // COMMUNITY MUSIC
  darol_anger:      { url: 'https://darolanger.substack.com/feed', cat: 'music' },
  jessewelles:      { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCpKWFJJFkuJbYfbP9DmHWaA', cat: 'music' },
  noside_session:   { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCsT0YIqwnpJCM-mx7-gSA4Q', cat: 'music' },
  acmegrassroots:   { url: 'https://www.acmegrassroots.com/feed/', cat: 'music' },
  folkworks:        { url: 'https://folkworks.org/feed/', cat: 'music' },
  fiddlehangout:    { url: 'https://www.fiddlehangout.com/feed/', cat: 'music' },
  banjohangoout:    { url: 'https://www.banjohangout.org/feed/', cat: 'music' },
  oldtimeparty:     { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCbqHqVrKXjpNCSXNhKhxVkQ', cat: 'music' },
  apassion4jazz:    { url: 'https://www.apassion4jazz.net/feed/', cat: 'music' },
  jazziz:           { url: 'https://jazziz.com/feed/', cat: 'music' },
  allaboutjazz:     { url: 'https://www.allaboutjazz.com/rss/news.rss', cat: 'music' },
  raffi_songs:      { url: 'https://www.raffinews.com/feed/', cat: 'music' },
  henhouse:         { url: 'https://www.henhousestudios.com/blog/feed/', cat: 'music' },
  masonjennings:    { url: 'https://www.masonjennings.com/feed/', cat: 'music' },
  markoconnor:      { url: 'https://markoconnormusic.com/feed/', cat: 'music' },
  // COMEDY
  splitsider:       { url: 'https://www.avclub.com/comedy/rss', cat: 'comedy' },
  theonion:         { url: 'https://www.theonion.com/rss', cat: 'comedy' },
  clickhole:        { url: 'https://www.clickhole.com/rss', cat: 'comedy' },
  hardtimes:        { url: 'https://thehardtimes.net/feed/', cat: 'comedy' },
  mcsweeney:        { url: 'https://www.mcsweeneys.net/feed', cat: 'comedy' },
  reductress:       { url: 'https://reductress.com/feed/', cat: 'comedy' },
  chortle:          { url: 'https://www.chortle.co.uk/feed/', cat: 'comedy' },
  vulture_comedy:   { url: 'https://www.vulture.com/comedy/rss', cat: 'comedy' },
  punchlinemag:     { url: 'https://punchlinemag.com/feed/', cat: 'comedy' },
  // ART
  hyperallergic:    { url: 'https://hyperallergic.com/feed/', cat: 'art' },
  artforum:         { url: 'https://www.artforum.com/feed/', cat: 'art' },
  colossal:         { url: 'https://www.thisiscolossal.com/feed/', cat: 'art' },
  artnews:          { url: 'https://www.artnews.com/feed/', cat: 'art' },
  designboom:       { url: 'https://www.designboom.com/feed/', cat: 'art' },
  it_nice_that:     { url: 'https://www.itsnicethat.com/feed', cat: 'art' },
  creative_bloq:    { url: 'https://www.creativebloq.com/feed/', cat: 'art' },
  ascii_art:        { url: 'https://www.ascii-art.de/feed/', cat: 'art' },
  streetartutopia:  { url: 'https://www.streetartutopia.com/feed/', cat: 'art' },
  publicdelivery:   { url: 'https://publicdelivery.org/feed/', cat: 'art' },
  // FRONTIER SCIENCE
  centerminds:      { url: 'https://centerformindandbrain.ucdavis.edu/feed/', cat: 'consciousness' },
  qualia_research:  { url: 'https://www.qualiaresearchinstitute.org/blog?format=rss', cat: 'consciousness' },
  integrated_info:  { url: 'https://iit.mind.wi.mit.edu/feed/', cat: 'consciousness' },
  sci_consciousness:{ url: 'https://www.scienceofconsciousness.org/feed/', cat: 'consciousness' },
  psychedelic_sci:  { url: 'https://maps.org/news/feed/', cat: 'consciousness' },
  noetic_sci:       { url: 'https://noetic.org/feed/', cat: 'consciousness' },
  edge_science:     { url: 'https://edgescience.org/feed/', cat: 'consciousness' },
  skeptic_inquiry:  { url: 'https://skepticalinquirer.org/feed/', cat: 'consciousness' },
  futurism:         { url: 'https://futurism.com/feed', cat: 'consciousness' },
  singularity_hub:  { url: 'https://singularityhub.com/feed/', cat: 'consciousness' },

  // WIRE & BREAKING
  ap:               { url: 'https://feeds.apnews.com/apnews/topnews', cat: 'news' },
  reuters:          { url: 'https://feeds.reuters.com/reuters/topNews', cat: 'news' },
  bbc:              { url: 'https://feeds.bbci.co.uk/news/rss.xml', cat: 'news' },
  nprnews:          { url: 'https://feeds.npr.org/1001/rss.xml', cat: 'news' },
  guardian:         { url: 'https://www.theguardian.com/world/rss', cat: 'news' },
  aljazeera:        { url: 'https://www.aljazeera.com/xml/rss/all.xml', cat: 'news' },
  // GOOGLE NEWS TOPICS (real-time, broad)
  gnews_world:      { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlBQVAB', cat: 'news' },
  gnews_science:    { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNR1ozZW1nd1NBbVZ1R2dKVlV5QUFQAQ', cat: 'science' },
  gnews_tech:       { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlBQVAB', cat: 'news' },
  gnews_health:     { url: 'https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtVnVLQUFQAQ', cat: 'health' },
  // REDDIT (fastest breaking)
  reddit_world:     { url: 'https://www.reddit.com/r/worldnews/top/.rss?t=day', cat: 'news' },
  reddit_science:   { url: 'https://www.reddit.com/r/science/top/.rss?t=day', cat: 'science' },
  reddit_finance:   { url: 'https://www.reddit.com/r/economics/top/.rss?t=day', cat: 'finance' },
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
  advjournal: { url: 'https://www.adventure-journal.com/feed/', cat: 'nature' },
  northspore:       { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1IFVMqMSbqnMEBBRkVsgOA', cat: 'nature' },
  ffungi:    { url: 'https://fungi.com/blogs/fungi-perfecti.atom', cat: 'nature' },
  nama:             { url: 'https://namyco.org/feed/', cat: 'nature' },
  iucn:             { url: 'https://www.iucn.org/news/feed', cat: 'nature' },
  audubon:          { url: 'https://www.audubon.org/rss.xml', cat: 'nature' },
  natgeo:           { url: 'https://www.nationalgeographic.com/feed/news', cat: 'nature' },
  rewilding:        { url: 'https://rewildingeurope.com/feed/', cat: 'nature' },
  inaturalist:      { url: 'https://www.inaturalist.org/blog.atom', cat: 'nature' },
  allaboutbirds:    { url: 'https://www.allaboutbirds.org/news/feed/', cat: 'nature' },
  northspore_blog:     { url: 'https://mushroomhour.substack.com/feed', cat: 'nature' },
  // SCIENCE
  quanta:           { url: 'https://api.quantamagazine.org/feed/', cat: 'science' },
  veritasium:       { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA', cat: 'science' },
  spacetime:        { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC7_gcs09iThXybpVgjHZ_7g', cat: 'science' },
  sabine:           { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1yNl2E66ZzKApQdRuTQ4tw', cat: 'science' },
  toe:              { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCddiUEpeqJcYeBxX1IVBKvQ', cat: 'science' },
  carroll:          { url: 'https://www.preposterousuniverse.com/podcast/feed/podcast/', cat: 'science' },
  physworld:     { url: 'https://physicsworld.com/feed/', cat: 'science' },
  siegel:  { url: 'https://bigthink.com/starts-with-a-bang/feed/', cat: 'science' },
  // HEALTH
  statnews:         { url: 'https://www.statnews.com/feed/', cat: 'health' },
  medscape:         { url: 'https://www.medscape.com/rss/news', cat: 'health' },
  nih_news:         { url: 'https://www.nih.gov/news-events/feed.xml', cat: 'health' },
  who_news:         { url: 'https://www.who.int/rss-feeds/news-english.xml', cat: 'health' },
  cdc_news:         { url: 'https://tools.cdc.gov/api/v2/resources/media/403372.rss', cat: 'health' },
  nejm:             { url: 'https://www.nejm.org/action/showFeed?type=etoc&feed=rss&jc=nejm', cat: 'health' },
  medxiv:           { url: 'https://connect.medrxiv.org/trends/rss/topic/public_health_emergency_of_int.xml', cat: 'health' },
  retraction:  { url: 'https://retractionwatch.com/feed/', cat: 'health' },
  // MUSIC
  beato:            { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCJquYOG5EL82sKTfH9aMA9Q', cat: 'music' },
  rubin:   { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCfk49Grfln4BkQfqlbPMRuQ', cat: 'music' },
  hypebot:          { url: 'https://www.hypebot.com/feed/', cat: 'music' },
  bandcamp:         { url: 'https://daily.bandcamp.com/feed', cat: 'music' },
  dmn: { url: 'https://www.digitalmusicnews.com/feed/', cat: 'music' },
  sos:     { url: 'https://www.soundonsound.com/feed/all', cat: 'music' },
  reverb:           { url: 'https://reverb.com/news/feed', cat: 'music' },
  pitchfork:        { url: 'https://pitchfork.com/rss/news/', cat: 'music' },
  residentadvisor:  { url: 'https://www.residentadvisor.net/feed.aspx', cat: 'music' },
  factmag:          { url: 'https://www.factmag.com/feed/', cat: 'music' },
  xlr8r:            { url: 'https://xlr8r.com/feed/', cat: 'music' },
  consequenceof:    { url: 'https://consequence.net/feed/', cat: 'music' },
  stereogum:        { url: 'https://www.stereogum.com/feed/', cat: 'music' },
  // COMMUNITY MUSIC
  jesse_welles:     { url: 'https://jessewelles.substack.com/feed', cat: 'music' },
  mason_jennings:   { url: 'https://masonjennings.substack.com/feed', cat: 'music' },
  raffi:            { url: 'https://raffinews.com/feed/', cat: 'music' },
  americana_music:  { url: 'https://americanamusic.org/feed', cat: 'music' },
  folk_alley:       { url: 'https://folkalley.com/feed/', cat: 'music' },
  old_time_herald:  { url: 'https://oldtimeherald.org/feed/', cat: 'music' },
  jazztimes:        { url: 'https://jazztimes.com/feed/', cat: 'music' },
  downbeat:         { url: 'https://downbeat.com/feed/', cat: 'music' },
  nonesuch:         { url: 'https://www.nonesuch.com/journal/feed', cat: 'music' },
  emusician:        { url: 'https://www.emusician.com/feed/all/', cat: 'music' },
  // HOBBIES
  bonsaitonight:    { url: 'https://bonsaitonight.com/feed/', cat: 'hobbies' },
  bonsaiempire:     { url: 'https://www.bonsaiempire.com/feed', cat: 'hobbies' },
  herons:           { url: 'https://www.herons.co.uk/blog/feed/', cat: 'hobbies' },
  crataegus:        { url: 'https://crataegus.com/feed/', cat: 'hobbies' },
  electrek:         { url: 'https://electrek.co/feed/', cat: 'hobbies' },
  surronster:       { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCqBz3SVpb0er5iLIrGNBYcA', cat: 'hobbies' },
  ebr:              { url: 'https://electricbikereview.com/feed/', cat: 'hobbies' },
  micromob:    { url: 'https://micromobility.io/feed', cat: 'hobbies' },
  surron:           { url: 'https://www.surron.com/blogs/news.atom', cat: 'hobbies' },
  hackaday:         { url: 'https://hackaday.com/feed/', cat: 'hobbies' },
  instructables:    { url: 'https://www.instructables.com/feed/all/', cat: 'hobbies' },
  makezine:         { url: 'https://makezine.com/feed/', cat: 'hobbies' },
  atlasobscura:     { url: 'https://www.atlasobscura.com/feeds/latest', cat: 'hobbies' },
  seriouseats:      { url: 'https://www.seriouseats.com/feeds/all.xml', cat: 'hobbies' },
  woodgears:        { url: 'https://woodgears.ca/feed.xml', cat: 'hobbies' },
  ravelry:          { url: 'https://blog.ravelry.com/feed/', cat: 'hobbies' },
  thesprucearts:    { url: 'https://www.thesprucecrafts.com/feed/all/', cat: 'hobbies' },
  diy_photography:  { url: 'https://www.diyphotography.net/feed/', cat: 'hobbies' },
  analog_cafe:      { url: 'https://www.analogcafe.org/feed/', cat: 'hobbies' },
  // CONSCIOUSNESS
  doubleblind:      { url: 'https://doubleblindmag.com/feed/', cat: 'consciousness' },
  maps:             { url: 'https://maps.org/feed/', cat: 'consciousness' },
  thirdwave:        { url: 'https://thethirdwave.co/feed/', cat: 'consciousness' },
  chacruna:         { url: 'https://chacruna.net/feed/', cat: 'consciousness' },
  stamets:          { url: 'https://fungi.com/blogs/news.atom', cat: 'nature' },
  stamets_sub:      { url: 'https://paulstamets.substack.com/feed', cat: 'consciousness' },
  neurosciencenews: { url: 'https://neurosciencenews.com/feed/', cat: 'consciousness' },
  mindmatters:      { url: 'https://mindmatters.ai/feed/', cat: 'consciousness' },
  aeon_psych:       { url: 'https://aeon.co/feed.rss', cat: 'consciousness' },
  edge:             { url: 'https://www.edge.org/feed.xml', cat: 'consciousness' },
  iep:              { url: 'https://iep.utm.edu/feed/', cat: 'consciousness' },
  brainpickings:    { url: 'https://www.themarginalian.org/feed/', cat: 'consciousness' },
  nautilus:         { url: 'https://nautil.us/feed/', cat: 'consciousness' },
  // GAMING
  minecraft:        { url: 'https://www.minecraft.net/en-us/feeds/community-content/rss', cat: 'gaming' },
  xisuma:           { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCU9pX8hKcrx06XfOB-VQLdw', cat: 'gaming' },
  roblox:           { url: 'https://blog.roblox.com/feed/', cat: 'gaming' },
  kotaku:           { url: 'https://kotaku.com/rss', cat: 'gaming' },
  pcgamer:          { url: 'https://www.pcgamer.com/rss/', cat: 'gaming' },
  eurogamer:        { url: 'https://www.eurogamer.net/feed', cat: 'gaming' },
  rockpapershotgun: { url: 'https://www.rockpapershotgun.com/feed', cat: 'gaming' },
  ign:              { url: 'https://feeds.feedburner.com/ign/news', cat: 'gaming' },
  polygon:          { url: 'https://www.polygon.com/rss/index.xml', cat: 'gaming' },
  destructoid:      { url: 'https://www.destructoid.com/feed/', cat: 'gaming' },
  giantbomb:        { url: 'https://www.giantbomb.com/feeds/news/', cat: 'gaming' },
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

  // SPORTS
  espn:             { url: 'https://www.espn.com/espn/rss/news', cat: 'sports' },
  bbc_sport:        { url: 'https://feeds.bbci.co.uk/sport/rss.xml', cat: 'sports' },
  theathletic:      { url: 'https://theathletic.com/rss/', cat: 'sports' },
  guardian_sport:   { url: 'https://www.theguardian.com/sport/rss', cat: 'sports' },
  skysports:        { url: 'https://www.skysports.com/rss/12040', cat: 'sports' },
  deadspin:         { url: 'https://deadspin.com/rss', cat: 'sports' },
  si:               { url: 'https://www.si.com/rss/si_topstories.rss', cat: 'sports' },
  bleacherreport:   { url: 'https://bleacherreport.com/articles/feed', cat: 'sports' },
  cycling_weekly:   { url: 'https://www.cyclingweekly.com/feed', cat: 'sports' },
  running_magazine: { url: 'https://www.runnersworld.com/feed/all/', cat: 'sports' },
  surfline:         { url: 'https://www.surfline.com/surf-news/rss', cat: 'sports' },
  climbing_mag:     { url: 'https://www.climbing.com/feed/', cat: 'sports' },
  outside_sport:    { url: 'https://www.outsideonline.com/feed/?category=fitness', cat: 'sports' },
  ultiworld:        { url: 'https://ultiworld.com/feed/', cat: 'sports' },
  velonews:         { url: 'https://www.velonews.com/feed/', cat: 'sports' },
  swimswam:         { url: 'https://swimswam.com/feed/', cat: 'sports' },


  // OUTDOORS
  backpacker:       { url: 'https://www.backpacker.com/feed/', cat: 'outdoors' },
  rei_blog:         { url: 'https://www.rei.com/blog/feed', cat: 'outdoors' },
  adventure_alan:   { url: 'https://www.adventurealan.com/feed/', cat: 'outdoors' },
  thetrek:          { url: 'https://thetrek.co/feed/', cat: 'outdoors' },
  halfwayanywhere:  { url: 'https://www.halfwayanywhere.com/feed/', cat: 'outdoors' },
  outsideonline2:   { url: 'https://www.outsideonline.com/feed/?category=adventure', cat: 'outdoors' },
  outdoors_project: { url: 'https://www.outdoorproject.com/feed', cat: 'outdoors' },
  hikingproject:    { url: 'https://www.hikingproject.com/blog/feed', cat: 'outdoors' },
  bearfoottheory:   { url: 'https://bearfoottheory.com/feed/', cat: 'outdoors' },
  gearjunkie:       { url: 'https://gearjunkie.com/feed', cat: 'outdoors' },
  treeline_review:  { url: 'https://treelinebackpacker.com/feed/', cat: 'outdoors' },
  atlas_obscura2:   { url: 'https://www.atlasobscura.com/feeds/latest', cat: 'outdoors' },
  swimming_holes:   { url: 'https://www.swimmingholes.org/rss.xml', cat: 'outdoors' },
  campsites:        { url: 'https://thecampsite.co.uk/blog/feed/', cat: 'outdoors' },
  climbingnews:     { url: 'https://www.climbingnews.com/feed/', cat: 'outdoors' },

  // COMEDY
  comedy_wham:      { url: 'https://www.comedywham.com/feed/', cat: 'comedy' },
  nerdist_comedy:   { url: 'https://nerdist.com/tag/comedy/feed/', cat: 'comedy' },
  hard_times:       { url: 'https://thehardtimes.net/feed/', cat: 'comedy' },

  // ART
  juxtapoz:         { url: 'https://www.juxtapoz.com/rss/', cat: 'art' },
  artsy:            { url: 'https://www.artsy.net/rss', cat: 'art' },
  dezeen:           { url: 'https://www.dezeen.com/feed/', cat: 'art' },
  smithsonian_art:  { url: 'https://www.smithsonianmag.com/rss/arts-culture/', cat: 'art' },
  brainpickings2:   { url: 'https://www.themarginalian.org/feed/', cat: 'art' },
  openculture:      { url: 'https://www.openculture.com/feed', cat: 'art' },

  // FRONTIER SCIENCE
  qualia_inst:      { url: 'https://qualiaresearchinstitute.org/feed', cat: 'consciousness' },
  psyche_mag:       { url: 'https://psyche.co/feed', cat: 'consciousness' },
  integral_life:    { url: 'https://integrallife.com/feed/', cat: 'consciousness' },


  // COMEDY
  onion:            { url: 'https://www.theonion.com/rss', cat: 'comedy' },
  thedadsays:       { url: 'https://www.thebelonging.com/feed/', cat: 'comedy' },
  avclub:           { url: 'https://www.avclub.com/rss', cat: 'comedy' },

  // ART
  artnet:           { url: 'https://news.artnet.com/feed', cat: 'art' },
  creativeapplications: { url: 'https://www.creativeapplications.net/feed/', cat: 'art' },
  brain_pickings2:  { url: 'https://www.themarginalian.org/feed/', cat: 'art' },

  // FRONTIER SCIENCE
  consciousness_unbound: { url: 'https://www.consciousnessunbound.com/feed', cat: 'frontier' },
  iit_news:         { url: 'https://integratedinformationtheory.org/feed/', cat: 'frontier' },
  mindblog:         { url: 'https://dericbownds.net/feeds/posts/default', cat: 'frontier' },
  opentheory:       { url: 'https://www.opentheory.net/feed/', cat: 'frontier' },
  the_brainwave:    { url: 'https://www.brainwave.news/feed', cat: 'frontier' },
  slatestarcodex:   { url: 'https://www.astralcodexten.com/feed', cat: 'frontier' },
  andrewgelman:     { url: 'https://statmodeling.stat.columbia.edu/feed/', cat: 'frontier' },

  americana_uk:     { url: 'https://www.americanauk.com/feed/', cat: 'music' },
  no_depression:    { url: 'https://www.nodepression.com/feed/', cat: 'music' },
  jazz_times:       { url: 'https://jazztimes.com/feed/', cat: 'music' },
  all_about_jazz:   { url: 'https://www.allaboutjazz.com/rss.php', cat: 'music' },
  bluegrass_today:  { url: 'https://bluegrasstoday.com/feed/', cat: 'music' },
  cafe_mocha:       { url: 'https://cafemocharadio.com/feed/', cat: 'music' },

  // HOLOMETRY
  '3b1b':           { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCYO_jab_esuFRV4b17AJtAw', cat: 'holometry' },
  numberphile:      { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCoxcjq-8xIDTYp3uz647V5A', cat: 'holometry' },
  threeblueone:     { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCYO_jab_esuFRV4b17AJtAw', cat: 'holometry' },
  vsauce:           { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC6nSFpj9HTCZ5t-N3Rm3-HA', cat: 'holometry' },
  veritasium2:      { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA', cat: 'holometry' },
  standupmaths:     { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCSju5G2aFaWMqn-_0YBtq5A', cat: 'holometry' },
  wolfram:          { url: 'https://writings.stephenwolfram.com/feed/', cat: 'holometry' },
  scottaaronson:    { url: 'https://scottaaronson.blog/?feed=rss2', cat: 'holometry' },
  johncbaez:        { url: 'https://johncarlosbaez.wordpress.com/feed/', cat: 'holometry' },
  terrytao:         { url: 'https://terrytao.wordpress.com/feed/', cat: 'holometry' },
  quanta_math:      { url: 'https://api.quantamagazine.org/feed/?tags=mathematics', cat: 'holometry' },
  toe:              { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCdWIQh9DGG6uhJk8eyIFl1w', cat: 'holometry' },
  // VOICES: NEWS
  vspehar:          { url: 'https://underthedesknews.substack.com/feed', cat: 'news' },
  matthewcooke:     { url: 'https://matthewcooke.substack.com/feed', cat: 'news' },
  // VOICES: SCIENCE
  cgpgrey:          { url: 'https://cgpgrey.substack.com/feed', cat: 'science' },
  hankgreen:        { url: 'https://hank.substack.com/feed', cat: 'science' },
  tomscott:         { url: 'https://feeds.acast.com/public/shows/lateral-with-tom-scott', cat: 'science' },
  adamneely:        { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCnkp4xDOwqqJD7sSM3xdUiQ', cat: 'science' },
  // VOICES: HEALTH
  huberman:         { url: 'https://feeds.libsyn.com/428796/rss', cat: 'health' },
  peterattia:       { url: 'https://feeds.libsyn.com/436255/rss', cat: 'health' },
  rhondapatrick:    { url: 'https://feeds.libsyn.com/57636/rss', cat: 'health' },
  // VOICES: COMEDY
  daily_show_pod:   { url: 'https://feeds.simplecast.com/zKjsRn4B', cat: 'comedy' },
  lastweektonight:  { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC3XTzVzaHQEd30rQbuvCtTQ', cat: 'comedy' },
  billburr:         { url: 'https://billburr.libsyn.com/rss', cat: 'comedy' },
  office_ladies:    { url: 'https://feeds.acast.com/public/shows/office-ladies', cat: 'comedy' },
  snafu_edhelms:    { url: 'https://feeds.iheart.com/podcast/42678', cat: 'comedy' },
  goodhang_amy:     { url: 'https://feeds.megaphone.fm/goodhang', cat: 'comedy' },
  elle_cordova:     { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCxIkOW8jlSjBkfLj3KSExQg', cat: 'comedy' },
  isabel_hagen:     { url: 'https://isabelhagen.substack.com/feed', cat: 'comedy' },
  // VOICES: CONSCIOUSNESS
  soulboom:         { url: 'https://feeds.simplecast.com/jV_HNPFR', cat: 'consciousness' },
  jgl:              { url: 'https://journal.hitrecord.org/feed', cat: 'consciousness' },
  garronnoone:      { url: 'https://feeds.acast.com/public/shows/how-are-ye-gettin-on', cat: 'consciousness' },
  // VOICES: HOBBIES
  nickofferman:     { url: 'https://nickofferman.substack.com/feed', cat: 'hobbies' },
  // TECH
  hackernews:       { url: 'https://hnrss.org/frontpage', cat: 'tech' },
  simonw:           { url: 'https://simonwillison.net/atom/everything/', cat: 'tech' },
  benedictevans:    { url: 'https://www.ben-evans.com/benedictevans/rss.xml', cat: 'tech' },
  stratechery:      { url: 'https://stratechery.com/feed/', cat: 'tech' },
  wired:            { url: 'https://www.wired.com/feed/rss', cat: 'tech' },
  arstechnica:      { url: 'https://feeds.arstechnica.com/arstechnica/index', cat: 'tech' },
  theregister:      { url: 'https://www.theregister.com/headlines.atom', cat: 'tech' },
  techcrunch:       { url: 'https://techcrunch.com/feed/', cat: 'tech' },
  kottke:           { url: 'https://kottke.org/feed', cat: 'tech' },
  // VOICES: TECH
  lizdev:           { url: 'https://lizthe.dev/feed', cat: 'tech' },
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

async function fastVerifyBatch(articles, apiKey) {
  const prompt = `Analyze each news article from three independent angles. Return a JSON array with one object per article, in the same order.

${articles.map((a, i) => `Article ${i+1}: "${a.title}" (source: ${a.sourceId})`).join('\n')}

For each article, reason from 3 different perspectives (policy/legal, scientific/technical, economic/social, historical, affected parties). For each angle write one plain sentence. Like explaining to a smart friend. No jargon. No opinions. No loaded adjectives. Just what the evidence shows.

Then one sentence: what all three angles together force to be true. Specific to this story, not generic.

Then one sentence: what must also be true if that conclusion holds. Not yet reported. Required by the pattern.

Return ONLY a valid JSON array, no markdown:
[{"corridors":[{"angle":"2-4 word label","finding":"one plain sentence"}],"forced_fourth":"one plain sentence","extension":"one plain sentence"}]`;

  const response = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2400,
        messages: [{ role: 'user', content: prompt }]
      })
    }),
    CLAUDE_TIMEOUT_MS, `fastVerifyBatch ${articles.length} articles`
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'API error');
  let txt = '';
  if (data.content) data.content.forEach(b => { if (b.type === 'text') txt += b.text; });
  const match = txt.replace(/\`\`\`json|\`\`\`/g, '').trim().match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Could not parse JSON array');
  const results = JSON.parse(match[0]);
  if (!Array.isArray(results) || results.length !== articles.length) throw new Error('Result count mismatch');
  return results;
}

async function fastVerify(article, apiKey) {
  const results = await fastVerifyBatch([article], apiKey);
  return results[0];
}

export default async (req, context) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('[cron] No API key'); return new Response('No API key', { status: 500 }); }

  const verStore = getStore('verifications');
  const artStore = getStore('articles');
  const queueStore = getStore('worker_queue');

  // Load index
  let index;
  try { index = await withTimeout(artStore.get('_index_a', { type: 'json' }), BLOB_TIMEOUT_MS, 'load index'); }
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

  console.log(`[cron] ${candidates.length} candidates, verifying up to ${MAX_VERIFY_PER_RUN} in parallel`);

  const toVerify = candidates.slice(0, MAX_VERIFY_PER_RUN);
  const toQueue  = candidates.slice(MAX_VERIFY_PER_RUN);

  // Parallel fast verify in batches of 3
  const BATCH_SIZE = 3;
  const batches = [];
  for (let i = 0; i < toVerify.length; i += BATCH_SIZE) {
    batches.push(toVerify.slice(i, i + BATCH_SIZE));
  }
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
          id: article.key, title: article.title,
          source: article.sourceId, sourceId: article.sourceId,
          cat: article.cat, url: article.url, thumb: article.thumb,
          corridors: result.corridors, forced_fourth: result.forced_fourth, extension: result.extension,
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

  // Save index
  if (newEntries.length > 0) {
    index.articles = [...newEntries, ...index.articles];
    if (index.articles.length > 2000) index.articles = index.articles.slice(0, 2000);
    index.updated = new Date().toISOString();
    try { await withTimeout(artStore.setJSON('_index_a', index), BLOB_TIMEOUT_MS, 'save index'); }
    catch (e) { console.error(`[cron] Failed to save index: ${e.message}`); }
  }

  const summary = `[cron] Done. sources=${Object.keys(SOURCES).length} skipped=${stats.skippedSources} fetched=${stats.fetched} alreadyVerified=${stats.alreadyVerified} verified=${stats.verified} queued=${stats.queued} failed=${stats.failed}`;
  console.log(summary);
  return new Response(summary, { status: 200 });
};

export const config = { schedule: '*/10 * * * *' };
