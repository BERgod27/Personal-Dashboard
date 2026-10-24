// Tutor: the context built from the user's data, message checks, and the /api/tutor route end to
// end against a fake Claude API (ANTHROPIC_BASE_URL), with and without an API key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext, checkMessages, tutorConfig, DEFAULT_MODEL } from '../tutor.mjs';
import { startFakeGoogle, fakeGoogleEnv, googleSignIn } from './fake-google.mjs';

const NOW = Date.parse('2026-10-05T10:00:00+01:00'); // a Monday

const dash = {
  events: [
    { id: 'a', title: 'Gym', date: '2026-09-28', start: '18:00', end: '19:00', category: 'workout', weekly: true },
    { id: 'b', title: 'Dentist', date: '2026-10-07', start: '15:00', category: 'personal' },
    { id: 'c', title: 'Example thing', date: '2026-10-06', start: '09:00', sample: true },
  ],
  tasks: [{ id: 't', title: 'Finish LBAW report', due: '2026-10-09', done: false, category: 'uni' }],
  notes: { '2026-10-04': 'Felt tired' },
  modules: { workout: { unit: 'kg', sessions: [{ date: '2026-10-03', title: 'Push', exercises: [{ name: 'Bench press', sets: [{ reps: 8, weight: 60 }, { reps: 8, weight: 60 }] }] }] } },
};
const meals = {
  goals: { kcal: 2200, protein: 140, carbs: 250, fat: 70 },
  customFoods: [], meals: [],
  log: { '2026-10-04': { lunch: [{ name: 'Frango grelhado', grams: 200, kcal: 330, protein: 62, carbs: 0, fat: 7 }] } },
  plan: {},
};
const uni = {
  generated_at: '2026-10-05T08:00+01:00',
  profile: { name: 'Bernardo Teste', programmes: [{ name: 'L.EIC', year: '3', faculty: 'feup' }] },
  courses: [{ acronym: 'ES', name: 'Engenharia de Software', ects: 6 }],
  classes: [{ course: 'ES', type: 'TP', room: 'B208', start: '2026-10-06T08:30+01:00', end: '2026-10-06T10:30+01:00' }],
  deadlines: [{ course: 'ES', title: 'Relatório intercalar is due', due: '2026-10-10T23:59+01:00' }],
  exams: [{ course: 'ES', course_name: 'Engenharia de Software', start: '2027-01-11T09:00+00:00', end: '2027-01-11T12:00+00:00', rooms: ['B104'] }],
};

test('the context holds the user\'s uni, planner, workout and meal data, minus examples', () => {
  const ctx = buildContext({
    docs: { 'personal-dashboard.v1': JSON.stringify(dash), 'pd.meals.v1': JSON.stringify(meals) },
    uni, news: { items: [{ title: 'Big headline', source: 'RTP', category: 'portugal' }] }, nowMs: NOW,
  });
  assert.match(ctx, /Today is Monday, 5 October 2026 \(2026-10-05\)/);
  assert.match(ctx, /Tue 6 Oct, 08:30-10:30 ES \(TP\) room B208/);
  assert.match(ctx, /Relatório intercalar/);
  assert.match(ctx, /Exams:\n- Mon 11 Jan, 09:00-12:00 ES \(Engenharia de Software\)/);
  assert.match(ctx, /Mondays 18:00-19:00 Gym/);
  assert.match(ctx, /2026-10-07 15:00 Dentist/);
  assert.match(ctx, /Finish LBAW report \(due 2026-10-09\)/);
  assert.match(ctx, /2026-10-04: Felt tired/);
  assert.match(ctx, /2026-10-03 Push: Bench press 8×60, 8×60/);
  assert.match(ctx, /2026-10-04: 330 kcal, P 62 g.*Frango grelhado 200g/);
  assert.match(ctx, /Big headline \(RTP/);
  assert.doesNotMatch(ctx, /Example thing/, 'sample entries are left out');
});

test('an empty account still gives a usable context', () => {
  const ctx = buildContext({ nowMs: NOW });
  assert.match(ctx, /Uni[^\n]*\nNot synced yet/);
  assert.match(ctx, /No sessions logged yet/);
});

test('chat history must alternate and end with a question', () => {
  assert.deepEqual(checkMessages([{ role: 'user', content: ' hi ' }]), [{ role: 'user', content: 'hi' }]);
  assert.throws(() => checkMessages([]), /Ask a question/);
  assert.throws(() => checkMessages([{ role: 'assistant', content: 'x' }]), /malformed/);
  assert.throws(() => checkMessages([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]), /last message/);
  assert.throws(() => checkMessages([{ role: 'user', content: 'x'.repeat(9000) }]), /under 8000/);
  assert.throws(() => checkMessages([{ role: 'system', content: 'x' }]), /malformed/);
});

test('model and effort come from the environment, with safe defaults', () => {
  assert.deepEqual(tutorConfig({}), { configured: false, model: DEFAULT_MODEL, effort: 'medium' });
  assert.deepEqual(tutorConfig({ ANTHROPIC_API_KEY: 'k', TUTOR_MODEL: 'claude-sonnet-5-5', TUTOR_EFFORT: 'low' }), { configured: true, model: 'claude-sonnet-5-5', effort: 'low' });
  assert.equal(tutorConfig({ TUTOR_EFFORT: 'bogus' }).effort, 'medium');
});

// ---------------------------------------------------------------- end to end

const seen = [];
let reply = 'ok';
let failWith = 0;
const fakeApi = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
    if (failWith) {
      res.writeHead(failWith, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    for (const piece of reply.match(/.{1,4}/gs)) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: piece } });
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } });
    ev('message_stop', {});
    res.end();
  });
});

const dir = mkdtempSync(join(tmpdir(), 'pd-tutor-'));
const procs = [];
async function startServer(port, extra) {
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), APP_SECRET: 'y'.repeat(48), SQLITE_PATH: join(dir, `db-${port}.sqlite`), ...fakeGoogleEnv(google, base, 'bernardo@example.com'), ...extra };
  delete env.DATABASE_URL;
  if (!extra.ANTHROPIC_API_KEY) delete env.ANTHROPIC_API_KEY;
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', new URL('../server.mjs', import.meta.url).pathname], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  procs.push(proc);
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('http://localhost')) resolve(); });
    proc.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
  const { session: cookie } = await googleSignIn(base, google, { sub: '42', email: 'bernardo@example.com' });
  const call = (method, path, body) => fetch(base + path, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { base, call };
}

let withKey;
let noKey;
let google;
before(async () => {
  google = await startFakeGoogle({ clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'test-secret' });
  await new Promise((r) => fakeApi.listen(0, '127.0.0.1', r));
  const port = 19000 + Math.floor(Math.random() * 800);
  withKey = await startServer(port, { ANTHROPIC_API_KEY: 'sk-test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${fakeApi.address().port}`, TUTOR_PER_HOUR: '4' });
  noKey = await startServer(port + 1, {});
});
after(() => { procs.forEach((p) => p.kill()); fakeApi.close(); google?.close(); rmSync(dir, { recursive: true, force: true }); });

const lines = (text) => text.trim().split('\n').map((l) => JSON.parse(l));

test('without an API key the tutor says how to set it up', async () => {
  assert.deepEqual(await (await noKey.call('GET', '/api/tutor')).json(), { configured: false, model: DEFAULT_MODEL });
  const r = await noKey.call('POST', '/api/tutor', { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.status, 503);
  const j = await r.json();
  assert.equal(j.setup, true);
  assert.match(j.error, /ANTHROPIC_API_KEY/);
});

test('signed-out and cross-site requests are refused', async () => {
  const anon = await fetch(withKey.base + '/api/tutor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"messages":[{"role":"user","content":"hi"}]}' });
  assert.equal(anon.status, 401);
  const cross = await fetch(withKey.base + '/api/tutor', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
  assert.equal(cross.status, 403);
});

test('a question streams the answer, with the user\'s data sent to Claude', async () => {
  await withKey.call('PUT', '/api/state/personal-dashboard.v1', { value: JSON.stringify(dash), baseVersion: 0 });
  reply = 'Your next class is **ES** on Tuesday.';
  const r = await withKey.call('POST', '/api/tutor', { messages: [{ role: 'user', content: 'What is next?' }], view: 'uni' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /ndjson/);
  const out = lines(await r.text());
  assert.equal(out.filter((o) => o.t).map((o) => o.t).join(''), reply);
  assert.deepEqual(out.at(-1), { done: true, stop: 'end_turn' });

  const sent = seen.at(-1);
  assert.equal(sent.url, '/v1/messages?beta=true');
  assert.equal(sent.headers['x-api-key'], 'sk-test-key');
  assert.match(sent.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(sent.body.model, DEFAULT_MODEL);
  assert.equal(sent.body.stream, true);
  assert.equal(sent.body.fallbacks, 'default');
  assert.deepEqual(sent.body.output_config, { effort: 'medium' });
  assert.match(sent.body.system[1].text, /Finish LBAW report/);
  assert.deepEqual(sent.body.system[1].cache_control, { type: 'ephemeral' });
  const last = sent.body.messages.at(-1);
  assert.equal(last.role, 'user');
  assert.match(last.content[0].text, /Local time: .*He has the uni tab open/);
  assert.equal(last.content[1].text, 'What is next?');
});

test('API failures become a plain message and never leak the key', async () => {
  failWith = 401;
  const r = await withKey.call('POST', '/api/tutor', { messages: [{ role: 'user', content: 'hi' }] });
  failWith = 0;
  const text = await r.text();
  assert.match(lines(text).at(-1).error, /API key on the server was refused/);
  assert.doesNotMatch(text, /sk-test-key/);
});

test('questions are rate limited per user', async () => {
  let last;
  for (let i = 0; i < 4; i++) last = await withKey.call('POST', '/api/tutor', { messages: [{ role: 'user', content: 'again' }] });
  assert.equal(last.status, 429);
  assert.equal((await withKey.call('POST', '/api/tutor', { messages: [{ role: 'assistant', content: 'x' }] })).status, 400);
});
