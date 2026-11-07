// Groups headlines about the same event into stories, the way Google News does, and ranks them.
//
// Each headline becomes a TF-IDF vector of its title words (full weight) and the opening of its
// summary (half weight). Headlines are taken newest first; each joins the story it is most similar
// to (cosine against the story's combined vector) when that similarity clears a threshold, the two
// share at least two title words, and they were published within a day and a half of each other.
// Otherwise it starts a new story. Matching is word based, so English and Portuguese coverage of
// the same event stay separate stories. Dependency-free and deterministic.

const STOP = new Set(`
a about above after again against ago all also am an and any are as at be been before being below
between both but by can could did do does doing down during each few for from further had has have
having he her here hers him his how i if in into is it its just live me more most my new news no nor
not now of off on once only or other our out over own same says said she should so some such than that
the their them then there these they this those through to too under until up very was we were what
when where which while who whom why will with would you your update updates latest watch video photos
analysis opinion explainer
à às ao aos as com como da das de dei del depois do dos e é ela elas ele eles em entre era eram essa esse
esta este estão está eu foi foram há isso isto já lhe mais mas me mesmo meu muito na nas não nem no nos
nós num numa o os ou para pela pelas pelo pelos por porque quando que quem se sem ser seu seus sua suas
são só também te tem têm um uma umas uns vai vão sobre até ainda após diz dizem afirma anos ano novo nova
hoje ontem amanhã agora vídeo fotos direto última últimas
`.split(/\s+/).filter(Boolean).map(fold));

function fold(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// A crude stemmer that works for English and Portuguese alike: drop a plural "s", then keep the
// first five letters, so "fecha", "fecham" and "fechadas" or "elects" and "election" match.
function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return /^\d+$/.test(w) ? w : w.slice(0, 5);
}

export function words(text = '') {
  return tokens(text).map((t) => t.w);
}

// Words with a flag for names: capitalised mid-sentence ("Gaza", "Lagarde") or acronyms ("ECB").
// In Title Case headlines (most words capitalised) only acronyms count as names, and in
// all-caps headlines nothing does.
function tokens(text = '') {
  const out = [];
  const raws = String(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const share = (re) => (raws.length > 3 ? raws.filter((r) => re.test(r)).length / raws.length : 0);
  const titleCase = share(/^\p{Lu}/u) > 0.6;
  const allCaps = share(/^[\p{Lu}\d]{2,}$/u) > 0.6;
  raws.forEach((raw, i) => {
    const f = fold(raw);
    const acronym = !allCaps && raw.length >= 2 && /^[\p{Lu}\d]+$/u.test(raw) && /\p{Lu}/u.test(raw);
    if (!acronym && STOP.has(f)) return;
    if (f.length < 3 && !acronym && !/^\d{2,}$/.test(f)) return;
    const proper = acronym || (!titleCase && !allCaps && i > 0 && /^\p{Lu}/u.test(raw));
    out.push({ w: acronym ? f : stem(f), proper });
  });
  return out;
}

const SUMMARY_WORDS = 30;
const SUMMARY_WEIGHT = 0.5;
const NAME_BOOST = 1.6;
const WINDOW_MS = 36 * 3600e3;
const THRESHOLD = 0.39;
const MIN_SHARED_TITLE_WORDS = 2;
const HALF_LIFE_H = 16;

// Story ranking: more outlets covering it counts most; age halves the score every 16 hours.
export function storyScore(sourceCount, newestMs, nowMs) {
  const ageH = Math.max(0, (nowMs - newestMs) / 3600e3);
  return (1 + 1.5 * Math.log(Math.max(1, sourceCount))) * Math.pow(0.5, ageH / HALF_LIFE_H);
}

const timeOf = (item, fallback) => (item.published ? Date.parse(item.published) : fallback);

/**
 * @param {Array<{id:string,title:string,summary?:string,published?:string|null,image?:string,source:string,topic:string}>} items
 * @param {{now?: number, rankOf?: (item) => number}} opts  rankOf: lower = preferred lead (feeds.json order)
 * @returns stories sorted by score: {id, topic, topics, lead, related, sources, published, score, image}
 */
export function clusterStories(items, { now = Date.now(), rankOf = () => 0 } = {}) {
  // Document frequency of each word, counted once per headline.
  const docs = items.map((it) => {
    const title = tokens(it.title);
    const summary = tokens(it.summary).slice(0, SUMMARY_WORDS);
    const names = new Set([...title, ...summary].filter((t) => t.proper).map((t) => t.w));
    return { it, title: new Set(title.map((t) => t.w)), summary: new Set(summary.map((t) => t.w)), names, t: timeOf(it, now) };
  });
  const df = new Map();
  for (const d of docs) for (const w of new Set([...d.title, ...d.summary])) df.set(w, (df.get(w) || 0) + 1);
  const n = docs.length || 1;
  const idf = (w) => Math.log(1 + n / (df.get(w) || 1));

  for (const d of docs) {
    const v = new Map();
    const boost = (w) => (d.names.has(w) ? NAME_BOOST : 1);
    for (const w of d.summary) v.set(w, idf(w) * boost(w) * SUMMARY_WEIGHT);
    for (const w of d.title) v.set(w, idf(w) * boost(w));
    d.vec = v;
  }

  const order = [...docs].sort((a, b) => b.t - a.t);
  const groups = []; // { members: [doc], vec: Map (sum of member vectors), titleWords: Set, newest, oldest }
  for (const d of order) {
    let best = null;
    let bestSim = 0;
    for (const g of groups) {
      if (g.oldest - d.t > WINDOW_MS) continue;
      let shared = 0;
      for (const w of d.title) if (g.titleWords.has(w)) shared++;
      if (shared < MIN_SHARED_TITLE_WORDS) continue;
      const sim = cosine(d.vec, g.vec);
      if (sim > bestSim) { bestSim = sim; best = g; }
    }
    if (best && bestSim >= THRESHOLD) {
      best.members.push(d);
      for (const [w, x] of d.vec) best.vec.set(w, (best.vec.get(w) || 0) + x);
      for (const w of d.title) best.titleWords.add(w);
      best.oldest = Math.min(best.oldest, d.t);
      best.newest = Math.max(best.newest, d.t);
    } else {
      groups.push({ members: [d], vec: new Map(d.vec), titleWords: new Set(d.title), newest: d.t, oldest: d.t });
    }
  }

  const stories = groups.map((g) => {
    const members = g.members.map((m) => m.it);
    const lead = pickLead(members, rankOf);
    const related = members.filter((m) => m !== lead)
      .sort((a, b) => rankOf(a) - rankOf(b) || timeOf(b, now) - timeOf(a, now));
    const sources = new Set(members.map((m) => m.source)).size;
    const topics = countTopics(members, lead);
    return {
      id: 's' + lead.id,
      topic: topics[0],
      topics,
      lead: lead.id,
      related: related.map((m) => m.id),
      sources,
      published: Number.isFinite(g.newest) ? new Date(g.newest).toISOString() : null,
      score: Math.round(storyScore(sources, g.newest, now) * 1000) / 1000,
    };
  });
  return stories.sort((a, b) => b.score - a.score || (b.published || '').localeCompare(a.published || ''));
}

// The headline that fronts a story: one with a picture and a summary, from the outlet listed first.
function pickLead(members, rankOf) {
  const worth = (m) => (m.image ? 2 : 0) + (m.summary ? 1 : 0);
  return [...members].sort((a, b) => worth(b) - worth(a) || rankOf(a) - rankOf(b) || timeOf(a, 0) - timeOf(b, 0))[0];
}

// Topics a story belongs to, most covered first; ties go to the lead's topic.
function countTopics(members, lead) {
  const count = new Map();
  for (const m of members) count.set(m.topic, (count.get(m.topic) || 0) + 1);
  return [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || (b === lead.topic) - (a === lead.topic));
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [w, x] of small) { const y = large.get(w); if (y) dot += x * y; }
  for (const x of a.values()) na += x * x;
  for (const x of b.values()) nb += x * x;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Top stories: the best-ranked stories, at most `perTopic` from any one topic so sport or
// business can't take over the front page.
export function pickTopStories(stories, { count = 10, perTopic = 3 } = {}) {
  const used = new Map();
  const out = [];
  for (const s of stories) {
    if (out.length >= count) break;
    const k = used.get(s.topic) || 0;
    if (k >= perTopic) continue;
    used.set(s.topic, k + 1);
    out.push(s.id);
  }
  return out;
}
