import React from 'react';
import {
  Table,
  TableHeader,
  TableHeaderCell,
  TableRow,
  TableRowCell,
} from 'nr1';
import { predictAny as predict } from '../utils/regression';

/** Default percentile used for baseline throughput. */
const DEFAULT_TPS_PERCENTILE = 95;

/**
 * Returns the Pn value from a numeric array using linear interpolation.
 * @param {number[]} values  Unsorted source values.
 * @param {number}   p       Percentile 1–100.
 * @returns {number|null}
 */
function percentile(values, p) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Formats a number to 2 decimal places, or returns '—' for null/undefined/NaN.
 *
 * @param {number|null|undefined} value
 * @returns {string}
 */
function fmt(value) {
  if (value == null || isNaN(value)) return '—';
  return value.toFixed(2);
}

/**
 * Renders a projection table using the NR1 SDK Table components.
 *
 * Each row represents one (sampleName × metricName) series.  Columns show:
 *  - Series label
 *  - @ 1x  — current average metric value from the sample data
 *  - @ 2x  — predicted metric at 2× average throughput
 *  - @ 4x  — predicted metric at 4× average throughput
 *  - @ 10x — predicted metric at 10× average throughput
 *  - @ Target — predicted metric at the configured target throughput (column
 *               is omitted if targetThroughput is not set)
 *
 * @param {{
 *   series: Array<{
 *     sampleName: string,
 *     metricName: string,
 *     label: string,
 *     points: Array<{x: number, y: number}>
 *   }>,
 *   regressions: Map<string, {slope: number, intercept: number, r2: number}|null>,
 *   targetThroughput: number|null|undefined,
 *   sampleColourMap: Map<string, string>,
 *   multipliers: number[]|undefined
 * }} props
 * @returns {React.ReactElement|null}
 */
export default function ProjectionTable({ series, regressions, targetThroughputs, sampleColourMap, multipliers, tpsPercentile, sampleTimeWindows }) {
  const activeMultipliers = multipliers || [];
  if (!series || series.length === 0) return null;

  const activeTargets = (targetThroughputs || []).filter((t) => Number.isFinite(t));
  const pct = (tpsPercentile != null && !isNaN(tpsPercentile))
    ? Math.min(100, Math.max(1, tpsPercentile))
    : DEFAULT_TPS_PERCENTILE;

  /**
   * Pre-compute the row data for each series so the JSX stays clean.
   * For each series we calculate:
   *   baseThroughput = Pn of x values
   *   @ Nx = predict(regression, N * baseThroughput)
   */
  const rows = series.map((s) => {
    const { points, label, sampleName } = s;
    const reg = regressions.get(label);

    const baseThroughput = percentile(points.map((p) => p.x), pct);

    const projections = {};
    for (const mult of activeMultipliers) {
      if (reg && baseThroughput != null) {
        projections[mult] = predict(reg, mult * baseThroughput);
      } else {
        projections[mult] = null;
      }
    }

    const atTargets = activeTargets.map((t) =>
      reg && baseThroughput != null ? predict(reg, t) : null
    );

    const r2 = reg ? reg.r2 : null;

    const colour = sampleColourMap ? sampleColourMap.get(label) : undefined;
    const timeWindow = sampleTimeWindows ? sampleTimeWindows.get(sampleName) : undefined;
    return { label, sampleName, timeWindow, baseThroughput, projections, atTargets, r2, colour };
  });

  return (
    <div className="capacity-table-wrapper">
      <h3 className="capacity-table-title">Metric Projections</h3>
      <Table items={rows}>
        <TableHeader>
          <TableHeaderCell>Series</TableHeaderCell>
          <TableHeaderCell value={({ item }) => item.baseThroughput}>P{pct} TPS</TableHeaderCell>
          {activeMultipliers.map((m) => (
            <TableHeaderCell key={`hdr-${m}x`} value={({ item }) => item.projections[m]}>
              @ {m}x
            </TableHeaderCell>
          ))}
          {activeTargets.map((t) => (
            <TableHeaderCell key={`hdr-target-${t}`} value={({ item }) => item.atTargets[activeTargets.indexOf(t)]}>
              @ {t.toLocaleString()}
            </TableHeaderCell>
          ))}
          <TableHeaderCell value={({ item }) => item.r2}>R²</TableHeaderCell>
        </TableHeader>

        {({ item }) => (
          <TableRow>
            <TableRowCell>
              <span style={{ display: 'inline-flex', flexDirection: 'column', overflow: 'hidden', maxWidth: '100%' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {item.colour && (
                    <span style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: item.colour,
                      flexShrink: 0,
                    }} />
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'clip', whiteSpace: 'nowrap' }}>{item.label}</span>
                </span>
                {item.timeWindow && (
                  <span style={{ fontSize: '0.75em', opacity: 0.6, whiteSpace: 'nowrap' }}>
                    {item.timeWindow}
                  </span>
                )}
              </span>
            </TableRowCell>
            <TableRowCell>
              {item.baseThroughput != null ? Math.round(item.baseThroughput).toLocaleString() : '—'}
            </TableRowCell>
            {activeMultipliers.map((m) => (
              <TableRowCell key={`cell-${m}x`}>
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                  <span>{fmt(item.projections[m])}</span>
                  {item.baseThroughput != null && (
                    <span style={{ fontSize: '0.75em', opacity: 0.6 }}>
                      {Math.round(m * item.baseThroughput).toLocaleString()} TPS
                    </span>
                  )}
                </span>
              </TableRowCell>
            ))}
            {activeTargets.map((t, i) => (
              <TableRowCell key={`cell-target-${t}`}>
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                  <span>{fmt(item.atTargets[i])}</span>
                  <span style={{ fontSize: '0.75em', opacity: 0.6 }}>
                    {t.toLocaleString()} TPS
                  </span>
                </span>
              </TableRowCell>
            ))}
            <TableRowCell>{fmt(item.r2)}</TableRowCell>
          </TableRow>
        )}
      </Table>
    </div>
  );
}
