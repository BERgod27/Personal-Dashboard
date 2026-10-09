# Meals module

Meal planner and food tracker for the Personal Dashboard. The interface and food names are in European Portuguese. Plain HTML/CSS/JS, no build step, no dependencies.

## Run it on its own

Open `index.html` in a browser (double-click works, no server needed).

## What it does

- **Today**: log food per meal (breakfast, lunch, snack, dinner) by picking a food and grams, or a saved meal. Calorie, protein, carbs and fat totals against your goals. Quick add for things without a food entry. If the day has a plan, "Log it" / "Log whole plan" copies it into the log.
- **Week plan**: plan foods, saved meals or free-text notes per day and meal; copy last week; shopping list for the week with tick boxes.
- **Foods & meals**: about 300 built-in foods per 100 g (beef, pork, poultry, charcuterie, fish, seafood, dairy, bread, legumes, vegetables, fruit, nuts, sweets, Portuguese dishes, drinks per 100 ml), grouped by category, plus your own foods and saved meals (recipes) with their totals. Search ignores accents and word order.
- **Water and weight** (on Today): one-tap glasses of water against a daily goal, and a weight entry for the day with the smoothed trend.
- **Body**: weight, waist, neck and hips per day; a weight chart with the trend line (an exponential moving average, so day-to-day water swings don't hide the direction), change over 7 and 30 days and the weekly rate over the last 4 weeks; BMI, waist-to-height and a U.S. Navy body-fat estimate when the profile has sex and height.
- **Goal calculator** (on Goals & history): sex, birth year, height, activity, and goal (lose, keep or gain, at 0.25 to 1 kg a week). It works out resting energy (Mifflin-St Jeor) and daily burn, and once there are 14 logged days and a week of weigh-ins in the last 4 weeks it uses the real burn instead: average intake minus the energy the weight trend gained or lost (7700 kcal per kg). The suggestion sets protein by body weight, fat at 25% of calories and carbs in the rest, never below 1500 (men) or 1200 (women) kcal, and applies with one button.
- **Goals & history**: daily goals (including water), last 7 days chart, and backups (copy as text and restore by pasting, or download/import a JSON file). Deletes use an in-panel "tap again" confirm, so everything works inside sandboxed frames where `confirm()` and downloads are blocked.

Data lives in the browser's `localStorage` under `pd.meals.v1`. Water is `water['YYYY-MM-DD']` in ml, check-ins are `body['YYYY-MM-DD'] = {weight, waist, neck, hips}`, and the calculator's answers are in `profile`; older saves get these fields filled in on load. Built-in food ids never change (saved meals and plans point at them); log entries keep a copy of the food name, and entries saved with the old English names are renamed on load (`OLD_NAMES` in meals.js).

## Mount it in the dashboard

```html
<div id="meals-panel"></div>
<script src="modules/meals/meals.js"></script>
<script>
  const meals = PDModules.meals.mount(document.getElementById('meals-panel'), { hideTitle: true });
  // meals.unmount(), meals.refresh(), meals.summary()
</script>
```

- `meals.js` injects `meals.css` itself (resolved next to the script), and all styles are scoped under `.pdm`.
- Colours, type and spacing come from the dashboard's design tokens, so a page that mounts it links `css/tokens.css` (the standalone `index.html` does).
- Options: `hideTitle` (skip the "Meals" heading), `tab` (`today` | `plan` | `foods` | `goals`).
- `PDModules.meals.summary(date?)` works without mounting and returns
  `{date, kcal, protein, carbs, fat, goals, planned: [{slot, label}]}` for an overview card.
  The summary also has `water` (ml) and `body` (`{weight, weightDate, trend, kgPerWeek}`, or null).
- `PDModules.meals.todayCard(el, date)` draws the compact calories, water and weight card used on the dashboard's Today page; `PDModules.meals.addWater(ml, date?)` adds water from outside the panel and refreshes any mounted panel.
- Every change fires `window` event `pd:meals:change` with that summary for today as `detail`.

## Credits

The water, body check-in, goal calculator and adaptive daily burn features follow ideas from [SparkyFitness](https://github.com/CodeWithCJ/SparkyFitness) by CodeWithCJ. SparkyFitness is under a non-commercial licence, so no code or data was copied; this module reimplements the ideas with the standard published formulas.
