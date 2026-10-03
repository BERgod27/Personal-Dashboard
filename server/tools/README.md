# Local SIGARRA sync

SIGARRA sits behind a bot screen (Cloudflare) that often turns away requests from the dashboard's
host (a datacenter), even when your password is right. This script runs the SIGARRA sync on **your
own computer** instead: from your own network the sign-in is ordinary, the same as the U.Porto app
on your phone. Your SIGARRA password stays on your computer and never reaches the server.

It signs in to SIGARRA, fetches your timetable, exams, course units, profile, fees and print
balance, and sends the result to your dashboard with a **sync key** (a token that can only push
uni data to your account, not your password).

## One-time setup

1. **Install Node 22.13 or newer** (https://nodejs.org). Check with `node --version`.
2. **Get the code on your computer.** Clone the repo, or download it:
   `git clone https://github.com/BERgod27/Personal-Dashboard.git`
3. **Install the dependencies** (needed for reading SIGARRA's pages):
   ```
   cd Personal-Dashboard/server
   npm install
   ```
4. **Create a sync key.** Open your dashboard, go to **Account → Uni connections**, open
   *Sync from your own computer*, and click **Create a sync key**. Copy the key (it is shown once).
5. **Write your config.** Copy the example and fill it in:
   ```
   cp tools/local-sync.config.example.json tools/local-sync.config.json
   ```
   Edit `tools/local-sync.config.json`:
   | Field | What |
   | --- | --- |
   | `serverUrl` | your dashboard address, e.g. `https://bernardos-day.onrender.com` |
   | `user` | your dashboard username |
   | `key` | the sync key you just created |
   | `sigarraUser` | your SIGARRA username, e.g. `up202301234` |
   | `faculty` | leave `""` to find it automatically |
   | `weeksAhead` | how many weeks of timetable (1–8, default 2) |

   This file is git-ignored, so it won't be committed. It holds the sync key, not your password.

## Run it

```
cd Personal-Dashboard/server
node tools/local-sync.mjs
```

It asks for your SIGARRA password (hidden, never saved), signs in, and updates your dashboard.
Reload the dashboard to see the new timetable and exams. Run it again whenever you want to refresh.

If you'd rather not type the password each time, set it in the environment for one run:
`PD_SIGARRA_PASSWORD='...' node tools/local-sync.mjs` (anything in the environment is visible to
other programs on your computer, so the hidden prompt is safer).

## Keep it fresh automatically (optional)

Schedule `node tools/local-sync.mjs` with `PD_SIGARRA_PASSWORD` set:
- **macOS/Linux:** a `cron` entry, e.g. twice a day: `0 8,18 * * * cd /path/to/Personal-Dashboard/server && PD_SIGARRA_PASSWORD='...' node tools/local-sync.mjs`
- **Windows:** Task Scheduler running the same command.

## Turn it off

In **Account → Uni connections → Sync from your own computer**, click **Turn off local sync**.
The key stops working immediately. Create a new one any time; it replaces the old one.

## Troubleshooting

- *"Missing config"* — fill `tools/local-sync.config.json` or set the `PD_*` variables.
- *login problem* — check your SIGARRA username and password on sigarra.up.pt.
- *"Unknown user, or the sync key is wrong or turned off"* — the key was replaced or turned off;
  create a new one in the dashboard and update your config.
- *could not reach the dashboard* — check `serverUrl` and that the site is up (the free host sleeps
  after 15 idle minutes; the first request wakes it in about a minute).
