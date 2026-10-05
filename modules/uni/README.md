# Uni module

Shows today's classes, deadlines for the next 14 days, and the rest of the week.
Data comes from Moodle and Sigarra and is written to `data/uni.json`.

The university sites only answer from your own computer, so the sync runs there.
Python 3.9+ and nothing else to install.

## Connections

| Source | How | Needs from you | Reliability |
|---|---|---|---|
| Moodle deadlines | Calendar export URL (ICS) | Paste the URL once in `setup` | Official feature, very reliable |
| Moodle, richer | Mobile web service, `--moodle-token` | A "security key" from Moodle preferences, typed at sync time | Official API, only if U.Porto enables keys |
| Sigarra timetable | Login + Sigarra's older mobile JSON endpoints | Username in `setup`, password typed at each sync | Unofficial, can break if Sigarra changes |
| Manual timetable | `schedule.csv` (copy `schedule.example.csv`) | Type your weekly timetable once | Always works |

The hosted version (`server/`) has a newer SIGARRA sync in `server/sigarra.mjs` that signs in
and reads pages the way the U.Porto *uni* app does, and also brings exams, course units, profile,
fees and print balance. This script keeps the older endpoints, so prefer the hosted version for SIGARRA.

Passwords and security keys are asked with a hidden prompt and never saved.
`config.json` holds the Moodle calendar URL, which contains a personal token, so it is created with owner-only permissions and is in `.gitignore`.

### Getting the Moodle calendar URL
Moodle → Calendar → *Import or export calendars* → *Export calendar* → choose **All courses** and **Recent and next 60 days** → *Get calendar URL* → copy it.

## Run it

```bash
cd personal-dashboard/modules/uni
python3 sync_uni.py setup      # once
python3 sync_uni.py            # sync (asks the Sigarra password)
python3 sync_uni.py serve      # preview at http://localhost:8765/index.html
```

Preview with fake data: `http://localhost:8765/index.html?sample`.

Keep it fresh without typing a password: schedule `python3 sync_uni.py --no-sigarra`
(e.g. cron every hour) for Moodle, and run the full sync with Sigarra once a week,
since timetables rarely change. A source that fails keeps its last good data and the
panel shows the error.

## Mounting in the dashboard

```js
import { mountUniPanel } from "./modules/uni/panel.js";
const panel = await mountUniPanel(document.querySelector("#uni"), {
  dataUrl: "./modules/uni/data/uni.json", // or { data } if the shell loads it
  deadlineDays: 14,
});
// panel.refresh(), panel.destroy()
```

`renderUni(data, opts)` returns the panel HTML as a string if the shell prefers to render itself.
Colours, type and spacing come from the dashboard's design tokens, so a page that mounts the panel
links `css/tokens.css` (the standalone `index.html` does, and `sync_uni.py serve` serves it).

## Data contract (`schema: "uni/1"`)

```jsonc
{
  "generated_at": "2026-10-03T09:00+01:00",
  "classes":   [{ "id", "course", "course_name"?, "type", "room", "teacher", "teacher_name"?, "group", "start", "end", "source" }],
  "deadlines": [{ "id", "title", "course", "due", "url", "kind": "deadline", "source" }],
  "events":    [{ "id", "title", "course", "start", "end", "all_day", "source" }],
  "exams":     [{ "id", "course", "course_name", "season", "season_name", "start", "end", "all_day", "rooms": [], "source" }],
  "courses":   [{ "id", "code", "acronym", "name", "ects", "semester", "year", "status", "grade", "occurrence", "source" }],
  "profile":   { "name", "email", "number", "programmes": [{ "name", "acronym", "year", "faculty" }], "faculties": [] } | null,
  "finance":   { "fees": { "balance", "balance_value", "next_due", "unpaid": [{ "description", "date", "deadline", "amount", "amount_due" }] } | null,
                 "print_balance": "2,35 €" | null } | null,
  "sources":   { "moodle": { "ok", "synced_at", "error", "warnings": [] }, "sigarra": { ... } }
}
```
All times are ISO 8601 with the Lisbon offset. `data/uni.js` has the same content as `window.UNI_DATA`.
`exams`, `profile` and `finance` come from the hosted SIGARRA sync only. Exam `season` is SIGARRA's
code: `MT` mini-tests, `EN` normal, `ER` resit (recurso), `EC` completion, `EE`/`EAE` special statutes.
An exam without a time (`all_day`) runs from midnight to midnight. `warnings` lists parts of a
source that could not be refreshed; those parts keep their last good data.

## Tests

```bash
python3 -m unittest discover -s tests
```
