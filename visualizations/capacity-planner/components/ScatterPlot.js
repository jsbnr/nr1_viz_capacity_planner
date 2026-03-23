import React, { useMemo, useRef, useState } from 'react';
import {
  ComposedChart,
  Scatter,
  Line,
  ReferenceDot,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { predictAny as predict } from '../utils/regression';


/**
 * Returns a CustomTooltip component that closes over trendMeta + sampleColourMap
 * so it can compute y values directly from the regression rather than trusting
 * Recharts' payload (which can map to the wrong data index when Scatter and Line
 * series coexist with different data arrays).
 *
 * Recharts reliably passes `label` as the actual cursor x value for numeric axes,
 * so we use that as the input to predict() for each series.
 */
function makeTooltip(trendMeta, sampleColourMap) {
  return function CustomTooltip({ active, label }) {
    if (!active || label == null) return null;
    const x = Number(label);
    if (isNaN(x)) return null;

    return (
      <div className="capacity-tooltip">
        <div style={{ marginBottom: 4, opacity: 0.7, fontSize: '0.85em' }}>
          TPS: {Math.round(x).toLocaleString()}
        </div>
        {trendMeta.map(({ label: seriesLabel, reg }) => {
          const y = predict(reg, x);
          const color = sampleColourMap.get(seriesLabel);
          return (
            <div key={seriesLabel} style={{ color }}>
              <strong>{seriesLabel}</strong>: {y != null ? y.toFixed(3) : '—'}
            </div>
          );
        })}
      </div>
    );
  };
}

/**
 * Renders a Recharts ComposedChart with one Scatter series per
 * (sampleName × metricName) pair and a dashed regression trend Line for each.
 *
 * @param {{
 *   series: Array<{
 *     sampleName: string,
 *     metricName: string,
 *     label: string,
 *     points: Array<{x: number, y: number}>
 *   }>,
 *   regressions: Map<string, {slope: number, intercept: number, r2: number}|null>,
 *   xMax: number,
 *   xAxisLabel: string|undefined,
 *   yAxisLabel: string|undefined,
 *   sampleColourMap: Map<string, string>
 * }} props
 * @returns {React.ReactElement}
 */
export default function ScatterPlot({ series, regressions, xMax, xAxisLabel, yAxisLabel, sampleColourMap, targetThroughputs }) {
  const resolvedXLabel = xAxisLabel || 'Throughput';
  const resolvedYLabel = yAxisLabel || 'Metric Value';

  // --- all useState/useRef hooks first so useMemo deps are never in TDZ ---
  const [hoverX, setHoverX] = useState(null);
  const [xDomain, setXDomain] = useState(null);
  const [selectionArea, setSelectionArea] = useState(null);
  const [selectedSeries, setSelectedSeries] = useState(new Set());
  const dragStartRef = useRef(null);
  const dragEndRef = useRef(null);

  const activeDomain = xDomain || [0, xMax];

  const TREND_POINTS = 200;

  const { trendData, trendMeta } = useMemo(() => {
    const meta = series
      .map((s) => ({ label: s.label, sampleName: s.sampleName, reg: regressions.get(s.label) }))
      .filter(({ reg }) => reg);

    const [domLo, domHi] = activeDomain;
    const data = Array.from({ length: TREND_POINTS + 1 }, (_, i) => {
      const x = domLo + ((domHi - domLo) / TREND_POINTS) * i;
      const point = { x };
      for (const { label, reg } of meta) {
        point[label] = predict(reg, x);
      }
      return point;
    });

    return { trendData: data, trendMeta: meta };
  }, [series, regressions, activeDomain]);

  const yMax = useMemo(() => {
    const isActive = (label) => selectedSeries.size === 0 || selectedSeries.has(label);
    let max = 0;
    for (const s of series) {
      if (!isActive(s.label)) continue;
      for (const p of s.points) {
        if (p.x >= activeDomain[0] && p.x <= activeDomain[1] && p.y > max) max = p.y;
      }
    }
    for (const { label } of trendMeta) {
      if (!isActive(label)) continue;
      const tip = trendData[trendData.length - 1][label];
      if (tip != null && tip > max) max = tip;
    }
    if (targetThroughputs && targetThroughputs.length > 0) {
      const largestTarget = targetThroughputs[targetThroughputs.length - 1];
      for (const { label, reg } of trendMeta) {
        if (!isActive(label)) continue;
        const y = predict(reg, largestTarget);
        if (y != null && y > max) max = y;
      }
    }
    return max * 1.05;
  }, [series, trendData, trendMeta, activeDomain, targetThroughputs, selectedSeries]);

  const TooltipContent = useMemo(
    () => makeTooltip(trendMeta, sampleColourMap),
    [trendMeta, sampleColourMap]
  );

  if (!series || series.length === 0) return null;

  function handleLegendClick(data, _index, event) {
    const label = data.value;
    setSelectedSeries(prev => {
      const next = new Set(prev);
      if (event?.altKey) {
        // Alt-click = hide this series.
        // If nothing is selected yet (all visible), seed the set with everyone
        // else so the clicked series ends up as the only one that's absent.
        if (next.size === 0) {
          for (const s of series) next.add(s.label);
        }
        next.delete(label);
      } else if (next.has(label)) {
        // If all series are selected, re-isolate to just this one rather than
        // removing it (which would invert the behaviour unexpectedly).
        if (next.size === series.length) {
          next.clear();
          next.add(label);
        } else {
          next.delete(label);
        }
      } else {
        next.add(label);
      }
      return next;
    });
  }

  function getSeriesOpacity(label) {
    if (selectedSeries.size === 0) return 0.4;
    return selectedSeries.has(label) ? 0.7 : 0.07;
  }

  function handleMouseDown(e) {
    if (e && e.activeLabel != null) {
      dragStartRef.current = Number(e.activeLabel);
      dragEndRef.current = null;
      setSelectionArea(null);
    }
  }

  function handleMouseMove(e) {
    setHoverX(e && e.activeLabel != null ? Number(e.activeLabel) : null);
    if (dragStartRef.current != null && e && e.activeLabel != null) {
      dragEndRef.current = Number(e.activeLabel);
      setSelectionArea({ x1: dragStartRef.current, x2: dragEndRef.current });
    }
  }

  function handleMouseUp() {
    const start = dragStartRef.current;
    const end = dragEndRef.current;
    if (start != null && end != null && start !== end) {
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      setXDomain([lo, hi]);
    }
    dragStartRef.current = null;
    dragEndRef.current = null;
    setSelectionArea(null);
  }

  return (
    <div className="capacity-chart-wrapper" onMouseUp={handleMouseUp} style={{ userSelect: 'none' }}>
      {xDomain && (
        <button
          onClick={() => setXDomain(null)}
          style={{ marginBottom: 8, fontSize: '0.8em', cursor: 'pointer' }}
        >
          Reset zoom
        </button>
      )}
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart
          margin={{ top: 20, right: 20, bottom: 20, left: 30 }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => { setHoverX(null); }}
        >
          <CartesianGrid strokeDasharray="3 3" />

          <XAxis
            dataKey="x"
            type="number"
            name={resolvedXLabel}
            domain={activeDomain}
            ticks={(() => {
              const [lo, hi] = activeDomain;
              const count = 6;
              return Array.from({ length: count + 1 }, (_, i) => Math.round(lo + ((hi - lo) / count) * i));
            })()}
            label={{ value: resolvedXLabel, position: 'insideBottom', offset: -10 }}
            tickFormatter={(v) => v.toLocaleString()}
          />

          <YAxis
            dataKey="y"
            type="number"
            name={resolvedYLabel}
            domain={[0, yMax]}
            ticks={(() => {
              const count = 6;
              return Array.from({ length: count + 1 }, (_, i) => (yMax / count) * i);
            })()}
            tickFormatter={(v) => Number.isFinite(v) ? +v.toPrecision(4) : v}
            label={{ value: resolvedYLabel, angle: -90, position: 'insideLeft' }}
          />

          <Tooltip content={<TooltipContent />} />
          <Legend
            layout="vertical"
            align="right"
            verticalAlign="middle"
            wrapperStyle={{ paddingLeft: 24, paddingTop: 8, paddingBottom: 8 }}
            content={({ payload }) => (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {payload.filter(entry => entry.type !== 'none').map((entry) => {
                  const isGreyed = selectedSeries.size > 0 && !selectedSeries.has(entry.value);
                  const color = isGreyed ? '#aaa' : entry.color;
                  const opacity = isGreyed ? 0.4 : 1;
                  return (
                    <li
                      key={entry.value}
                      onClick={(e) => handleLegendClick(entry, null, e)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer', opacity }}
                    >
                      <svg width={8} height={8}><circle cx={4} cy={4} r={4} fill={color} /></svg>
                      <span style={{ color, fontSize: '0.85em' }}>{entry.value}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          />

          {/* One Scatter series per (sample × metric) pair.
              tooltipType="none" prevents sparse scatter points from hijacking
              the tooltip's x-axis snap position away from the trend lines. */}
          {series.map((s) => {
            const isHidden = selectedSeries.size > 0 && !selectedSeries.has(s.label);
            return (
            <Scatter
              key={`scatter-${s.label}`}
              name={s.label}
              data={isHidden ? [] : s.points.filter(p => p.x >= activeDomain[0] && p.x <= activeDomain[1])}
              fill={sampleColourMap.get(s.label)}
              legendType="circle"
              tooltipType="none"
              shape={(props) => {
                const { cx, cy, fill } = props;
                return <circle cx={cx} cy={cy} r={3} fill={fill} fillOpacity={0.7} pointerEvents="none" />;
              }}
            />
            );
          })}

          {/* One dashed trend Line per regression — all share trendData so
              Recharts resolves each series' y independently at the hovered x.
              Hidden series get an empty data array so Recharts excludes them
              from its internal Y axis extent calculation. */}
          {trendMeta.map((trend) => {
            const isHidden = selectedSeries.size > 0 && !selectedSeries.has(trend.label);
            return (
            <Line
              key={`trend-${trend.label}`}
              name={`${trend.label} (trend)`}
              data={isHidden ? [] : trendData}
              dataKey={trend.label}
              stroke={selectedSeries.size > 0 && !selectedSeries.has(trend.label) ? '#aaa' : sampleColourMap.get(trend.label)}
              strokeDasharray="5 5"
              strokeWidth={2}
              strokeOpacity={selectedSeries.size === 0 ? 1 : selectedSeries.has(trend.label) ? 1 : 0.1}
              dot={false}
              activeDot={false}
              legendType="none"
              isAnimationActive={false}
            />
            );
          })}
          {/* Hover dots placed at the exact regression-computed y for hoverX */}
          {hoverX != null && trendMeta.map(({ label, reg }) => {
            const y = predict(reg, hoverX);
            if (y == null) return null;
            return (
              <ReferenceDot
                key={`hover-${label}`}
                x={hoverX}
                y={y}
                r={5}
                fill={sampleColourMap.get(label)}
                stroke="none"
                ifOverflow="hidden"
              />
            );
          })}
          {(targetThroughputs || []).map((t) => (
            <ReferenceLine
              key={`target-${t}`}
              x={t}
              stroke="#ff6b6b"
              strokeDasharray="4 4"
              strokeWidth={2}
              label={{ value: t.toLocaleString(), position: 'top', fontSize: 11, fill: '#ff6b6b' }}
            />
          ))}
          {selectionArea && (
            <ReferenceArea
              x1={selectionArea.x1}
              x2={selectionArea.x2}
              strokeOpacity={0.3}
              fill="#8884d8"
              fillOpacity={0.2}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
