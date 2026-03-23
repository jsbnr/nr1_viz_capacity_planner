/**
 * @fileoverview Simple linear regression utilities for capacity planning predictions.
 * Implements Ordinary Least Squares (OLS) regression: y = mx + b
 */

/**
 * Computes a simple linear regression over a set of (x, y) data points.
 *
 * Uses the closed-form OLS solution:
 *   slope (m)     = (n·Σxy  − Σx·Σy) / (n·Σx²  − (Σx)²)
 *   intercept (b) = (Σy − m·Σx) / n
 *
 * The coefficient of determination (R²) measures how well the line fits:
 *   R² = 1 − SSres / SStot
 *   where SSres = Σ(yᵢ − ŷᵢ)² and SStot = Σ(yᵢ − ȳ)²
 *
 * @param {Array<{x: number, y: number}>} points - Data points to regress.
 *   Must contain at least 2 distinct x values, otherwise slope is undefined.
 * @returns {{ slope: number, intercept: number, r2: number } | null}
 *   Regression coefficients and R², or null if regression is not computable
 *   (fewer than 2 points, or all x values are identical).
 */
export function linearRegression(points) {
  if (!points || points.length < 2) return null;

  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (const { x, y } of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denominator = n * sumX2 - sumX * sumX;

  // All x values are the same — vertical line, slope is undefined.
  if (denominator === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // Compute R² (coefficient of determination).
  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const { x, y } of points) {
    const predicted = slope * x + intercept;
    ssTot += (y - meanY) ** 2;
    ssRes += (y - predicted) ** 2;
  }

  // Guard against ssTot === 0 (all y values identical — perfect flat line).
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { type: 'linear', slope, intercept, r2 };
}

/**
 * Predicts the y value for a given x using a regression result.
 *
 * @param {{ slope: number, intercept: number }} regression - Output of {@link linearRegression}.
 * @param {number} x - The x value (e.g. a throughput figure) to predict for.
 * @returns {number} The predicted y value (e.g. CPU %).
 */
export function predict(regression, x) {
  return regression.slope * x + regression.intercept;
}

/**
 * Fits a degree-2 polynomial (quadratic) y = a·x² + b·x + c using normal equations.
 * Solved via Gaussian elimination on the 3×3 Vandermonde system — no external deps.
 *
 * @param {Array<{x: number, y: number}>} points
 * @returns {{ type: 'polynomial', coefficients: [number, number, number], r2: number } | null}
 *   coefficients = [c, b, a] so that y = coefficients[0] + coefficients[1]·x + coefficients[2]·x²
 */
export function polynomialRegression(points) {
  if (!points || points.length < 3) return null;

  const n = points.length;
  // Build sums needed for the 3×3 normal equations
  let s0 = n, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  let t0 = 0, t1 = 0, t2 = 0;
  for (const { x, y } of points) {
    const x2 = x * x;
    s1 += x;
    s2 += x2;
    s3 += x2 * x;
    s4 += x2 * x2;
    t0 += y;
    t1 += x * y;
    t2 += x2 * y;
  }

  // Normal equations matrix A and right-hand side b:
  // [ s0 s1 s2 ] [c]   [t0]
  // [ s1 s2 s3 ] [b] = [t1]
  // [ s2 s3 s4 ] [a]   [t2]
  const A = [
    [s0, s1, s2, t0],
    [s1, s2, s3, t1],
    [s2, s3, s4, t2],
  ];

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < 3; col++) {
    // Find pivot
    let maxRow = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]];
    if (A[col][col] === 0) return null; // singular
    for (let row = col + 1; row < 3; row++) {
      const factor = A[row][col] / A[col][col];
      for (let k = col; k <= 3; k++) A[row][k] -= factor * A[col][k];
    }
  }
  // Back-substitution
  const coef = [0, 0, 0];
  for (let row = 2; row >= 0; row--) {
    coef[row] = A[row][3];
    for (let k = row + 1; k < 3; k++) coef[row] -= A[row][k] * coef[k];
    coef[row] /= A[row][row];
  }

  // R²
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (const { x, y } of points) {
    const pred = coef[0] + coef[1] * x + coef[2] * x * x;
    ssTot += (y - meanY) ** 2;
    ssRes += (y - pred) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { type: 'polynomial', coefficients: coef, r2 };
}

/**
 * Power regression: y = a·xᵇ
 * Linearised as ln(y) = ln(a) + b·ln(x), then OLS on the transformed data.
 * Returns null if any x ≤ 0 or y ≤ 0.
 *
 * @param {Array<{x: number, y: number}>} points
 * @returns {{ type: 'power', a: number, b: number, r2: number } | null}
 */
export function powerRegression(points) {
  if (!points || points.length < 2) return null;
  const valid = points.filter(({ x, y }) => x > 0 && y > 0);
  if (valid.length < 2) return null;

  const transformed = valid.map(({ x, y }) => ({ x: Math.log(x), y: Math.log(y) }));
  const lin = linearRegression(transformed);
  if (!lin) return null;

  const a = Math.exp(lin.intercept);
  const b = lin.slope;

  // R² in original space
  const n = valid.length;
  const meanY = valid.reduce((s, p) => s + p.y, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (const { x, y } of valid) {
    const pred = a * Math.pow(x, b);
    ssTot += (y - meanY) ** 2;
    ssRes += (y - pred) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { type: 'power', a, b, r2 };
}

/**
 * Exponential regression: y = a·eᵇˣ
 * Linearised as ln(y) = ln(a) + b·x, then OLS on the transformed data.
 * Returns null if any y ≤ 0.
 *
 * @param {Array<{x: number, y: number}>} points
 * @returns {{ type: 'exponential', a: number, b: number, r2: number } | null}
 */
export function exponentialRegression(points) {
  if (!points || points.length < 2) return null;
  const valid = points.filter(({ y }) => y > 0);
  if (valid.length < 2) return null;

  const transformed = valid.map(({ x, y }) => ({ x, y: Math.log(y) }));
  const lin = linearRegression(transformed);
  if (!lin) return null;

  const a = Math.exp(lin.intercept);
  const b = lin.slope;

  // R² in original space
  const n = valid.length;
  const meanY = valid.reduce((s, p) => s + p.y, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (const { x, y } of valid) {
    const pred = a * Math.exp(b * x);
    ssTot += (y - meanY) ** 2;
    ssRes += (y - pred) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { type: 'exponential', a, b, r2 };
}

/**
 * Predicts y for any regression type returned by this module.
 *
 * @param {{ type: string, [key: string]: any }} regression
 * @param {number} x
 * @returns {number}
 */
export function predictAny(regression, x) {
  switch (regression.type) {
    case 'polynomial': {
      const [c, b, a] = regression.coefficients;
      return c + b * x + a * x * x;
    }
    case 'power':
      return regression.a * Math.pow(x, regression.b);
    case 'exponential':
      return regression.a * Math.exp(regression.b * x);
    case 'linear':
    default:
      return regression.slope * x + regression.intercept;
  }
}
