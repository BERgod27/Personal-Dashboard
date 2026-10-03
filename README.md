# Bernardo's Day — personal dashboard

A daily planner that runs in the browser. No install, no build step.

## Run it
- **Online version (synced across devices, live uni and news):** see
  [server/README.md](server/README.md). Same front end, plus a small server with sign-in and a database.
- Easiest: open the published link (it works on phone and laptop). Schedule,
  tasks, workouts and meals all work there.
- On your computer (needed for live uni and news data): serve the folder with
  `python3 -m http.server 8000` and open http://localhost:8000.
  Double-clicking `index.html` also works, but the Uni and News panels need the server.
- Uni data: run `python3 sync_uni.py` in `modules/uni` (see its README).
- News: run `node server.mjs` in `modules/news` (see its README).

Data is saved in that browser only (localStorage, key `personal-dashboard.v1`).
Use **Data & backup** to copy a backup and restore it on another device.

## Quick-add examples
- `Calculus 9:00-10:30 #uni weekly` → weekly class
- `gym 18h tomorrow` → event tomorrow 18:00–19:00 (area guessed: Workout)
- `Física every wed 11-13 #uni` → weekly on Wednesdays
- `Exam 10am-12pm 15/10` → event on 15 October
- `buy oats` → task for the day you're viewing
Tags: `#uni #gym #meal #personal` (Portuguese words like hoje, amanhã, seg, às 13h work too).
Keys: ← / → change day, `t` today, `/` focus quick-add.

## Layout
```
index.html            page shell
css/app.css           styles (light + dark)
js/store.js           data store + date helpers (Store, D)
js/core.js            areas, module registry, quick-add parser (Dashboard)
js/modules/*.js       adapters that register each module with the dashboard
modules/<name>/       the real modules (uni, workouts, meals, news), each with a README
js/app.js             daily view, editor, backup/restore
```

## Adding a module
Create `js/modules/<name>.js`, add a `<script>` tag for it in `index.html`
before `js/app.js`, and call `Dashboard.registerModule({...})`. A module can
draw its panel (`render`), put items on the schedule (`itemsFor(date)`) and add
tasks (`tasksFor(date)`). Keep its data in `Store.moduleData('<name>')`.
See the comment at the top of `js/core.js`.
