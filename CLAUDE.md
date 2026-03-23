# Capacity Planner Viz — Claude Instructions

## Project Overview
NR1 Custom Visualization for capacity planning. Scatter plot + regression trend lines + projection table. Users configure named time-window samples (e.g. "Black Friday"); the viz fetches NRQL data, fits regression curves, and projects metrics at various throughput levels.

## Key Files
- `visualizations/capacity-planner/index.js` — root component
- `visualizations/capacity-planner/nr1.json` — config schema (single source of truth for available props)
- `visualizations/capacity-planner/hooks/useNerdGraphBatch.js` — batched NRQL fetching, facet support
- `visualizations/capacity-planner/utils/regression.js` — OLS linear, polynomial, power, exponential
- `visualizations/capacity-planner/components/ScatterPlot.js` — Recharts ComposedChart
- `visualizations/capacity-planner/components/ProjectionTable.js` — NR1 Table

## Conventions
- NR1 `Table` must use render-prop pattern (`items` prop + function-as-children).
- `useNerdGraphBatch` deps are serialised with `JSON.stringify` to avoid infinite re-render loops.
- Regression results carry a `type` field; use `predictAny()` from `regression.js` for all prediction calls.
- Config `targetThroughput` is a comma-separated string; `multipliers` is also comma-separated.
- Each sample has its own `accountId` — no top-level account field.
- `seriesColourMap` in `index.js` is keyed by **series label** (not `sampleName`). Series within a sample share a hue but get distinct lightness shades via `generateShades()`. All colour lookups in `ScatterPlot.js` and `ProjectionTable.js` must key on `series.label`.
- `selectedSeries` in `ScatterPlot.js` is a `Set<string>` of series labels. Click toggles membership; alt-click removes. Use `selectedSeries.size > 0` (not `!== null`) and `selectedSeries.has(label)` (not `=== label`).

## See Also
`PLAN.md` — running implementation log and remaining tasks.
