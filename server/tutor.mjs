// Tutor: answers questions about the signed-in user's dashboard (classes, exams, deadlines,
// workouts, meals, news) and helps with studying, through the Claude API.
//
// Needs ANTHROPIC_API_KEY on the server (a Claude.ai Pro/Max subscription does not include API
// access; keys come from console.anthropic.com and are billed per use). The user's data is read
// from the database for each question and sent only with that request; nothing is logged.

import Anthropic from '@anthropic-ai/sdk';
import { LOCAL_TZ } from './time.mjs';

export const DEFAULT_MODEL = 'claude-opus-5-5';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 8000;
const MAX_TOTAL_CHARS = 80000;
const MAX_CONTEXT_CHARS = 120000;

export function tutorConfig(env = process.env) {
  const effort = EFFORTS.includes(env.TUTOR_EFFORT) ? env.TUTOR_EFFORT : 'medium';
  return { configured: !!(env.ANTHROPIC_API_KEY || '').trim(), model: (env.TUTOR_MODEL || '').trim() || DEFAULT_MODEL, effort };
}

// The conversation the browser sends: alternating user/assistant text, starting and ending with
// the user. Anything else is refused rather than repaired.
export function checkMessages(raw) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!Array.isArray(raw) || !raw.length) throw bad('Ask a question first.');
  if (raw.length > MAX_MESSAGES) throw bad('This chat is too long. Start a new one.');
  let total = 0;
  const out = raw.map((m, i) => {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    if (!m || m.role !== role || typeof m.content !== 'string') throw bad('The chat history is malformed. Start a new one.');
    const content = m.content.trim();
    if (!content) throw bad('Empty messages can\'t be sent.');
    if (content.length > MAX_MESSAGE_CHARS) throw bad(`Keep each message under ${MAX_MESSAGE_CHARS} characters.`);
    total += content.length;
    return { role, content };
  });
  if (out[out.length - 1].role !== 'user') throw bad('The last message must be your question.');
  if (total > MAX_TOTAL_CHARS) throw bad('This chat is too long. Start a new one.');
  return out;
}

// ---------------------------------------------------------------- context

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const localDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: LOCAL_TZ });
const fmtWhen = (isoString) => {
  const d = new Date(isoString);
  if (Number.isNaN(+d)) return String(isoString || '');
  return d.toLocaleString('en-GB', { timeZone: LOCAL_TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const fmtTime = (isoString) => new Date(isoString).toLocaleTimeString('en-GB', { timeZone: LOCAL_TZ, hour: '2-digit', minute: '2-digit' });
const r0 = (n) => Math.round(Number(n) || 0);
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);

function section(title, lines) {
  return lines.length ? `## ${title}\n${lines.join('\n')}` : '';
}

function plannerSection(dash, today) {
  if (!dash) return '';
  const out = [];
  const events = (dash.events || []).filter((e) => !e.sample);
  const weekly = events.filter((e) => e.weekly);
  const dated = events.filter((e) => !e.weekly && e.date && daysBetween(today, e.date) >= -7 && daysBetween(today, e.date) <= 30)
    .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
  if (weekly.length) {
    out.push('Weekly events:');
    for (const e of weekly.slice(0, 40)) {
      const wd = new Date(e.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
      out.push(`- ${wd}s ${e.start || ''}${e.end ? '-' + e.end : ''} ${clip(e.title, 120)} [${e.category || 'personal'}]${e.notes ? ' — ' + clip(e.notes, 200) : ''}`);
    }
  }
  if (dated.length) {
    out.push('Events (last week to next 30 days):');
    for (const e of dated.slice(0, 80)) out.push(`- ${e.date} ${e.start || 'all day'}${e.end ? '-' + e.end : ''} ${clip(e.title, 120)} [${e.category || 'personal'}]${e.notes ? ' — ' + clip(e.notes, 200) : ''}`);
  }
  const tasks = (dash.tasks || []).filter((t) => !t.sample);
  const open = tasks.filter((t) => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const done = tasks.filter((t) => t.done && t.doneAt && Date.now() - Date.parse(t.doneAt) < 7 * 86400e3);
  if (open.length) {
    out.push('Open tasks:');
    for (const t of open.slice(0, 80)) out.push(`- ${clip(t.title, 160)}${t.due ? ' (due ' + t.due + ')' : ''} [${t.category || 'personal'}]${t.notes ? ' — ' + clip(t.notes, 200) : ''}`);
  }
  if (done.length) out.push('Done in the last 7 days: ' + done.slice(0, 30).map((t) => clip(t.title, 80)).join('; '));
  const notes = Object.entries(dash.notes || {}).filter(([d, v]) => v && Math.abs(daysBetween(today, d)) <= 14).sort();
  if (notes.length) {
    out.push('Day notes:');
    for (const [d, v] of notes) out.push(`- ${d}: ${clip(v, 600)}`);
  }
  return section('Planner (Today tab)', out);
}

function uniSection(uni, nowMs) {
  if (!uni) return section('Uni', ['Not synced yet (no Moodle/SIGARRA data).']);
  const out = [];
  if (uni.generated_at) out.push(`Last synced: ${fmtWhen(uni.generated_at)}`);
  const p = uni.profile;
  if (p) {
    const prog = (p.programmes || []).map((x) => `${x.name}${x.year ? ', year ' + x.year : ''}${x.faculty ? ' (' + x.faculty.toUpperCase() + ')' : ''}`).join('; ');
    out.push(`Student: ${p.name || '?'}${prog ? ' — ' + prog : ''}`);
  }
  const courses = uni.courses || [];
  if (courses.length) {
    out.push('Course units:');
    for (const c of courses.slice(0, 40)) out.push(`- ${c.acronym || c.code}: ${c.name}${c.ects ? ', ' + c.ects + ' ECTS' : ''}${c.semester ? ', ' + c.semester : ''}${c.status ? ', ' + c.status : ''}${c.grade != null ? ', grade ' + c.grade : ''}`);
  }
  const soon = (iso, back, ahead) => { const t = Date.parse(iso); return t >= nowMs - back * 86400e3 && t <= nowMs + ahead * 86400e3; };
  const classes = (uni.classes || []).filter((c) => soon(c.start, 1, 14)).sort((a, b) => a.start.localeCompare(b.start));
  if (classes.length) {
    out.push('Classes (next 2 weeks):');
    for (const c of classes.slice(0, 120)) out.push(`- ${fmtWhen(c.start)}-${fmtTime(c.end)} ${c.course}${c.type ? ' (' + c.type + ')' : ''}${c.room ? ' room ' + c.room : ''}${c.teacher ? ', ' + c.teacher : ''}`);
  }
  const deadlines = (uni.deadlines || []).filter((d) => soon(d.due, 7, 120)).sort((a, b) => a.due.localeCompare(b.due));
  if (deadlines.length) {
    out.push('Deadlines:');
    for (const d of deadlines.slice(0, 60)) out.push(`- ${fmtWhen(d.due)} ${d.course ? d.course + ': ' : ''}${clip(d.title, 160)}${Date.parse(d.due) < nowMs ? ' (past)' : ''}`);
  }
  const events = (uni.events || []).filter((e) => soon(e.start, 1, 60)).sort((a, b) => a.start.localeCompare(b.start));
  if (events.length) {
    out.push('Other uni events:');
    for (const e of events.slice(0, 40)) out.push(`- ${fmtWhen(e.start)} ${clip(e.title, 160)}`);
  }
  const exams = (uni.exams || []).filter((e) => Date.parse(e.end || e.start) >= nowMs - 86400e3).sort((a, b) => a.start.localeCompare(b.start));
  if (exams.length) {
    out.push('Exams:');
    for (const e of exams.slice(0, 40)) out.push(`- ${fmtWhen(e.start)}${e.all_day ? '' : '-' + fmtTime(e.end)} ${e.course}${e.course_name ? ' (' + e.course_name + ')' : ''}${e.season_name ? ', ' + e.season_name : ''}${e.rooms?.length ? ', rooms ' + e.rooms.join(', ') : ''}`);
  }
  const fees = uni.finance?.fees;
  if (fees?.unpaid?.length) out.push('Unpaid fees: ' + fees.unpaid.map((f) => `${f.description} ${f.amount_due ?? f.amount}€ by ${f.deadline}`).join('; '));
  return section('Uni (Moodle + SIGARRA)', out);
}

function workoutSection(w, today) {
  const sessions = (w?.sessions || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!sessions.length) return section('Workouts', ['No sessions logged yet.']);
  const unit = w.unit || 'kg';
  const out = [`Units: ${unit}. ${sessions.length} sessions logged; most recent first:`];
  for (const s of sessions.filter((s) => daysBetween(s.date, today) <= 60).slice(0, 25)) {
    const ex = (s.exercises || []).filter((e) => e.name).map((e) => {
      const sets = (e.sets || []).filter((x) => x.reps !== '' || x.weight !== '').map((x) => `${x.reps || 0}×${x.weight || 0}`).join(', ');
      return `${clip(e.name, 60)} ${sets}`;
    });
    out.push(`- ${s.date}${s.title ? ' ' + clip(s.title, 60) : ''}: ${ex.join('; ')}${s.notes ? ' — ' + clip(s.notes, 200) : ''}`);
  }
  return section('Workouts (sets as reps×weight)', out);
}

function mealsSection(m, today) {
  if (!m) return section('Meals', ['Nothing logged yet.']);
  const out = [];
  const g = m.goals || {};
  out.push(`Daily goals: ${r0(g.kcal)} kcal, protein ${r0(g.protein)} g, carbs ${r0(g.carbs)} g, fat ${r0(g.fat)} g`);
  const days = Object.keys(m.log || {}).filter((d) => daysBetween(d, today) >= 0 && daysBetween(d, today) <= 7).sort().reverse();
  if (days.length) out.push('Logged (last 7 days):');
  for (const d of days) {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    const items = [];
    for (const [slot, list] of Object.entries(m.log[d] || {})) {
      for (const e of list || []) {
        for (const k in t) t[k] += Number(e[k]) || 0;
        items.push(`${slot}: ${clip(e.name, 50)} ${r0(e.grams)}g`);
      }
    }
    if (items.length) out.push(`- ${d}: ${r0(t.kcal)} kcal, P ${r0(t.protein)} g, C ${r0(t.carbs)} g, F ${r0(t.fat)} g — ${items.slice(0, 30).join('; ')}`);
  }
  const foods = new Map([...(m.customFoods || [])].map((f) => [f.id, f.name]));
  const mealsById = new Map((m.meals || []).map((x) => [x.id, x.name]));
  const planDays = Object.keys(m.plan || {}).filter((d) => daysBetween(today, d) >= 0 && daysBetween(today, d) <= 7).sort();
  if (planDays.length) out.push('Planned (next 7 days):');
  for (const d of planDays) {
    const items = [];
    for (const [slot, list] of Object.entries(m.plan[d] || {})) {
      for (const e of list || []) {
        const name = e.kind === 'note' ? e.text : e.kind === 'meal' ? mealsById.get(e.mealId) : foods.get(e.foodId) || e.foodId;
        if (name) items.push(`${slot}: ${clip(name, 50)}${e.grams ? ' ' + r0(e.grams) + 'g' : ''}`);
      }
    }
    if (items.length) out.push(`- ${d}: ${items.slice(0, 30).join('; ')}`);
  }
  if ((m.meals || []).length) out.push('Saved meals: ' + m.meals.slice(0, 30).map((x) => clip(x.name, 50)).join('; '));
  return section('Meals (Refeições tab, Portuguese UI)', out);
}

function newsSection(news) {
  const items = (news?.items || []).slice(0, 20);
  if (!items.length) return '';
  return section('News headlines (News tab)', items.map((i) => `- [${i.category || ''}] ${clip(i.title, 160)} (${i.source || ''}${i.published ? ', ' + fmtWhen(i.published) : ''})`));
}

// Everything the tutor knows about the user, as plain text. `docs` are the synced localStorage
// documents ({key: value string}); `uni` is the client view of the uni data.
export function buildContext({ docs = {}, uni = null, news = null, nowMs = Date.now() } = {}) {
  const today = localDay(nowMs);
  const dash = parse(docs['personal-dashboard.v1']);
  const meals = parse(docs['pd.meals.v1']);
  let workouts = dash?.modules?.workout;
  if (!workouts?.sessions?.length) workouts = parse(docs['pd.workouts.v1']) || workouts;
  const parts = [
    `Today is ${new Date(nowMs).toLocaleDateString('en-GB', { timeZone: LOCAL_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (${today}), time zone ${LOCAL_TZ}.`,
    uniSection(uni, nowMs),
    plannerSection(dash, today),
    workoutSection(workouts, today),
    mealsSection(meals, today),
    newsSection(news),
  ].filter(Boolean);
  let text = parts.join('\n\n');
  if (text.length > MAX_CONTEXT_CHARS) text = text.slice(0, MAX_CONTEXT_CHARS) + '\n[…dashboard data cut here for length]';
  return text;
}

const INSTRUCTIONS = `You are the tutor and assistant built into Bernardo's personal dashboard ("Bernardo's Day"), a website with tabs for Today (planner, tasks, notes), Uni (timetable, deadlines, exams and course units synced from Moodle and SIGARRA at U.Porto), Workouts, Refeições (meals, in Portuguese) and News.

You help him with two kinds of questions:
1. Questions about his own data: what's next, when an exam or deadline is, how his training or eating is going, what to prioritise this week. Answer from the dashboard data below. If something isn't in the data, say so plainly rather than guessing, and suggest where it could come from (for example syncing Uni connections).
2. Study help on anything: explaining concepts, working through exercises step by step, quizzing him, making study plans around his real timetable and exam dates. Teach like a good tutor: check understanding, give hints before full solutions when he's practising, and be accurate.

Reply in the language he writes in (usually English or European Portuguese). Keep answers concise and conversational; use short lists or small tables when they help, and Markdown for maths/code where useful. The dashboard data is his private information: use it only to answer him.`;

export function systemPrompt(context) {
  return [
    { type: 'text', text: INSTRUCTIONS },
    // Cached: follow-up questions in the same chat reuse it instead of paying for it again.
    { type: 'text', text: `# Dashboard data\n\n${context}`, cache_control: { type: 'ephemeral' } },
  ];
}

// ---------------------------------------------------------------- calling Claude

let client = null;
let clientKey = null;
function getClient(apiKey) {
  if (!client || clientKey !== apiKey) { client = new Anthropic({ apiKey, maxRetries: 2 }); clientKey = apiKey; }
  return client;
}

// Streams the answer as events: {type:'text', text}, {type:'reset'} (a fallback model takes over:
// drop the partial answer), and finally {type:'done', stop}. Throws Anthropic API errors.
export async function* streamAnswer({ apiKey, model, effort, context, messages, view, nowMs = Date.now(), signal, makeClient = getClient }) {
  const last = messages[messages.length - 1];
  const where = view ? ` He has the ${view} tab open.` : '';
  const now = new Date(nowMs).toLocaleString('en-GB', { timeZone: LOCAL_TZ, weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const convo = [
    ...messages.slice(0, -1),
    { role: 'user', content: [{ type: 'text', text: `(Local time: ${now}.${where})` }, { type: 'text', text: last.content }] },
  ];
  const stream = makeClient(apiKey).beta.messages.stream({
    model,
    max_tokens: 16000,
    output_config: { effort },
    system: systemPrompt(context),
    messages: convo,
    // A request declined by the safety classifiers is retried on Anthropic's recommended model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  }, { signal });
  for await (const ev of stream) {
    if (ev.type === 'content_block_start' && ev.content_block.type === 'fallback') yield { type: 'reset' };
    else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield { type: 'text', text: ev.delta.text };
  }
  const final = await stream.finalMessage();
  yield { type: 'done', stop: final.stop_reason };
}

// A short, user-facing reason for an API failure (never the key or the request).
export function explainError(e) {
  const s = e?.status;
  if (s === 401 || s === 403) return 'The Anthropic API key on the server was refused. Check ANTHROPIC_API_KEY in Render.';
  if (s === 400 && /credit|billing|balance/i.test(e?.message || '')) return 'The Anthropic account is out of credit. Add credit at console.anthropic.com → Billing.';
  if (s === 404) return 'The tutor model was not found. Check TUTOR_MODEL in Render (or remove it to use the default).';
  if (s === 429) return 'The tutor is being rate limited by Anthropic. Wait a minute and try again.';
  if (s === 529 || (s >= 500 && s < 600)) return 'Claude is overloaded right now. Try again in a moment.';
  if (s === 400) return 'Claude refused the request: ' + clip(e?.error?.error?.message || e?.message || '', 200);
  return 'The tutor could not reach Claude. Try again.';
}
