// The feed parser reads other people's text: it has to cope with broken feeds, and a feed must
// not be able to keep the server busy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, stripHtml } from '../lib/parse.mjs';

const item = (inner) => `<rss version="2.0"><channel><title>Feed</title>${inner}</channel></rss>`;

test('RSS, RDF and Atom items are read', () => {
  const rss = parseFeed(item(`
    <item><title><![CDATA[First & <b>bold</b>]]></title><link> https://example.com/1 </link>
      <description>&lt;p&gt;Some &amp;amp; text&lt;/p&gt;&lt;img src="https://example.com/i.png"&gt;</description>
      <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate><source url="https://outlet.example">The Outlet</source></item>
    <ITEM><TITLE>Second</TITLE><guid>https://example.com/2</guid><enclosure type="image/jpeg" url="https://example.com/2.jpg"/></ITEM>
    <item><title>No link, so left out</title></item>`));
  assert.equal(rss.title, 'Feed');
  assert.deepEqual(rss.items, [
    { title: 'First & bold', outlet: 'The Outlet', link: 'https://example.com/1', published: '2024-01-01T10:00:00.000Z', summary: 'Some & text', image: 'https://example.com/i.png' },
    { title: 'Second', outlet: '', link: 'https://example.com/2', published: null, summary: '', image: 'https://example.com/2.jpg' },
  ]);

  const rdf = parseFeed('<rdf:RDF><channel><title>R</title></channel><item rdf:about="https://example.com/r"><title>From RDF</title><dc:date>2024-02-03T04:05:06Z</dc:date></item></rdf:RDF>');
  assert.deepEqual(rdf.items.map((i) => [i.title, i.link, i.published]), [['From RDF', 'https://example.com/r', '2024-02-03T04:05:06.000Z']]);

  const atom = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
    <entry><title type="html">An &lt;i&gt;entry&lt;/i&gt;</title><link rel="self" href="https://example.com/self"/><link href="https://example.com/a"/>
      <summary>Short</summary><updated>2024-03-04T05:06:07Z</updated><media:thumbnail url='https://example.com/t.jpg'/></entry></feed>`);
  assert.equal(atom.title, 'A');
  assert.deepEqual(atom.items, [{ title: 'An entry', outlet: '', link: 'https://example.com/a', published: '2024-03-04T05:06:07.000Z', summary: 'Short', image: 'https://example.com/t.jpg' }]);
});

test('broken markup is read the way it always was', () => {
  // An item that never closes ends the list; the ones before it still count.
  assert.deepEqual(parseFeed(item('<item><title>A</title><link>https://example.com/a</link></item><item><title>B</title><link>https://example.com/b</link>')).items.map((i) => i.title), ['A']);
  // A tag that never closes gives nothing, and the next name is tried.
  assert.equal(parseFeed(item('<item><title>T</title><link>https://example.com/1</link><description>never closed<summary>Used instead</summary></item>')).items[0].summary, 'Used instead');
  assert.equal(parseFeed(item('<item><title>T</title><titles>x</titles><link>https://example.com/1</link></item>')).items[0].title, 'T');
  assert.equal(stripHtml('a<script>x()</script>b<style>p{}</style>c<script>never closed'), 'abc never closed');
  assert.equal(stripHtml('1 <> 2 << 3 <b>4</b> 5 < 6'), '1 <> 2 4 5 < 6');
  assert.equal(stripHtml('<![CDATA[kept as text]]> &lt;b&gt;'), '<b>');
  assert.equal(parseFeed(item('<item><title>x <![CDATA[one]]> and <![CDATA[two]]> <![CDATA[open</title><link>https://example.com/1</link></item>')).items[0].title, 'x one and two <![CDATA[open');
});

test('a hostile feed cannot keep the server busy', () => {
  // Each of these took the old parser between 4 and 90 seconds at this size, growing with the
  // square of the length. They now take a few milliseconds.
  const size = 300 * 1024;
  const rep = (s) => s.repeat(Math.ceil(size / s.length));
  const one = (inner) => item(`<item><title>t</title><link>https://example.com/1</link>${inner}</item>`);
  const feeds = {
    'items that never close': '<rss><channel>' + rep('<item>'),
    'entries that never close': '<feed>' + rep('<entry>'),
    'titles that never close': item('<item>' + rep('<title>') + '</item>'),
    'a description full of "<"': one('<description>' + rep('<') + '</description>'),
    'a description full of "<script"': one('<description>' + rep('<script<style') + '</description>'),
    'CDATA that never closes': one('<description>' + rep('<![CDATA[') + '</description>'),
    'half-open tags': one(rep('<img <enclosure <media:content <link ')),
  };
  for (const [what, xml] of Object.entries(feeds)) {
    const started = process.hrtime.bigint();
    parseFeed(xml);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 2000, `${what}: took ${Math.round(ms)} ms`);
  }
});

test('oversized fields are cut down or dropped', () => {
  const long = 'word '.repeat(2000);
  const { title, items } = parseFeed(`<rss><channel><title>${long}</title>
    <item><title>${long}</title><link>https://example.com/1</link><source>${long}</source><description>${long}</description>
      <enclosure type="image/png" url="https://example.com/${'x'.repeat(5000)}.png"/></item>
    <item><title>Address too long</title><link>https://example.com/${'y'.repeat(5000)}</link></item>
    <item><title>Fine</title><link>https://example.com/${'z'.repeat(1500)}</link></item></channel></rss>`);
  assert.deepEqual(items.map((i) => i.title.slice(0, 4)), ['word', 'Fine'], 'an item whose address is too long is left out');
  const [i] = items;
  assert.ok(i.title.length <= 300 && i.title.endsWith('…'));
  assert.ok(title.length <= 300 && i.outlet.length <= 100 && i.summary.length <= 280);
  assert.equal(i.image, '');
});
