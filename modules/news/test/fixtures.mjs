// Local sample feeds (RSS 2.0, Atom, RDF, broken) for offline testing: node test/fixtures.mjs
import http from 'node:http';
const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Sample RSS</title>
<item><title><![CDATA[Leaders meet in Lisbon &amp; agree deal]]></title><link>https://example.com/a</link><pubDate>Sat, 03 Oct 2026 00:34:11 +0000</pubDate>
<description><![CDATA[<p>Talks <b>ended</b> late.</p>]]></description><media:thumbnail url="https://example.com/a.jpg"/></item>
<item><title>Old story</title><link>https://example.com/old</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
<item><title>Evil link</title><link>javascript:alert(1)</link><pubDate>Sat, 03 Oct 2026 00:34:11 +0000</pubDate></item>
<item><title>Reuters story - Reuters</title><link>https://example.com/r</link><pubDate>Sat, 03 Oct 2026 00:34:11 +0000</pubDate></item>
</channel></rss>`;
const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Sample Atom</title>
<entry><title type="html">Governo aprova orçamento &#8212; detalhes</title><link rel="alternate" href="https://example.pt/b"/><updated>2026-10-03T00:34:11Z</updated><summary>Resumo da notícia.</summary></entry>
<entry><title>Leaders meet in Lisbon &amp; agree deal</title><link href="https://example.pt/dup"/><updated>2026-10-03T00:34:11Z</updated></entry>
</feed>`;
const rdf = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Sample RDF</title></channel><item rdf:about="https://example.de/c"><title>DW style item</title><link>https://example.de/c</link><dc:date>2026-10-03T00:34:11Z</dc:date></item></rdf:RDF>`;
http.createServer((req, res) => {
  const body = { '/rss': rss, '/atom': atom, '/rdf': rdf, '/html': '<html>not a feed</html>' }[req.url.split('?')[0]];
  if (!body) { res.writeHead(500); return res.end(); }
  res.writeHead(200, { 'content-type': 'application/xml' }); res.end(body);
}).listen(9911, () => console.log('fixtures on :9911'));
