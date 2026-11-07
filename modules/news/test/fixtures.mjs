// Local sample feeds (RSS 2.0, Atom, RDF, Google News, broken) for offline testing: node test/fixtures.mjs
// Also imported by the tests, which start it on a free port with start(0).
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toUTCString();
const rss = () => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Sample RSS</title>
<item><title><![CDATA[Leaders meet in Lisbon &amp; agree climate deal]]></title><link>https://example.com/a</link><pubDate>${hoursAgo(1)}</pubDate>
<description><![CDATA[<p>Talks <b>ended</b> late in Lisbon with a climate deal.</p>]]></description><media:thumbnail url="https://example.com/a.jpg"/></item>
<item><title>Old story</title><link>https://example.com/old</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
<item><title>Evil link</title><link>javascript:alert(1)</link><pubDate>${hoursAgo(1)}</pubDate></item>
<item><title>Earthquake strikes central Chile, tsunami warning issued</title><link>https://example.com/q</link><pubDate>${hoursAgo(3)}</pubDate>
<description>A strong quake hit near Santiago.</description><enclosure url="https://example.com/q.jpg" type="image/jpeg" length="0"/></item>
</channel></rss>`;
const gn = () => `<?xml version="1.0"?><rss version="2.0"><channel><title>Google News</title>
<item><title>Chile earthquake: tsunami warning issued after strong quake strikes - Reuters</title><link>https://news.google.com/rss/articles/q1</link><pubDate>${hoursAgo(2)}</pubDate>
<description>&lt;a href="https://news.google.com/rss/articles/q1"&gt;Chile earthquake&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;Reuters&lt;/font&gt;</description><source url="https://www.reuters.com">Reuters</source></item>
<item><title>Earthquake strikes central Chile, tsunami warning issued - Sample RSS</title><link>https://news.google.com/rss/articles/q2</link><pubDate>${hoursAgo(3)}</pubDate><source url="https://example.com">Sample RSS</source></item>
<item><title>Benfica - Sporting: dérbi termina empatado - Record</title><link>https://news.google.com/rss/articles/d1</link><pubDate>${hoursAgo(5)}</pubDate><source url="https://www.record.pt">Record</source></item>
</channel></rss>`;
const atom = () => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Sample Atom</title>
<entry><title type="html">Governo aprova orçamento &#8212; detalhes</title><link rel="alternate" href="https://example.pt/b"/><updated>${new Date(Date.now() - 4 * 3600e3).toISOString()}</updated><summary>Resumo da notícia.</summary><source><title>Not an outlet</title></source></entry>
<entry><title>Leaders meet in Lisbon &amp; agree climate deal</title><link href="https://example.pt/dup"/><updated>${new Date().toISOString()}</updated></entry>
</feed>`;
const rdf = () => `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Sample RDF</title></channel><item rdf:about="https://example.de/c"><title>Climate deal agreed as leaders meet in Lisbon</title><link>https://example.de/c</link><dc:date>${new Date(Date.now() - 2 * 3600e3).toISOString()}</dc:date></item></rdf:RDF>`;

export function start(port = 9911) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const body = { '/rss': rss, '/gn': gn, '/atom': atom, '/rdf': rdf, '/html': () => '<html>not a feed</html>' }[req.url.split('?')[0]];
      if (!body) { res.writeHead(500); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/xml' }); res.end(body());
    });
    server.listen(port, () => resolve(server));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start().then(() => console.log('fixtures on :9911'));
