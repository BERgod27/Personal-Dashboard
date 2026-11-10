// Minimal, dependency-free RSS 2.0 / RSS 1.0 (RDF) / Atom parser.
// Good enough for news headlines; not a general XML parser.
//
// A feed is someone else's text and may be broken or hostile, so every step here takes time in
// proportion to the feed's length. A lazy pattern such as /<item\b[\s\S]*?<\/item>/ does not:
// when the closing tags are missing, every opening tag searches to the end of the text again,
// and a 100 KB feed kept the whole server busy for ten seconds. So the helpers below find an
// opening tag, look for its closing tag once, and only ever move forward.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      // Past the last code point, String.fromCodePoint throws, and one bad "&#99999999;" would
      // lose the whole feed: leave it as written.
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Every "<name ...</name>" stretch for the given tag names, leftmost first, and the text around
// them. `after` is what must follow the name in an opening tag ('\\b': the whole name).
// The same as matching /<(name)\b[\s\S]*?<\/\1>/gi, in one pass.
function cut(text, names, after = '\\b') {
  const open = new RegExp(`<(${names.join('|')})${after}`, 'gi');
  const close = {};
  const unclosed = new Set(); // names with no closing tag from here on: later ones have none either
  const blocks = [];
  let rest = '';
  let from = 0;
  for (let m; unclosed.size < names.length && (m = open.exec(text));) {
    const name = m[1].toLowerCase();
    if (unclosed.has(name)) continue;
    const end = (close[name] ||= new RegExp(`</${name}>`, 'gi'));
    end.lastIndex = open.lastIndex;
    if (!end.exec(text)) { unclosed.add(name); continue; }
    blocks.push(text.slice(m.index, end.lastIndex));
    rest += text.slice(from, m.index);
    from = open.lastIndex = end.lastIndex;
  }
  return { blocks, rest: rest + text.slice(from) };
}

// The text with its CDATA marks taken off. The same as replacing /<!\[CDATA\[([\s\S]*?)\]\]>/g
// with what it wraps.
function dropCdataMarks(s) {
  const OPEN = '<![CDATA[';
  const CLOSE = ']]>';
  let out = '';
  let from = 0;
  for (let i; (i = s.indexOf(OPEN, from)) !== -1;) {
    const j = s.indexOf(CLOSE, i + OPEN.length);
    if (j === -1) break; // never closed, so no later one is closed either
    out += s.slice(from, i) + s.slice(i + OPEN.length, j);
    from = j + CLOSE.length;
  }
  return out + s.slice(from);
}

// A space in place of every tag. The same as replacing /<[^>]+>/g.
function dropTags(s) {
  let out = '';
  let from = 0;
  for (let i = 0; (i = s.indexOf('<', i)) !== -1;) {
    const j = s.indexOf('>', i + 1);
    if (j === -1) break; // no ">" left, so nothing after this is a tag
    if (j === i + 1) { i = j; continue; } // "<>" is not a tag
    out += s.slice(from, i) + ' ';
    from = i = j + 1;
  }
  return out + s.slice(from);
}

function unwrap(raw) {
  if (raw == null) return '';
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : decodeEntities(dropCdataMarks(raw));
}

export function stripHtml(html) {
  return decodeEntities(dropTags(cut(html, ['script', 'style'], '').rest))
    .replace(/\s+/g, ' ')
    .trim();
}

// First matching tag's inner text. `names` may include namespaced tags like "dc:date".
// The same as matching /<name(?:\s[^>]*)?>([\s\S]*?)<\/name>/i for each name in turn.
function tag(block, ...names) {
  for (const n of names) {
    const open = new RegExp(`<${n}[\\s>]`, 'i').exec(block);
    if (!open) continue;
    const last = open.index + open[0].length - 1;
    const gt = block[last] === '>' ? last : block.indexOf('>', last);
    if (gt === -1) continue;
    const close = new RegExp(`</${n}>`, 'gi');
    close.lastIndex = gt + 1;
    const end = close.exec(block);
    if (end) return unwrap(block.slice(gt + 1, end.index)).trim();
  }
  return '';
}

function attr(tagText, name) {
  const m = tagText.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3]) : '';
}

function atomLink(block) {
  const links = block.match(/<link\b[^>]*\/?>/gi) || [];
  let fallback = '';
  for (const l of links) {
    const href = attr(l, 'href');
    if (!href) continue;
    const rel = attr(l, 'rel');
    if (!rel || rel === 'alternate') return href;
    fallback ||= href;
  }
  return fallback;
}

function image(block) {
  const media = block.match(/<media:(?:content|thumbnail)\b[^>]*>/i);
  if (media && attr(media[0], 'url')) return attr(media[0], 'url');
  const enc = block.match(/<enclosure\b[^>]*>/i);
  if (enc && /^image\//i.test(attr(enc[0], 'type'))) return attr(enc[0], 'url');
  const img = block.match(/<img\b[^>]*>/i) || unwrap(block).match(/<img\b[^>]*>/i);
  return img ? attr(img[0], 'src') : '';
}

function toIso(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Longer than any real headline, outlet name or address. Without these a feed could hand over
// megabytes of "title" for the story grouping, the database and the browser to carry.
const MAX_TITLE = 300;
const MAX_OUTLET = 100;
const MAX_SUMMARY = 280;
const MAX_URL = 4000;

const clip = (s, max) => (s.length > max ? s.slice(0, max - 3).replace(/\s+\S*$/, '') + '…' : s);
const url = (s) => (s.length > MAX_URL ? '' : s);

export function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const { blocks } = cut(xml, [isAtom ? 'entry' : 'item']);
  const channelTitle = clip(stripHtml(tag(cut(xml, ['item', 'entry']).rest, 'title')), MAX_TITLE);

  const items = blocks.map((b) => {
    const link = isAtom ? atomLink(b) : tag(b, 'link') || attr((b.match(/<item\b[^>]*>/i) || [''])[0], 'rdf:about') || tag(b, 'guid');
    return {
      title: clip(stripHtml(tag(b, 'title')), MAX_TITLE),
      // Aggregators (Google News) name the real outlet in <source>; Atom's <source> is something else.
      outlet: isAtom ? '' : clip(stripHtml(tag(b, 'source')), MAX_OUTLET),
      link: url(link.trim()), // an item without a link is left out below
      published: toIso(tag(b, 'pubDate', 'published', 'updated', 'dc:date')),
      summary: clip(stripHtml(tag(b, 'description', 'summary', 'content:encoded', 'content')), MAX_SUMMARY),
      image: url(image(b)),
    };
  }).filter((i) => i.title && i.link);

  return { title: channelTitle, items };
}
