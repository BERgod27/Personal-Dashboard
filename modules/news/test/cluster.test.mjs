// Story grouping and ranking: node --test modules/news/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterStories, pickTopStories, words, storyScore } from '../lib/cluster.mjs';
import { SAMPLE, NOW } from './stories.sample.mjs';

const byId = new Map(SAMPLE.map((h) => [h.id, h]));
const membersOf = (s) => [s.lead, ...s.related].map((id) => byId.get(id));

test('headlines about the same event become one story, and different events stay apart', () => {
  const stories = clusterStories(SAMPLE, { now: NOW });
  const storyOf = new Map();
  for (const s of stories) for (const m of membersOf(s)) storyOf.set(m.id, s.id);
  assert.equal(storyOf.size, SAMPLE.length, 'every headline is in exactly one story');
  for (const a of SAMPLE) {
    for (const b of SAMPLE) {
      if (a === b) continue;
      const together = storyOf.get(a.id) === storyOf.get(b.id);
      const sameEvent = Boolean(a.group) && a.group === b.group;
      assert.equal(together, sameEvent, `${sameEvent ? 'should group' : 'should not group'}: "${a.title}" / "${b.title}"`);
    }
  }
});

test('a story is fronted by a headline with a picture and ranked by outlets and freshness', () => {
  const stories = clusterStories(SAMPLE, { now: NOW });
  const gaza = stories[0];
  assert.equal(byId.get(gaza.lead).title, 'Israel and Hamas agree to Gaza ceasefire deal', 'the headline with an image leads');
  assert.equal(gaza.sources, 4);
  assert.equal(gaza.topic, 'world');
  assert.deepEqual(gaza.topics, ['world']);
  assert.equal(gaza.related.length, 3);
  assert.equal(gaza.published, new Date(NOW - 3600e3).toISOString(), 'published is the newest member');
  for (let i = 1; i < stories.length; i++) assert.ok(stories[i - 1].score >= stories[i].score, 'sorted by score');
  const single = stories.find((s) => byId.get(s.lead).title.startsWith('Hurricane'));
  assert.equal(single.sources, 1);
  assert.deepEqual(single.related, []);
});

test('a story takes the topic most of its coverage comes from', () => {
  const mixed = [
    { id: 'a', source: 'BBC News', topic: 'world', title: 'Volcano erupts in Iceland, flights grounded', published: new Date(NOW).toISOString() },
    { id: 'b', source: 'FT', topic: 'business', title: 'Iceland volcano erupts as flights grounded across Europe', published: new Date(NOW).toISOString() },
    { id: 'c', source: 'Guardian', topic: 'business', title: 'Flights grounded after Iceland volcano erupts', published: new Date(NOW).toISOString() },
  ];
  const [s] = clusterStories(mixed, { now: NOW });
  assert.equal(s.related.length, 2);
  assert.equal(s.topic, 'business');
  assert.deepEqual(s.topics, ['business', 'world']);
});

test('the outlet listed first in feeds.json leads when pictures and summaries are equal', () => {
  const rank = { 'Late Outlet': 5, 'First Outlet': 0 };
  const items = [
    { id: 'x', source: 'Late Outlet', topic: 'world', title: 'Earthquake strikes central Chile, tsunami warning issued', published: new Date(NOW).toISOString() },
    { id: 'y', source: 'First Outlet', topic: 'world', title: 'Chile earthquake: tsunami warning issued after strong quake strikes', published: new Date(NOW - 60e3).toISOString() },
  ];
  const [s] = clusterStories(items, { now: NOW, rankOf: (i) => rank[i.source] });
  assert.equal(s.lead, 'y');
});

test('headlines without dates or summaries still group', () => {
  const items = [
    { id: '1', source: 'A', topic: 'world', title: 'Pope Leo visits Lisbon for World Youth Day' },
    { id: '2', source: 'B', topic: 'world', title: 'Pope Leo arrives in Lisbon for World Youth Day', published: null },
  ];
  const stories = clusterStories(items, { now: NOW });
  assert.equal(stories.length, 1);
  assert.equal(stories[0].published, new Date(NOW).toISOString());
  assert.deepEqual(clusterStories([], { now: NOW }), []);
});

test('top stories keep a mix of topics', () => {
  const stories = ['world', 'world', 'world', 'world', 'sports', 'business'].map((topic, i) => ({ id: 's' + i, topic, score: 10 - i }));
  assert.deepEqual(pickTopStories(stories, { count: 5, perTopic: 3 }), ['s0', 's1', 's2', 's4', 's5']);
  assert.deepEqual(pickTopStories(stories, { count: 2 }), ['s0', 's1']);
});

test('words folds accents and inflections and drops filler words', () => {
  assert.deepEqual(words('Orçamento do Estado aprovado na generalidade'), ['orcam', 'estad', 'aprov', 'gener']);
  assert.deepEqual(words('ECB cuts interest rates: what it means for you'), ['ecb', 'cut', 'inter', 'rate', 'mean']);
  assert.deepEqual(words('UN and EU leaders meet in 2026'), ['un', 'eu', 'leade', 'meet', '2026']);
  assert.deepEqual(new Set([words('fecha'), words('fecham'), words('fechadas')].map(String)).size, 1);
});

test('more outlets and fresher stories score higher', () => {
  assert.ok(storyScore(4, NOW, NOW) > storyScore(1, NOW, NOW));
  assert.ok(storyScore(2, NOW, NOW) > storyScore(2, NOW - 6 * 3600e3, NOW));
  assert.ok(Math.abs(storyScore(1, NOW - 16 * 3600e3, NOW) - 0.5) < 1e-9, 'halves every 16 hours');
});
