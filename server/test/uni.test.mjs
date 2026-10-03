import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, moodleEventsToItems, syncMoodleIcs, manualClasses, build, forClient, iso, zoned } from '../uni.mjs';

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:101@moodle.up.pt', 'SUMMARY:Projeto 1 is due', 'DESCRIPTION:Submit the report\\, PDF only',
  'CATEGORIES:LEIC-ES', 'DTSTART:20261010T225900Z', 'DTEND:20261010T225900Z', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:102@moodle.up.pt', 'SUMMARY:Mini-teste 2 closes', 'CATEGORIES:LEIC-AM',
  'DTSTART;TZID=Europe/Lisbon:20261014T180000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:103@moodle.up.pt', 'SUMMARY:Sessão de esclarecimento sobre o projeto com uma linha muito compr',
  ' ida que foi dobrada', 'CATEGORIES:LEIC-ES', 'DTSTART;VALUE=DATE:20261012', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');

test('Moodle ICS: parse and split into deadlines and events (same results as sync_uni.py)', () => {
  const events = parseIcs(ICS);
  assert.equal(events.length, 3);
  assert.equal(events[0].description, 'Submit the report, PDF only');
  assert.ok(events[2].summary.endsWith('comprida que foi dobrada'));
  const { deadlines, events: others } = moodleEventsToItems(events);
  assert.deepEqual(deadlines.map((d) => d.title), ['Projeto 1 is due', 'Mini-teste 2 closes']);
  assert.equal(deadlines[0].due, '2026-10-10T23:59+01:00');
  assert.equal(deadlines[1].due, '2026-10-14T18:00+01:00');
  assert.equal(deadlines[0].course, 'LEIC-ES');
  assert.equal(others.length, 1);
  assert.equal(others[0].all_day, true);
});

test('Moodle links are only followed to allowed hosts', async () => {
  await assert.rejects(syncMoodleIcs('http://moodle.up.pt/x'), /only the university's own sites/);
  await assert.rejects(syncMoodleIcs('https://evil.example/x', { allowed: (u) => u.hostname.endsWith('.up.pt') }), /evil\.example/);
});

test('winter time uses +00:00', () => {
  assert.equal(iso(zoned(2026, 12, 1, 9, 0)), '2026-12-01T09:00+00:00');
});

test('manual timetable CSV repeats each week', () => {
  const csv = 'day,start,end,course,type,room,teacher\nMon,08:30,10:30,ES,TP,B208,ABC\nTue,09:00,11:00,LBAW,PL,I105,TBS\nbad,row';
  const out = manualClasses(csv, 2, { y: 2026, m: 10, d: 7 });
  assert.equal(out.length, 4);
  assert.equal(out[0].start, '2026-10-05T08:30+01:00');
  assert.equal(out[1].start, '2026-10-12T08:30+01:00');
});

test('build keeps last good data when a source fails, forClient drops raw copies', () => {
  const first = build(null, { moodle: [true, { deadlines: [{ id: 'a', due: '2026-10-10T10:00+01:00' }] }] });
  const second = build(first, { moodle: [false, 'HTTP 500'], manual: [true, { classes: [{ id: 'c', start: '2026-10-06T08:00+01:00' }] }] });
  assert.equal(second.deadlines.length, 1);
  assert.equal(second.sources.moodle.ok, false);
  assert.equal(second.sources.moodle.error, 'HTTP 500');
  assert.equal(second.classes.length, 1);
  assert.equal(forClient(second).sources.moodle.data, undefined);
});

test('build: SIGARRA parts that failed keep their last good copy; exams, profile and fees are merged in', () => {
  const sigarra = {
    classes: [{ id: 's1', start: '2026-10-06T08:30+01:00' }],
    exams: [{ id: 'e2', start: '2027-01-20T09:00+00:00' }, { id: 'e1', start: '2027-01-13T09:00+00:00' }],
    courses: [{ id: 'sigarra:uc:1', acronym: 'AMAT' }, { id: 'sigarra:uc:2', acronym: 'FIS' }],
    profile: { name: 'Ana' }, fees: { balance: '-697,00 €' }, print_balance: '2,35 €', warnings: [],
  };
  const first = build(null, { sigarra: [true, sigarra] });
  assert.deepEqual(first.exams.map((e) => e.id), ['e1', 'e2']);
  assert.equal(first.courses.length, 2, 'every course is kept, not just the first');
  assert.equal(first.profile.name, 'Ana');
  assert.deepEqual(first.finance, { fees: { balance: '-697,00 €' }, print_balance: '2,35 €' });

  // Next sync: the timetable came back, the exams and fees did not.
  const second = build(first, { sigarra: [true, { classes: [{ id: 's2', start: '2026-10-07T08:30+01:00' }], warnings: ['Exams: HTTP 500'] }] });
  assert.deepEqual(second.classes.map((c) => c.id), ['s2']);
  assert.deepEqual(second.exams.map((e) => e.id), ['e1', 'e2']);
  assert.equal(second.finance.print_balance, '2,35 €');
  assert.deepEqual(second.sources.sigarra.warnings, ['Exams: HTTP 500']);
  assert.equal(second.sources.sigarra.data.warnings, undefined);

  // Disconnecting SIGARRA forgets its data without touching the sync time.
  const third = build(second, {}, { drop: ['sigarra'] });
  assert.equal(third.classes.length, 0);
  assert.equal(third.profile, null);
  assert.equal(third.finance, null);
  assert.equal(third.generated_at, second.generated_at);
});
