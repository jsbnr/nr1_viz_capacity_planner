/**
 * @fileoverview Root component for the Capacity Planning Custom Visualisation.
 *
 * Wires together:
 *  - Configuration props (from nr1.json schema)
 *  - useNerdGraphBatch hook (batched NRQL fetching)
 *  - linearRegression util (per-series trend computation)
 *  - ScatterPlot, ProjectionTable, and LoadingState components
 */

import React, { useMemo } from 'react';

const COLOUR_PALETTE = [
  '#00C7F9', // Series 1 - sky blue
  '#26DEC1', // Series 2 - teal
  '#FFC400', // Series 3 - yellow
  '#FF8D30', // Series 4 - orange
  '#FF2D96', // Series 5 - pink
  '#9747FF', // Series 6 - purple
  '#6A00F4', // Series 7 - deep purple
  '#007DF9', // Series 8 - blue
  '#8D9395', // Series 9 - grey
];

const CSS_NAMED_COLORS = {
  aliceblue:'#f0f8ff',antiquewhite:'#faebd7',aqua:'#00ffff',aquamarine:'#7fffd4',
  azure:'#f0ffff',beige:'#f5f5dc',bisque:'#ffe4c4',black:'#000000',
  blanchedalmond:'#ffebcd',blue:'#0000ff',blueviolet:'#8a2be2',brown:'#a52a2a',
  burlywood:'#deb887',cadetblue:'#5f9ea0',chartreuse:'#7fff00',chocolate:'#d2691e',
  coral:'#ff7f50',cornflowerblue:'#6495ed',cornsilk:'#fff8dc',crimson:'#dc143c',
  cyan:'#00ffff',darkblue:'#00008b',darkcyan:'#008b8b',darkgoldenrod:'#b8860b',
  darkgray:'#a9a9a9',darkgreen:'#006400',darkgrey:'#a9a9a9',darkkhaki:'#bdb76b',
  darkmagenta:'#8b008b',darkolivegreen:'#556b2f',darkorange:'#ff8c00',darkorchid:'#9932cc',
  darkred:'#8b0000',darksalmon:'#e9967a',darkseagreen:'#8fbc8f',darkslateblue:'#483d8b',
  darkslategray:'#2f4f4f',darkslategrey:'#2f4f4f',darkturquoise:'#00ced1',darkviolet:'#9400d3',
  deeppink:'#ff1493',deepskyblue:'#00bfff',dimgray:'#696969',dimgrey:'#696969',
  dodgerblue:'#1e90ff',firebrick:'#b22222',floralwhite:'#fffaf0',forestgreen:'#228b22',
  fuchsia:'#ff00ff',gainsboro:'#dcdcdc',ghostwhite:'#f8f8ff',gold:'#ffd700',
  goldenrod:'#daa520',gray:'#808080',green:'#008000',greenyellow:'#adff2f',
  grey:'#808080',honeydew:'#f0fff0',hotpink:'#ff69b4',indianred:'#cd5c5c',
  indigo:'#4b0082',ivory:'#fffff0',khaki:'#f0e68c',lavender:'#e6e6fa',
  lavenderblush:'#fff0f5',lawngreen:'#7cfc00',lemonchiffon:'#fffacd',lightblue:'#add8e6',
  lightcoral:'#f08080',lightcyan:'#e0ffff',lightgoldenrodyellow:'#fafad2',lightgray:'#d3d3d3',
  lightgreen:'#90ee90',lightgrey:'#d3d3d3',lightpink:'#ffb6c1',lightsalmon:'#ffa07a',
  lightseagreen:'#20b2aa',lightskyblue:'#87cefa',lightslategray:'#778899',lightslategrey:'#778899',
  lightsteelblue:'#b0c4de',lightyellow:'#ffffe0',lime:'#00ff00',limegreen:'#32cd32',
  linen:'#faf0e6',magenta:'#ff00ff',maroon:'#800000',mediumaquamarine:'#66cdaa',
  mediumblue:'#0000cd',mediumorchid:'#ba55d3',mediumpurple:'#9370db',mediumseagreen:'#3cb371',
  mediumslateblue:'#7b68ee',mediumspringgreen:'#00fa9a',mediumturquoise:'#48d1cc',mediumvioletred:'#c71585',
  midnightblue:'#191970',mintcream:'#f5fffa',mistyrose:'#ffe4e1',moccasin:'#ffe4b5',
  navajowhite:'#ffdead',navy:'#000080',oldlace:'#fdf5e6',olive:'#808000',
  olivedrab:'#6b8e23',orange:'#ffa500',orangered:'#ff4500',orchid:'#da70d6',
  palegoldenrod:'#eee8aa',palegreen:'#98fb98',paleturquoise:'#afeeee',palevioletred:'#db7093',
  papayawhip:'#ffefd5',peachpuff:'#ffdab9',peru:'#cd853f',pink:'#ffc0cb',
  plum:'#dda0dd',powderblue:'#b0e0e6',purple:'#800080',rebeccapurple:'#663399',
  red:'#ff0000',rosybrown:'#bc8f8f',royalblue:'#4169e1',saddlebrown:'#8b4513',
  salmon:'#fa8072',sandybrown:'#f4a460',seagreen:'#2e8b57',seashell:'#fff5ee',
  sienna:'#a0522d',silver:'#c0c0c0',skyblue:'#87ceeb',slateblue:'#6a5acd',
  slategray:'#708090',slategrey:'#708090',snow:'#fffafa',springgreen:'#00ff7f',
  steelblue:'#4682b4',tan:'#d2b48c',teal:'#008080',thistle:'#d8bfd8',
  tomato:'#ff6347',turquoise:'#40e0d0',violet:'#ee82ee',wheat:'#f5deb3',
  white:'#ffffff',whitesmoke:'#f5f5f5',yellow:'#ffff00',yellowgreen:'#9acd32',
};

function resolveColor(color) {
  if (!color) return '#888888';
  const s = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s[1]+s[1]+s[2]+s[2]+s[3]+s[3];
  return CSS_NAMED_COLORS[s.toLowerCase()] ?? s;
}

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6;
    }
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  const s1 = s / 100, l1 = l / 100;
  const a = s1 * Math.min(l1, 1 - l1);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l1 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function generateShades(baseHex, n) {
  const resolved = resolveColor(baseHex);
  if (n === 1) return [resolved];
  const [h, s, l] = hexToHsl(resolved);
  const baseSat = Math.max(s, 40);
  const lo = Math.max(30, l - 20);
  const hi = Math.min(72, l + 20);
  return Array.from({ length: n }, (_, i) => {
    const lightness = n === 1 ? l : lo + ((hi - lo) / (n - 1)) * i;
    return hslToHex(h, baseSat, lightness);
  });
}
function formatEpochWindow(startSec, endSec) {
  const opts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
  const start = new Date(startSec * 1000).toLocaleString(undefined, opts);
  const end   = new Date(endSec   * 1000).toLocaleString(undefined, opts);
  return `${start} – ${end}`;
}

import { BlockText, EmptyState, PlatformStateContext } from 'nr1';

import useNerdGraphBatch from './hooks/useNerdGraphBatch';
import { linearRegression, polynomialRegression, powerRegression, exponentialRegression } from './utils/regression';

const REGRESSION_FNS = {
  linear: linearRegression,
  polynomial: polynomialRegression,
  power: powerRegression,
  exponential: exponentialRegression,
};
import ScatterPlot from './components/ScatterPlot';
import ProjectionTable from './components/ProjectionTable';
import LoadingState from './components/LoadingState';

import './styles.scss';

/**
 * CapacityPlannerViz
 *
 * Receives all configuration from the NR1 config panel (as defined in nr1.json).
 *
 * @param {{
 *   bucketSize: number,
 *   targetThroughput: string|undefined,
 *   xAxisMultiplier: number|undefined,
 *   xAxisLabel: string|undefined,
 *   yAxisLabel: string|undefined,
 *   multipliers: string|undefined,
 *   samples: Array<{
 *     accountId: number,
 *     name: string,
 *     color: string|undefined,
 *     startTime: string,
 *     endTime: string,
 *     throughputQuery: string,
 *     metricsQuery: string
 *   }>
 * }} props
 */
export default function CapacityPlannerViz({
  targetThroughput,
  xAxisMultiplier,
  xAxisLabel,
  yAxisLabel,
  multipliers,
  tpsPercentile,
  regressionType,
  samples,
}) {
  const { timeRange } = React.useContext(PlatformStateContext);
  const effectiveMultiplier = xAxisMultiplier || 1;

  // --- Parse target throughputs (comma-delimited string → sorted number array) ---
  const targetThroughputs = useMemo(() => {
    if (!targetThroughput) return [];
    const parsed = String(targetThroughput)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    return [...new Set(parsed)].sort((a, b) => a - b);
  }, [targetThroughput]);

  // --- Parse multiplier columns (comma-delimited string → sorted number array) ---
  const effectiveMultipliers = useMemo(() => {
    if (!multipliers) return [];
    const parsed = multipliers
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    return [...new Set(parsed)].sort((a, b) => a - b);
  }, [multipliers]);

  // --- Guard: no samples configured ---
  const validSamples = Array.isArray(samples) ? samples.filter((s) => s && s.name) : [];

  // --- Strip cosmetic fields so the hook only re-fetches when query params change ---
  const querySamples = useMemo(() => {
    const nowMs = Date.now();
    return validSamples.map(({
      accountId, name, startTime, endTime,
      throughputQuery, metricsQuery,
      useTimePicker, defaultDurationMinutes, bucketSize,
    }) => {
      if (useTimePicker) {
        let startEpoch, endEpoch;
        if (timeRange?.begin_time && timeRange?.end_time) {
          // Absolute range (platform values are milliseconds)
          startEpoch = Math.floor(timeRange.begin_time / 1000);
          endEpoch   = Math.floor(timeRange.end_time   / 1000);
        } else if (timeRange?.duration) {
          // Relative range (duration is milliseconds)
          endEpoch   = Math.floor(nowMs / 1000);
          startEpoch = endEpoch - Math.floor(timeRange.duration / 1000);
        } else {
          // "Default" — fall back to configured minutes (or 60)
          const minutes = (defaultDurationMinutes > 0 ? defaultDurationMinutes : 60);
          endEpoch   = Math.floor(nowMs / 1000);
          startEpoch = endEpoch - minutes * 60;
        }
        return { accountId, name, throughputQuery, metricsQuery, startEpoch, endEpoch, bucketSize };
      }
      return { accountId, name, startTime, endTime, throughputQuery, metricsQuery, bucketSize };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(validSamples), timeRange]);

  // --- Build time window label per sample (for display in the projection table) ---
  const sampleTimeWindows = useMemo(() => {
    const map = new Map();
    for (const s of querySamples) {
      let label;
      if (s.startEpoch != null && s.endEpoch != null) {
        label = formatEpochWindow(s.startEpoch, s.endEpoch);
      } else if (s.startTime) {
        label = s.endTime ? `${s.startTime} – ${s.endTime}` : s.startTime;
      }
      if (label) map.set(s.name, label);
    }
    return map;
  }, [querySamples]);

  // --- Fetch batched NRQL data ---
  const { series, warnings, loading, error, progress } = useNerdGraphBatch(querySamples);

  // --- Build colour map: seriesLabel → colour ---
  // Each series gets its own colour. Series within the same sample share a hue
  // but get distinct lightness shades. User-configured sample colours are used
  // as the base hue for that sample's shades.
  const seriesColourMap = useMemo(() => {
    const map = new Map();
    // Assign a base palette colour per sample
    const sampleBaseColor = new Map();
    validSamples.forEach((s) => {
      if (s.color) sampleBaseColor.set(s.name, s.color);
    });
    let paletteIdx = 0;
    for (const s of series) {
      if (!sampleBaseColor.has(s.sampleName)) {
        sampleBaseColor.set(s.sampleName, COLOUR_PALETTE[paletteIdx % COLOUR_PALETTE.length]);
        paletteIdx++;
      }
    }
    // Group series labels by sample (preserving insertion order)
    const groups = new Map();
    for (const s of series) {
      if (!groups.has(s.sampleName)) groups.set(s.sampleName, []);
      groups.get(s.sampleName).push(s.label);
    }
    // Generate shades and assign to each series label
    for (const [sampleName, labels] of groups) {
      const shades = generateShades(sampleBaseColor.get(sampleName), labels.length);
      labels.forEach((label, i) => map.set(label, shades[i]));
    }
    return map;
  }, [validSamples, series]);

  /**
   * Run linear regression for every series.
   * Returns a Map<label, regressionResult|null>.
   *
   * useMemo ensures this only recalculates when the series data actually changes.
   */
  const regressions = useMemo(() => {
    const fn = REGRESSION_FNS[regressionType] ?? linearRegression;
    const map = new Map();
    for (const s of series) {
      map.set(s.label, fn(s.points));
    }
    return map;
  }, [series, regressionType]);

  /**
   * Determine the maximum X value for the scatter plot axis.
   *
   * xMax = max(targetThroughput, effectiveMultiplier × maxObserved, largestMultiplier × maxObserved)
   */
  const xMax = useMemo(() => {
    let maxObserved = 0;
    for (const s of series) {
      for (const { x } of s.points) {
        if (x > maxObserved) maxObserved = x;
      }
    }
    const largestMultiplier = effectiveMultipliers.length > 0 ? effectiveMultipliers[effectiveMultipliers.length - 1] : 0;
    const largestTarget = targetThroughputs.length > 0 ? targetThroughputs[targetThroughputs.length - 1] : 0;
    return Math.max(
      largestTarget,
      effectiveMultiplier * maxObserved,
      largestMultiplier * maxObserved,
      1,
    );
  }, [series, effectiveMultiplier, effectiveMultipliers, targetThroughputs]);

  // --- Render states ---

  if (validSamples.length === 0) {
    return (
      <EmptyState
        title="No samples configured"
        description="Add at least one data sample in the visualisation configuration panel. Each sample requires a name, time window, throughput query, and metrics query."
      />
    );
  }

  if (loading) {
    return (
      <div className="capacity-root">
        <LoadingState progress={progress} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="capacity-root">
        <BlockText type={BlockText.TYPE.PARAGRAPH}>
          <strong>Error loading data:</strong> {error}
        </BlockText>
      </div>
    );
  }

  if (series.length === 0) {
    return (
      <EmptyState
        title="No data returned"
        description="The queries returned no results for the configured time windows. Check that your NRQL queries are valid and that data exists in the selected time ranges."
      />
    );
  }

  return (
    <div className="capacity-root">
      {warnings.length > 0 && (
        <div className="capacity-warnings">
          {warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}
      <ScatterPlot
        series={series}
        regressions={regressions}
        xMax={xMax}
        xAxisLabel={xAxisLabel}
        yAxisLabel={yAxisLabel}
        sampleColourMap={seriesColourMap}
        targetThroughputs={targetThroughputs}
      />
      <ProjectionTable
        series={series}
        regressions={regressions}
        targetThroughputs={targetThroughputs}
        sampleColourMap={seriesColourMap}
        multipliers={effectiveMultipliers}
        tpsPercentile={tpsPercentile}
        sampleTimeWindows={sampleTimeWindows}
      />
    </div>
  );
}
