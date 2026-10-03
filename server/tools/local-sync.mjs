#!/usr/bin/env node
// Local SIGARRA sync — run this on YOUR OWN computer.
//
// Why: the hosted dashboard runs in a datacenter, and SIGARRA's bot screen (Cloudflare) often
// turns datacenter requests away. From your own network the sign-in is ordinary, the same as
// the U.Porto app on your phone. This script signs in to SIGARRA here, then sends the result to
// your dashboard with a sync key. Your SIGARRA password never leaves this computer.
//
// Setup (once):
//   1. In the dashboard: Account -> Uni connections -> "Create a sync key". Copy the key.
//   2. Copy tools/local-sync.config.example.json to tools/local-sync.config.json and fill it in
//      (or set the PD_* environment variables below).
//
// Run:
//   cd server && npm install        # first time only, to get the HTML parser
//   node tools/local-sync.mjs       # it asks for your SIGARRA password (hidden)
//
// Config (config file keys | environment variable):
//   serverUrl   | PD_SERVER_URL    your dashboard address, e.g. https://bernardos-day.onrender.com
//   user        | PD_USER          your dashboard username
//   key         | PD_SYNC_KEY      the sync key from the dashboard
//   sigarraUser | PD_SIGARRA_USER  your SIGARRA username, e.g. up202301234
//   faculty     | PD_FACULTY       optional; found automatically if left out
//   weeksAhead  | PD_WEEKS_AHEAD   optional; how many weeks of timetable (1-8, default 2)
// Your SIGARRA password: PD_SIGARRA_PASSWORD, or typed when asked (never saved).

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { syncSigarra, isCredentialError } from '../sigarra.mjs';

const CONFIG_URL = new URL('./local-sync.config.json', import.meta.url);

function loadConfig() {
  let file = {};
  try { file = JSON.parse(readFileSync(CONFIG_URL, 'utf8')); } catch { /* no file: env only */ }
  const pick = (fileKey, envKey) => (process.env[envKey] ?? file[fileKey] ?? '').toString().trim();
  return {
    serverUrl: pick('serverUrl', 'PD_SERVER_URL').replace(/\/+$/, ''),
    user: pick('user', 'PD_USER'),
    key: pick('key', 'PD_SYNC_KEY'),
    sigarraUser: pick('sigarraUser', 'PD_SIGARRA_USER'),
    faculty: pick('faculty', 'PD_FACULTY') || undefined,
    weeksAhead: Number(pick('weeksAhead', 'PD_WEEKS_AHEAD')) || 2,
  };
}

// Ask for the password without echoing it to the screen.
function askHidden(query) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('No SIGARRA password. Set PD_SIGARRA_PASSWORD, or run this in a terminal so it can ask.'));
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.muted = false;
    rl._writeToOutput = (s) => { if (!rl.muted) rl.output.write(s); };
    rl.question(query, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
    rl.muted = true; // the prompt is already printed; hide what is typed next
  });
}

async function main() {
  const cfg = loadConfig();
  const missing = ['serverUrl', 'user', 'key', 'sigarraUser'].filter((k) => !cfg[k]);
  if (missing.length) {
    console.error(`Missing config: ${missing.join(', ')}. Fill tools/local-sync.config.json or set the PD_* variables (node tools/local-sync.mjs sits next to local-sync.config.example.json).`);
    process.exit(2);
  }

  // The sync key and your uni data travel to this address, so it must be encrypted (https).
  let server;
  try { server = new URL(cfg.serverUrl); } catch { console.error(`serverUrl is not a valid address: ${cfg.serverUrl}`); process.exit(2); }
  if (server.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(server.hostname)) {
    console.error(`serverUrl must start with https:// (now ${cfg.serverUrl}), so the sync key isn't sent unencrypted.`);
    process.exit(2);
  }

  const password = process.env.PD_SIGARRA_PASSWORD || await askHidden(`SIGARRA password for ${cfg.sigarraUser}: `);
  if (!password) { console.error('No password given.'); process.exit(2); }

  console.log(`Signing in to SIGARRA as ${cfg.sigarraUser} from this computer...`);
  let data;
  try {
    data = await syncSigarra({ user: cfg.sigarraUser, password, faculty: cfg.faculty, weeksAhead: cfg.weeksAhead });
  } catch (e) {
    console.error(`\nSIGARRA sync failed: ${e.message}`);
    if (isCredentialError(e)) console.error('That looks like a login problem. Check your SIGARRA username and password.');
    else if (e.kind === 'edge') console.error('Even your own network was turned away this time. Wait a bit and try again.');
    process.exit(1);
  }
  const found = [`${data.classes?.length || 0} classes`, `${data.exams?.length || 0} exams`];
  if (data.warnings?.length) found.push(`warnings: ${data.warnings.join('; ')}`);
  console.log(`Signed in. Fetched ${found.join(', ')}. Sending to the dashboard...`);

  let res;
  try {
    res = await fetch(`${cfg.serverUrl}/api/uni/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ user: cfg.user, data }),
    });
  } catch (e) {
    console.error(`\nCould not reach the dashboard at ${cfg.serverUrl}: ${e.cause?.code || e.message}`);
    process.exit(1);
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`\nThe dashboard refused the update (HTTP ${res.status}): ${out.error || ''}`);
    if (res.status === 401) {
      console.error(`\nCheck these three things in server/tools/local-sync.config.json:`);
      console.error(`  1. "user" is the name you sign in to the DASHBOARD with (now "${cfg.user}"), not your SIGARRA number.`);
      console.error(`  2. "key" is the newest key from Uni connections (a new key replaces the old one). Copy all of it, no spaces or quotes.`);
      console.error(`  3. "serverUrl" is the site where you made the key (now ${cfg.serverUrl}).`);
    }
    process.exit(1);
  }
  console.log(`Done. The dashboard now shows ${out.classes} classes, ${out.exams} exams and ${out.deadlines} deadlines. Reload it to see them.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
