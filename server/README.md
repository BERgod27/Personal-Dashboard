# Online version (server)

One small Node server that:

- serves the dashboard (the folder above this one) behind a sign-in page,
- keeps your data in a database so phone and laptop see the same thing,
- fetches Moodle deadlines, the SIGARRA timetable and the news feeds on the server,
  so they work from any device.

No build step. Node 22.13+. The only dependency is `pg` (used when `DATABASE_URL` is set).

## How it works

| Piece | Where |
|---|---|
| Accounts, sessions | `server.mjs` + `security.mjs` (scrypt password hashes, HttpOnly session cookie, rate-limited sign-in) |
| Your data | `docs` table: each localStorage key the dashboard uses (`personal-dashboard.v1`, `pd.meals.v1`, `pd.workouts.v1`) is one versioned JSON document |
| Browser sync | `../js/online.js` loads your data before the dashboard starts, saves each change within a second, and reloads when another device saved something newer |
| Uni | `uni.mjs` (a Node port of `modules/uni/sync_uni.py`, same `uni/1` data format); settings are in the **Account → Uni connections** dialog |
| News | reuses `modules/news/server.mjs` and `feeds.json`; cached for 15 minutes |
| Database | Postgres when `DATABASE_URL` is set, otherwise a SQLite file (`data/dashboard.db`) |

The Moodle calendar link and the SIGARRA password (only if you tick "Remember") are
encrypted with AES-256-GCM using a key derived from `APP_SECRET`, which lives only in the
host's settings. If you don't tick "Remember", the password is used for that one sync and
dropped.

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

- SIGARRA has no official student API. The sync uses the mobile endpoints the U.Porto app
  uses; they were not reachable from where this was built, so the first real test is on the
  host. If SIGARRA refuses logins from outside Portugal or changes its endpoints, the error
  shows in Uni connections and the manual timetable still works.
- Conflicts are resolved per document: if two devices edit at the same moment, the one
  that saved first wins and the other reloads with a notice.
