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

## Time Window
- Each sample optionally uses the NR1 platform time picker (`useTimePicker: boolean` per-sample config). When enabled, `startTime`/`endTime` are ignored and time window is derived from `PlatformStateContext.timeRange` in `index.js`.
- `timeRange` can be absolute (`begin_time`/`end_time` in ms), relative (`duration` in ms), or default (null → falls back to `defaultDurationMinutes`, default 60).
- Time picker samples pass pre-computed `startEpoch`/`endEpoch` (Unix seconds) to the hook; manual samples pass `startTime`/`endTime` strings. The hook accepts either.
- `bucketSize` is a **per-sample** config field (not top-level). It defaults to 60 s inside the hook if unset.
- `useNerdGraphBatch` auto-scales bucket size upward when needed to keep query count ≤ `MAX_BATCHES` (4) per sample, emitting a warning via the `warnings` return value. `MAX_WINDOW_HOURS` is no longer a hard cap — it is only used as the default end-time when no end is provided.
- `sampleTimeWindows` in `index.js` is a `Map<sampleName, string>` passed to `ProjectionTable`, used to display the time window as secondary text beneath the series label in the first column.

## See Also
`PLAN.md` — running implementation log and remaining tasks.
