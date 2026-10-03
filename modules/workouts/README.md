# Workout tracker module

Log workouts (exercises, sets, reps, weight), browse history, and see progress
charts and personal records per exercise.

## Run it on its own
Open `index.html` in a browser (double-click works, no server needed).
Data is saved in that browser's localStorage under `pd.workouts.v1`.
Use **Settings** to back up: download a file, or copy the backup as text and paste it back to import (works where downloads are blocked).

## Hook it into the dashboard shell
In `personal-dashboard/index.html`, after `js/modules/workout.js` and before `js/app.js`:
```html
<link rel="stylesheet" href="modules/workouts/workouts.css">
<script src="modules/workouts/workouts.js"></script>
<script src="modules/workouts/register.js"></script>
```
`register.js` takes over the placeholder `workout` module (or registers it if the
placeholder is gone). In the dashboard:
- Data is kept in the shell's Store under `Store.moduleData('workout')`, so it is in
  the dashboard's Data & backup export. Anything logged in the standalone page is
  copied over the first time.
- The panel spans the full Modules row and uses the shell's theme tokens.
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
Weight 0 means bodyweight; progress for those exercises tracks max reps instead.
Estimated 1RM uses the Epley formula.
