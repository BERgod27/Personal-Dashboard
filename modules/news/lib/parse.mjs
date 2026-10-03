// Minimal, dependency-free RSS 2.0 / RSS 1.0 (RDF) / Atom parser.
// Good enough for news headlines; not a general XML parser.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function unwrap(raw) {
  if (raw == null) return '';
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : decodeEntities(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}

export function stripHtml(html) {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// First matching tag's inner text. `names` may include namespaced tags like "dc:date".
function tag(block, ...names) {
  for (const n of names) {
    const re = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i');
    const m = block.match(re);
    if (m) return unwrap(m[1]).trim();
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
  if (enc && /^image\//i.test(attr(enc, 'type'))) return attr(enc, 'url');
  const img = block.match(/<img\b[^>]*>/i) || unwrap(block).match(/<img\b[^>]*>/i);
  return img ? attr(img[0], 'src') : '';
}

function toIso(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi) || [];
  const channelTitle = stripHtml(tag(xml.replace(/<(item|entry)\b[\s\S]*?<\/\1>/gi, ''), 'title'));

  const items = blocks.map((b) => {
    const title = stripHtml(tag(b, 'title'));
    const link = isAtom ? atomLink(b) : tag(b, 'link') || attr((b.match(/<item\b[^>]*>/i) || [''])[0], 'rdf:about') || tag(b, 'guid');
    const rawSummary = tag(b, 'description', 'summary', 'content:encoded', 'content');
    const summary = stripHtml(rawSummary);
    return {
      title,
      link: link.trim(),
      published: toIso(tag(b, 'pubDate', 'published', 'updated', 'dc:date')),
      summary: summary.length > 280 ? summary.slice(0, 277).replace(/\s+\S*$/, '') + '…' : summary,
      image: image(b),
    };
  }).filter((i) => i.title && i.link);

  return { title: channelTitle, items };
}
