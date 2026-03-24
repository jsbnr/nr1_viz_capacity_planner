/**
 * @fileoverview Custom React hook that fetches NRQL time-series data for multiple
 * named samples, automatically splitting queries into batches when the requested
 * window would exceed the NRQL TIMESERIES bucket limit of 366 per query.
 */

import { useState, useEffect, useRef } from 'react';
import { NerdGraphQuery } from 'nr1';

/** Used as the default end-time fallback when no end is specified. Not a hard cap. */
export const MAX_WINDOW_HOURS = 24;

/** NRQL TIMESERIES queries are capped at 366 buckets per request. */
const MAX_BUCKETS_PER_QUERY = 366;

/**
 * Maximum NerdGraph batch requests per sample. If the window + bucket size would
 * exceed this, bucket size is auto-scaled upward and a warning is emitted.
 * 4 batches covers 24 h at 1-minute granularity (1440 buckets → ceil(1440/366) = 4).
 */
const MAX_BATCHES = 4;

/**
 * Keys that appear in every NRQL TIMESERIES result row but are not metric values.
 * These are excluded when extracting numeric metric columns.
 */
const NRQL_META_KEYS = new Set([
  'beginTimeSeconds',
  'endTimeSeconds',
  'timestamp',
  'facet',
  'compareWith',
]);

/**
 * Parses a date string in "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DD" format into a Unix epoch (seconds).
 * When only the date part is provided the time defaults to 00:00:00.
 *
 * @param {string} dateStr - Date string to parse.
 * @returns {number} Unix timestamp in seconds.
 * @throws {Error} If the string cannot be parsed.
 */
function parseDateToEpoch(dateStr) {
  // Normalise "YYYY-MM-DD" → "YYYY-MM-DDTHH:mm:ss" so Date.parse treats it as local time.
  const normalised = /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())
    ? `${dateStr.trim()}T00:00:00`
    : dateStr.replace(' ', 'T');
  const ts = Date.parse(normalised);
  if (isNaN(ts)) {
    throw new Error(`Cannot parse date: "${dateStr}". Expected format: YYYY-MM-DD or YYYY-MM-DD HH:mm:ss`);
  }
  return Math.floor(ts / 1000);
}

/**
 * Builds a NerdGraph GraphQL query string that runs a single NRQL query against
 * a specific account.
 *
 * The NRQL string is passed as-is (already includes TIMESERIES, SINCE, UNTIL).
 *
 * @param {number} accountId - New Relic account ID.
 * @param {string} nrql - Fully formed NRQL string.
 * @param {string} alias - GraphQL alias for this query result (must be unique per request).
 * @returns {string} GraphQL fragment for one NRQL query.
 */
function buildNrqlFragment(accountId, nrql, alias) {
  // Escape backticks and backslashes inside the NRQL string.
  const escaped = nrql.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `
    ${alias}: actor {
      account(id: ${accountId}) {
        nrql(query: "${escaped}", timeout: 60) {
          results
        }
      }
    }
  `;
}

/**
 * Executes a NerdGraph query and returns the parsed response data.
 *
 * @param {string} query - Full GraphQL query string.
 * @returns {Promise<object>} Parsed GraphQL response `data` object.
 * @throws {Error} If the NerdGraph request contains errors.
 */
async function runNerdGraphQuery(query) {
  const { data, errors } = await NerdGraphQuery.query({ query: `{ ${query} }` });
  if (errors && errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join('; '));
  }
  return data;
}

/**
 * Extracts metric column names from a NRQL TIMESERIES result row by excluding
 * known meta-keys (beginTimeSeconds, endTimeSeconds, etc.) and any additional
 * keys provided (e.g. facet dimension columns).
 *
 * Values are NOT checked for type here — a bucket row may have null values when
 * there is no data in that time window. Null filtering happens downstream in
 * buildSeries where points are only pushed when both x and y are numbers.
 *
 * @param {object} row - A single result row from a NRQL TIMESERIES response.
 * @param {Set<string>} [extraExclusions] - Additional keys to exclude (e.g. facet dimension columns).
 * @returns {string[]} Array of metric column names.
 */
function extractMetricKeys(row, extraExclusions = new Set()) {
  return Object.keys(row).filter((key) => !NRQL_META_KEYS.has(key) && !extraExclusions.has(key));
}

/**
 * Identifies column names in a faceted result row that carry the facet dimension
 * values (e.g. for `FACET awsAPI`, each row contains `awsAPI: "dynamodb"` in
 * addition to `facet: "dynamodb"`). These columns must be excluded from metric
 * key extraction to avoid being treated as metrics.
 *
 * Detection: a non-meta key whose value equals the facet value (or one of the
 * facet array elements for multi-dimension facets) is considered a facet column.
 *
 * @param {Map<string, Map<number, object>>} facetMaps - Output of mergeResultsByTimestampFaceted.
 * @returns {Set<string>} Column names that are facet dimension keys.
 */
function detectFacetColumnNames(facetMaps) {
  for (const [facetKey, tsMap] of facetMaps) {
    const firstRow = tsMap.values().next().value;
    if (!firstRow) continue;
    const facetValues = new Set(facetKey.split(' | '));
    const cols = new Set();
    for (const [key, val] of Object.entries(firstRow)) {
      if (NRQL_META_KEYS.has(key)) continue;
      if (facetValues.has(String(val))) cols.add(key);
    }
    if (cols.size > 0) return cols;
  }
  return new Set();
}

/**
 * Serializes a NRQL facet value (string or array) to a stable string key.
 *
 * @param {string|string[]} facetValue - The `facet` field value from a NRQL result row.
 * @returns {string} Stable string key.
 */
function getFacetKey(facetValue) {
  return Array.isArray(facetValue) ? facetValue.join(' | ') : String(facetValue);
}

/**
 * Returns true if any row in the given batches contains a `facet` field,
 * indicating the query used a FACET clause.
 *
 * @param {Array<Array<object>>} batches
 * @returns {boolean}
 */
function isFacetedResults(batches) {
  for (const batch of batches) {
    for (const row of batch) {
      if ('facet' in row) return true;
    }
  }
  return false;
}

/**
 * Merges an array of NRQL result arrays (one per batch) into a single Map
 * keyed by `beginTimeSeconds`.
 *
 * @param {Array<Array<object>>} batches - Each element is the `results` array from one batch.
 * @returns {Map<number, object>} Map of beginTimeSeconds → result row.
 */
function mergeResultsByTimestamp(batches) {
  const map = new Map();
  for (const batch of batches) {
    for (const row of batch) {
      map.set(row.beginTimeSeconds, row);
    }
  }
  return map;
}

/**
 * Merges an array of faceted NRQL result arrays into a nested Map:
 * facetKey → Map<beginTimeSeconds, row>.
 *
 * @param {Array<Array<object>>} batches - Each element is the `results` array from one batch.
 * @returns {Map<string, Map<number, object>>}
 */
function mergeResultsByTimestampFaceted(batches) {
  const facetMaps = new Map();
  for (const batch of batches) {
    for (const row of batch) {
      const key = getFacetKey(row.facet);
      if (!facetMaps.has(key)) facetMaps.set(key, new Map());
      facetMaps.get(key).set(row.beginTimeSeconds, row);
    }
  }
  return facetMaps;
}

/**
 * Builds series for faceted query results by iterating over each facet value
 * that appears in both the throughput and metrics results.
 *
 * Facets present in throughput but absent from metrics are discarded and a
 * warning string is returned for each.
 *
 * @param {string} sampleName - Human-readable label for the sample.
 * @param {Map<string, Map<number, object>>} throughputFacetMaps - Facet → timestamp map.
 * @param {Map<string, Map<number, object>>} metricsFacetMaps - Facet → timestamp map.
 * @returns {{ series: Array<object>, warnings: string[] }}
 */
function buildFacetedSeries(sampleName, throughputFacetMaps, metricsFacetMaps) {
  const series = [];
  const warnings = [];

  // Detect facet dimension column names (e.g. `awsAPI`) so they are not treated as metrics.
  const facetColExclusions = new Set([
    ...detectFacetColumnNames(throughputFacetMaps),
    ...detectFacetColumnNames(metricsFacetMaps),
  ]);

  for (const [facetKey] of metricsFacetMaps) {
    if (!throughputFacetMaps.has(facetKey)) {
      warnings.push(
        `Sample "${sampleName}": facet "${facetKey}" found in metrics query but not in throughput query — series discarded.`,
      );
    }
  }

  for (const [facetKey, throughputMap] of throughputFacetMaps) {
    if (!metricsFacetMaps.has(facetKey)) {
      warnings.push(
        `Sample "${sampleName}": facet "${facetKey}" found in throughput query but not in metrics query — series discarded.`,
      );
      continue;
    }
    const metricsMap = metricsFacetMaps.get(facetKey);
    const seriesName = `${sampleName} — ${facetKey}`;
    series.push(...buildSeries(seriesName, throughputMap, metricsMap, facetColExclusions));
  }

  return { series, warnings };
}

/**
 * Builds series for the mixed case where throughput is non-faceted but the metrics
 * query uses a FACET clause. The single throughput map is reused as the X-axis for
 * every facet value found in the metrics results.
 *
 * @param {string} sampleName - Human-readable label for the sample.
 * @param {Map<number, object>} throughputMap - Flat timestamp → row map from mergeResultsByTimestamp.
 * @param {Map<string, Map<number, object>>} metricsFacetMaps - Facet → timestamp map.
 * @param {Set<string>} facetColExclusions - Facet dimension column names to exclude from metric keys.
 * @returns {Array<object>}
 */
function buildMixedFacetedSeries(sampleName, throughputMap, metricsFacetMaps, facetColExclusions) {
  const series = [];
  for (const [facetKey, metricsMap] of metricsFacetMaps) {
    const seriesName = `${sampleName} — ${facetKey}`;
    series.push(...buildSeries(seriesName, throughputMap, metricsMap, facetColExclusions));
  }
  return series;
}

/**
 * Joins throughput and metrics results by timestamp, producing an array of
 * `{sampleName, metricName, label, points}` series — one per discovered metric column.
 *
 * Handles percentile() results where NRQL returns an object value like
 * `{ "95": 0.123, "99": 0.456 }` instead of a plain number — each percentile
 * becomes its own sub-series (e.g. "p95 (95th)" and "p95 (99th)").
 *
 * Only timestamps present in both the throughput result and the metrics result
 * are included (inner join).
 *
 * @param {string} sampleName - Human-readable label for the sample.
 * @param {Map<number, object>} throughputMap - Keyed by beginTimeSeconds; each row has one numeric value.
 * @param {Map<number, object>} metricsMap - Keyed by beginTimeSeconds; each row may have multiple numeric values.
 * @returns {Array<{sampleName: string, metricName: string, label: string, points: Array<{x:number, y:number}>}>}
 */
function buildSeries(sampleName, throughputMap, metricsMap, extraExclusions = new Set()) {
  // Determine metric column names from the first available metrics row.
  const firstMetricsRow = metricsMap.values().next().value;
  if (!firstMetricsRow) return [];

  const metricKeys = extractMetricKeys(firstMetricsRow, extraExclusions);
  if (metricKeys.length === 0) return [];

  // Determine the throughput value key (first numeric non-meta column in throughput rows).
  const firstThroughputRow = throughputMap.values().next().value;
  if (!firstThroughputRow) return [];

  const throughputKey = extractMetricKeys(firstThroughputRow, extraExclusions)[0];
  if (!throughputKey) return [];

  // Expand metric keys: percentile() returns an object like { "95": 0.123, "99": 0.456 }
  // rather than a plain number. Detect this from the first row and produce one entry
  // per sub-key so each percentile becomes its own series.
  const seriesDefs = [];
  for (const metricName of metricKeys) {
    const firstVal = firstMetricsRow[metricName];
    if (firstVal !== null && typeof firstVal === 'object' && !Array.isArray(firstVal)) {
      for (const subKey of Object.keys(firstVal)) {
        if (typeof firstVal[subKey] === 'number') {
          seriesDefs.push({ metricName, subKey, displayName: `${metricName} (${subKey}th)` });
        }
      }
    } else {
      seriesDefs.push({ metricName, subKey: null, displayName: metricName });
    }
  }

  return seriesDefs.map(({ metricName, subKey, displayName }) => {
    const points = [];

    for (const [ts, throughputRow] of throughputMap) {
      const metricsRow = metricsMap.get(ts);
      if (!metricsRow) continue; // Timestamp not present in metrics — skip (inner join).

      const x = throughputRow[throughputKey];
      const rawY = metricsRow[metricName];
      const y = subKey !== null
        ? (rawY !== null && typeof rawY === 'object' ? rawY[subKey] : null)
        : rawY;

      if (typeof x === 'number' && typeof y === 'number') {
        points.push({ x, y });
      }
    }

    return {
      sampleName,
      metricName: displayName,
      label: `${sampleName} — ${displayName}`,
      points,
    };
  });
}

/**
 * React hook that loads batched NRQL time-series data for a list of named
 * capacity-planning samples.
 *
 * For each sample the hook:
 * 1. Validates the time window against `MAX_WINDOW_HOURS`.
 * 2. Splits the window into ≤ `MAX_BUCKETS_PER_QUERY`-bucket sub-windows when necessary.
 * 3. Fetches both the throughput query and the metrics query for every sub-window.
 * 4. Merges sub-window results and inner-joins throughput ↔ metrics by timestamp.
 * 5. Extracts one data series per discovered metric column.
 *
 * @param {Array<{
 *   accountId: number,
 *   name: string,
 *   startTime: string,
 *   endTime: string,
 *   throughputQuery: string,
 *   metricsQuery: string
 * }>} samples - Sample configuration objects from nr1.json. Each sample carries its own accountId.
 * @returns {{
 *   series: Array<{sampleName:string, metricName:string, label:string, points:Array<{x:number,y:number}>}>,
 *   loading: boolean,
 *   error: string|null,
 *   progress: {done: number, total: number}
 * }}
 */
export default function useNerdGraphBatch(samples) {
  const [series, setSeries] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // Use a ref to cancel stale fetches when inputs change mid-flight.
  const abortRef = useRef(false);

  useEffect(() => {
    if (!samples || samples.length === 0) {
      setSeries([]);
      setWarnings([]);
      setLoading(false);
      setError(null);
      setProgress({ done: 0, total: 0 });
      return;
    }

    abortRef.current = false;
    setLoading(true);
    setError(null);
    setSeries([]);
    setWarnings([]);

    (async () => {
      try {
        // --- Phase 1: Parse and validate all sample windows up-front ---
        const parsedSamples = [];
        const allWarnings = [];
        for (const sample of samples) {
          const { accountId: sampleAccountId, name, startTime, endTime,
                  startEpoch: precomputedStart, endEpoch: precomputedEnd,
                  throughputQuery, metricsQuery } = sample;

          if (!sampleAccountId || !name || !throughputQuery || !metricsQuery) {
            throw new Error(`Sample "${name || '(unnamed)'}" is missing required fields (including Account ID).`);
          }
          if (!precomputedStart && !startTime) {
            throw new Error(`Sample "${name}": either "Start Time" or "Use Time Picker" must be configured.`);
          }

          const startEpoch = precomputedStart ?? parseDateToEpoch(startTime);
          // Default to 24 hours after start when no end time is provided.
          const endEpoch = precomputedEnd
            ? precomputedEnd
            : endTime ? parseDateToEpoch(endTime) : startEpoch + MAX_WINDOW_HOURS * 3600;

          if (endEpoch <= startEpoch) {
            throw new Error(`Sample "${name}": end time must be after start time.`);
          }

          // Auto-scale bucket size to keep query count within MAX_BATCHES.
          const configuredBucketSize = sample.bucketSize ?? 60;
          const windowSeconds = endEpoch - startEpoch;
          const minBucketSize = Math.ceil(windowSeconds / (MAX_BATCHES * MAX_BUCKETS_PER_QUERY));
          const effectiveBucketSize = Math.max(configuredBucketSize, minBucketSize);
          if (effectiveBucketSize > configuredBucketSize) {
            allWarnings.push(
              `Sample "${name}": bucket size auto-scaled from ${configuredBucketSize}s to ` +
              `${effectiveBucketSize}s to fit a ${(windowSeconds / 3600).toFixed(1)}-hour window.`,
            );
          }

          // Split window into batches if too many buckets.
          const totalBuckets = Math.ceil(windowSeconds / effectiveBucketSize);
          const subWindowSize = MAX_BUCKETS_PER_QUERY * effectiveBucketSize; // seconds per batch

          const batches = [];
          let batchStart = startEpoch;
          while (batchStart < endEpoch) {
            const batchEnd = Math.min(batchStart + subWindowSize, endEpoch);
            batches.push({ start: batchStart, end: batchEnd });
            batchStart = batchEnd;
          }

          parsedSamples.push({
            accountId: sampleAccountId,
            name,
            throughputQuery,
            metricsQuery,
            batches,
            totalBuckets,
            effectiveBucketSize,
          });
        }

        // Total fetch operations = 2 queries (throughput + metrics) × batches per sample.
        const totalOps = parsedSamples.reduce((sum, s) => sum + s.batches.length * 2, 0);
        setProgress({ done: 0, total: totalOps });

        // --- Phase 2: Fetch each sample's batches sequentially ---
        const allSeries = [];

        for (const sample of parsedSamples) {
          if (abortRef.current) break;

          const throughputBatches = [];
          const metricsBatches = [];

          for (const { start, end } of sample.batches) {
            if (abortRef.current) break;

            const sinceUntil = `SINCE ${start} UNTIL ${end}`;
            const throughputNrql =
              `${sample.throughputQuery} TIMESERIES ${sample.effectiveBucketSize} SECONDS ${sinceUntil}`;
            const metricsNrql =
              `${sample.metricsQuery} TIMESERIES ${sample.effectiveBucketSize} SECONDS ${sinceUntil}`;

            // Fetch throughput batch.
            const tQuery = buildNrqlFragment(sample.accountId, throughputNrql, 'result');
            const tData = await runNerdGraphQuery(tQuery);
            const tResults = tData?.result?.account?.nrql?.results ?? [];
            throughputBatches.push(tResults);

            setProgress((prev) => ({ done: prev.done + 1, total: prev.total }));

            if (abortRef.current) break;

            // Fetch metrics batch.
            const mQuery = buildNrqlFragment(sample.accountId, metricsNrql, 'result');
            const mData = await runNerdGraphQuery(mQuery);
            const mResults = mData?.result?.account?.nrql?.results ?? [];
            metricsBatches.push(mResults);

            setProgress((prev) => ({ done: prev.done + 1, total: prev.total }));
          }

          if (abortRef.current) break;

          // Merge sub-window results and build series.
          const throughputIsFaceted = isFacetedResults(throughputBatches);
          const metricsIsFaceted = isFacetedResults(metricsBatches);

          if (throughputIsFaceted && metricsIsFaceted) {
            // Both faceted — facet keys must align.
            const throughputFacetMaps = mergeResultsByTimestampFaceted(throughputBatches);
            const metricsFacetMaps = mergeResultsByTimestampFaceted(metricsBatches);
            const { series: facetSeries, warnings: facetWarnings } = buildFacetedSeries(
              sample.name,
              throughputFacetMaps,
              metricsFacetMaps,
            );
            allSeries.push(...facetSeries);
            allWarnings.push(...facetWarnings);
          } else if (!throughputIsFaceted && metricsIsFaceted) {
            // Shared throughput, faceted metrics — one series per facet value.
            const throughputMap = mergeResultsByTimestamp(throughputBatches);
            const metricsFacetMaps = mergeResultsByTimestampFaceted(metricsBatches);
            const facetColExclusions = detectFacetColumnNames(metricsFacetMaps);
            allSeries.push(...buildMixedFacetedSeries(sample.name, throughputMap, metricsFacetMaps, facetColExclusions));
          } else {
            // Neither faceted, or only throughput faceted (facet field ignored).
            const throughputMap = mergeResultsByTimestamp(throughputBatches);
            const metricsMap = mergeResultsByTimestamp(metricsBatches);
            allSeries.push(...buildSeries(sample.name, throughputMap, metricsMap));
          }
        }

        if (!abortRef.current) {
          setSeries(allSeries);
          setWarnings(allWarnings);
          setLoading(false);
        }
      } catch (err) {
        if (!abortRef.current) {
          setError(err.message || String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      // Cancel the in-flight fetch when the effect re-runs or unmounts.
      abortRef.current = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(samples)]);

  return { series, warnings, loading, error, progress };
}
