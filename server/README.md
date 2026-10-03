# Online version (server)

One small Node server that:

- serves the dashboard (the folder above this one) behind a sign-in page,
- keeps your data in a database so phone and laptop see the same thing,
- fetches Moodle deadlines, the SIGARRA timetable and the news feeds on the server,
  so they work from any device.

No build step. Node 22.13+. Dependencies: `pg` (used when `DATABASE_URL` is set) and an HTML
parser for SIGARRA's pages (`parse5`, `css-select`, `domutils`).

## How it works

| Piece | Where |
|---|---|
| Accounts, sessions | `server.mjs` + `security.mjs` (scrypt password hashes, HttpOnly session cookie, rate-limited sign-in) |
| Your data | `docs` table: each localStorage key the dashboard uses (`personal-dashboard.v1`, `pd.meals.v1`, `pd.workouts.v1`) is one versioned JSON document |
| Browser sync | `../js/online.js` loads your data before the dashboard starts, saves each change within a second, and reloads when another device saved something newer |
| Uni | `uni.mjs` (Moodle, manual timetable, merging; same `uni/1` data format as `modules/uni/sync_uni.py`) and `sigarra.mjs` (SIGARRA); settings are in the **Account → Uni connections** dialog |
| News | reuses `modules/news/server.mjs` and `feeds.json`; cached for 15 minutes |
| Database | Postgres when `DATABASE_URL` is set, otherwise a SQLite file (`data/dashboard.db`) |

The Moodle calendar link and the SIGARRA password (only if you tick "Remember") are
encrypted with AES-256-GCM using a key derived from `APP_SECRET`, which lives only in the
host's settings. If you don't tick "Remember", the password is used for that one sync and
dropped. If SIGARRA turns a remembered password down (wrong, expired or blocked), or the
sign-in can't be confirmed, the server deletes it straight away, so the automatic refreshes
never retry it and can't get the account blocked; the dashboard asks for it again. Each sync
signs in once, never twice with the same password.

**Account → Sign out on all devices** ends every session, for example after using a shared computer.
The bottom of the Account menu shows the version: the first characters of the GitHub commit the
host built (Render sets `RENDER_GIT_COMMIT`; `/api/health` reports it too). When it matches the
newest commit on GitHub, the update is live.

### SIGARRA

`sigarra.mjs` makes the same requests as U.Porto's student app *uni*
([NIAEFEUP/uni](https://github.com/NIAEFEUP/uni)):

1. Signs in through SIGARRA's web form at FEUP (the session works for every faculty) and reads the
   student number from the home page.
2. Finds the student's faculties (the **Faculty** field is only needed if that fails).
3. Timetable: the calendar feed behind SIGARRA's timetable page; if that page has no feed, the older
   weekly JSON endpoint.
4. Current course units, exam maps for each of them (upcoming exams only), profile, fees and the
   FEUP print balance.
5. Signs out.

Only a failed sign-in fails the SIGARRA sync. When SIGARRA's answer can't be read, the error says
what it sent (HTTP status and page title) for the sign-in and the home page, so a block or a
changed page can be told apart. A 403 or 503 — often a bot screen like Cloudflare's "Just a
moment..." — is treated as the front door turning the request away, not a wrong password: the
saved password is kept (SIGARRA never saw it, so retrying can't lock the account). A datacenter
host is more likely to be screened than a phone, so this can block server-side sync even with the
right password. Any other part that fails is listed as a warning and keeps its last good data. Requests only go to `sigarra.up.pt` and other `https://*.up.pt` hosts;
a redirect anywhere else is refused, so the session cookie can't leave the university.

When the dashboard is opened without this server (the published page, `file://`, or
`python3 -m http.server`), `online.js` does nothing and everything stays in the browser as before.

## Settings (environment variables)

| Name | Needed | What |
|---|---|---|
| `APP_SECRET` | yes | Random string, 32+ characters. Encrypts saved secrets. **Never change it** after setup, or you'll have to re-enter the Moodle link and SIGARRA password. |
| `SIGNUP_CODE` | yes, for the first sign-in | Any code you choose. The sign-up form asks for it, so nobody else can create the account. Only one account can be created. |
| `DATABASE_URL` | on hosts without a disk | Postgres connection string, e.g. from Neon. The certificate is checked; set `PGSSL_NO_VERIFY=1` only for a provider with self-signed certificates. |
| `CRON_SECRET` | optional | Lets an outside scheduler call `POST /api/cron` to refresh news and uni data and keep the server awake. |
| `SQLITE_PATH` | optional | Where the SQLite file goes when there's no `DATABASE_URL`. |
| `UNI_SYNC_MINUTES` | optional | How old uni data may get before opening the dashboard refreshes it (default 60). |
| `ALLOWED_MOODLE_HOSTS` | optional | Hosts allowed for the Moodle link (default any `*.up.pt`). |
| `ALLOW_MORE_USERS` | optional | `1` to allow more accounts with the sign-up code. |
| `SIGARRA_BASE_URL` | tests only | Points the SIGARRA sync at another server (the tests run a fake SIGARRA). |

## Run it on your computer

```bash
cd personal-dashboard/server
npm install
APP_SECRET=$(openssl rand -base64 36) SIGNUP_CODE=pick-one npm start
# open http://localhost:8080
```

Tests: `npm test` (add `TEST_DATABASE_URL=postgres://...` to run them against Postgres too).

## Put it online for free: Render + Neon

Render runs the server (free plan sleeps after 15 idle minutes, so the first visit after a
break takes about a minute). Neon holds the database (free plan, doesn't expire).

1. **Code on GitHub.** Put this `personal-dashboard` folder in a GitHub repository
   (private is fine). Its top level must contain `index.html`, `render.yaml` and `server/`.
2. **Database.** Sign up at neon.tech → create a project (region: Frankfurt) → copy the
   connection string (starts with `postgresql://`).
3. **Server.** Sign up at render.com with GitHub → **New → Blueprint** → pick the repository.
   Render reads `render.yaml`, then asks for two values:
   - `DATABASE_URL`: paste the Neon string
   - `SIGNUP_CODE`: make one up
   `APP_SECRET` and `CRON_SECRET` are generated for you.
4. **First sign-in.** Open the `https://bernardos-day.onrender.com` link Render shows,
   create your account with the sign-up code, then **Account → Uni connections** to paste
   the Moodle calendar link and your SIGARRA details.
5. **On your phone:** open the same link and use *Add to Home Screen*.
6. **Optional, keeps it fresh and awake:** at cron-job.org create a job every 15 minutes:
   `POST https://<your-app>.onrender.com/api/cron` with header
   `Authorization: Bearer <CRON_SECRET from Render's Environment tab>`.

Bringing your current data: in the old dashboard use **Data & backup → Copy backup**, then
**Restore** in the online one (schedule, tasks, notes, workouts). Meals have their own export
and import in the Meals panel's Goals tab. (Data in a browser is tied to the site's address,
so it does not move over on its own.)

## Other hosts

`../Dockerfile` runs the same server with SQLite on a volume at `/data` (Fly.io, Railway, a
VPS), or with Postgres if you set `DATABASE_URL`. Set `APP_SECRET` and `SIGNUP_CODE` there too.

## Known limits

- SIGARRA has no official student API. The sync follows what the U.Porto app does, tested
  against a fake SIGARRA built from that app's requests and page layouts; the real SIGARRA was not
  reachable from where this was built, so the first real test is on the host. If SIGARRA refuses
  sign-ins from outside Portugal or changes its pages, the error shows in Uni connections and
  the manual timetable still works.
- SIGARRA sits behind a bot screen (Cloudflare). It can serve a "Just a moment..." challenge
  that only a real browser passes, and it screens datacenter hosts (where this server runs) more
  than phones. A browser `User-Agent` is sent, which gets past a light filter but not a full
  JavaScript challenge. When the screen blocks the server, the Uni tab says so and the manual
  timetable still works; running the sync from a home network (the device-side `sync_uni.py`) is
  the fallback if the host stays blocked.
- Conflicts are resolved per document: if two devices edit at the same moment, the one
  that saved first wins and the other reloads with a notice.
