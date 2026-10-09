# Workout tracker module

A gym log in the style of the popular workout trackers:
- **Workout**: start empty or from a routine (any workout you named), add exercises from a
  built-in library with muscle-group figures, log sets as weight × reps (distance + time for
  cardio) next to last time's numbers, tick each set to start the rest timer, tap a set
  number to mark a warm-up. The workout in progress survives a reload (`pd.workouts.draft.v1`, per device).
- **History**: month calendar and session cards with duration, volume, sets and PRs.
- **Progress**: muscle map for the last 7/30 days, weekly totals, and per-exercise records and charts.
The body figures and icons are original inline SVG drawn in `workouts.js`.

## Run it on its own
Open `index.html` in a browser (double-click works, no server needed).
Data is saved in that browser's localStorage under `pd.workouts.v1`.
Use **Settings** to back up: download a file, or copy the backup as text and paste it back to import (works where downloads are blocked).

## Hook it into the dashboard shell
In `personal-dashboard/index.html`, after `js/core.js` and before `js/app.js`:
```html
<link rel="stylesheet" href="modules/workouts/workouts.css">
<script src="modules/workouts/workouts.js"></script>
<script src="modules/workouts/register.js"></script>
```
`register.js` registers it as the `workout` module. In the dashboard:
- Data is kept in the shell's Store under `Store.moduleData('workout')`, so it is in
  the dashboard's Data & backup export. Anything logged in the standalone page is
  copied over the first time.
- The panel fills the Workouts tab and uses the dashboard's design tokens (`css/tokens.css`).
- Workouts logged on a day appear as all-day items on that day's schedule.
- New workouts default to the day the dashboard is showing.

## Use it in any other page
```js
const panel = DashboardModules.workouts.mount(el, {
  storage,     // optional { load(), save(data) }; defaults to localStorage 'pd.workouts.v1'
  state,       // optional object to keep tab/draft across re-mounts
  date,        // optional default date 'YYYY-MM-DD'
  embedded     // optional: hide the title, inherit host tokens
});
panel.summary(); panel.refresh(); panel.unmount();
```

## Data shape
```json
{ "version": 1, "unit": "kg",
  "sessions": [ { "id": "…", "date": "2026-10-03", "title": "Push day", "notes": "",
                  "exercises": [ { "name": "Bench press", "sets": [ { "reps": 8, "weight": 60 } ] } ] } ] }
```
Optional fields: session `duration` (minutes), exercise `rest` (seconds), set `warmup: true`,
cardio sets `{ "km": 5, "min": 27 }` instead of reps/weight, top-level `rest` (default rest
seconds) and `muscles` (`{ "exercise name": "chest" }` for exercises you added yourself).
Weight 0 means bodyweight; progress for those exercises tracks max reps instead.
Estimated 1RM uses the Epley formula.
