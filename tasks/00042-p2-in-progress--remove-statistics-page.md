# Remove the Statistics page and all associated code

The Statistics page is unused. Delete it end to end: frontend view, route, nav link,
backend API endpoint, chart dependencies, and the preview doc.

## Changes

1. **Delete** `webinterface/src/views/Statistics.vue`.
2. **`webinterface/src/router/index.js`** — remove the `/statistics` route entry (lines ~67-71).
3. **`webinterface/src/App.vue`** — remove the `Statistics` nav link (line 13).
4. **`routes/tasks.js`** — remove the `GET /getTaskStatistics` handler (lines 311-371).
5. **`webinterface/package.json`** — remove `chart.js` and `vue-chartjs` deps (only used by
   Statistics.vue; confirm no other importers before removing). Run `npm install` in
   `webinterface/` to update the lockfile.
6. **Delete** `docs/statistics-preview.html`.
7. Grep for leftover `statistic`/`Chart` references and clean any stragglers.

## Verify

- `npm run build` succeeds.
- App runs; nav bar has no Statistics link and `/statistics` 404s/redirects normally.
