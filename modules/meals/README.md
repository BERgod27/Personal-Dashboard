# Meals module

Meal planner and food tracker for the Personal Dashboard. The interface and food names are in European Portuguese. Plain HTML/CSS/JS, no build step, no dependencies.

## Run it on its own

Open `index.html` in a browser (double-click works, no server needed).

## What it does

- **Today**: log food per meal (breakfast, lunch, snack, dinner) by picking a food and grams, or a saved meal. Calorie, protein, carbs and fat totals against your goals. Quick add for things without a food entry. If the day has a plan, "Log it" / "Log whole plan" copies it into the log.
- **Week plan**: plan foods, saved meals or free-text notes per day and meal; copy last week; shopping list for the week with tick boxes.
- **Foods & meals**: about 300 built-in foods per 100 g (beef, pork, poultry, charcuterie, fish, seafood, dairy, bread, legumes, vegetables, fruit, nuts, sweets, Portuguese dishes, drinks per 100 ml), grouped by category, plus your own foods and saved meals (recipes) with their totals. Search ignores accents and word order.
- **Goals & history**: daily goals, last 7 days chart, and backups (copy as text and restore by pasting, or download/import a JSON file). Deletes use an in-panel "tap again" confirm, so everything works inside sandboxed frames where `confirm()` and downloads are blocked.

Data lives in the browser's `localStorage` under `pd.meals.v1`. Built-in food ids never change (saved meals and plans point at them); log entries keep a copy of the food name, and entries saved with the old English names are renamed on load (`OLD_NAMES` in meals.js).

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
- Theme it from the shell by setting any of `--pd-surface`, `--pd-surface-2`, `--pd-text`, `--pd-muted`, `--pd-border`, `--pd-accent`, `--pd-accent-text`, `--pd-warn`, `--pd-radius`, `--pd-font` on a parent element.
- Options: `hideTitle` (skip the "Meals" heading), `tab` (`today` | `plan` | `foods` | `goals`).
- `PDModules.meals.summary(date?)` works without mounting and returns
  `{date, kcal, protein, carbs, fat, goals, planned: [{slot, label}]}` for an overview card.
- Every change fires `window` event `pd:meals:change` with that summary for today as `detail`.
