# Family Meals

A weekly meal-planning web app built for a Nigerian-Canadian family of five in Calgary.
Two adults on weight loss (Temi & Stephen), three kids on healthy weight gain.
Zero build step — plain HTML/CSS/JS. Open `index.html` in a browser or host on any static server (GitHub Pages works out of the box).

## What it does

- **Weekly planner (Sun–Sat).** Breakfast, lunch, dinner per day. Colour-coded cards:
  green = family shares, blue = adults, orange = kids. Each card shows calories
  (adult vs kid), alerts (⚠ nut for school lunches), Stephen health badges
  (BP · Pre-D · Anti-inflam), and a ↻ indicator on soups served a second time
  with a different carb.
- **Grocery list.** Auto-generated from the week. Organised by Proteins, Carbs
  & Staples, Vegetables, Fruits, Dairy, Pantry. Tick items you already have;
  counter updates live. "Copy unchecked" copies remaining items to clipboard.
  "Shareable link" generates a URL that preserves tick state for Stephen.
- **Batch cook guide.** Ordered Saturday → Sunday checklist with time, what each
  task feeds, and storage notes. Progress bar shows % complete.
- **Meal swap.** Tap any card to open the swap drawer. Enforces: no repeat
  protein within 2 days · no same meal at lunch & dinner same day · no same
  soup within 4 days · school lunches must be nut-free. Swaps regenerate
  the grocery list automatically.
- **Meal vault.** Full searchable list of every meal. Add, edit, delete. Filter
  by category, search by name, toggle "Stephen-friendly only". Changes persist
  to `localStorage` and flow into the planner and swap drawer.

## Data model

Everything lives in `data.js` (defaults) and `localStorage` (user edits):

- `fm.meals` — the meal vault (`DEFAULT_MEALS` as the seed)
- `fm.plan` — the current week plan (`DEFAULT_PLAN` as the seed)
- `fm.grocery` — grocery tick state, `{ "Section::Item": true }`
- `fm.batch` — batch cook task checklist state, `{ taskId: true }`

## Run it

```
# from the repo root
open index.html                        # macOS
# or serve over HTTP so the share-link origin is stable
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy to GitHub Pages

After pushing to GitHub, in the repo settings → Pages → Source → `main` / root.
