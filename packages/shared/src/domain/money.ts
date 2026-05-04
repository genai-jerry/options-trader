/**
 * Money helpers. Storage and computation are always in integer paise.
 * Format only at the view boundary.
 */

const PAISE_PER_RUPEE = 100;

/** Convert a rupee amount (number, can be fractional) to integer paise. */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * PAISE_PER_RUPEE);
}

/** Convert integer paise back to a rupee number. View-layer only. */
export function paiseToRupees(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

/**
 * Multiply integer paise by a fractional rate (e.g. feePercent) and round
 * to the nearest paisa. Rates are dimensionless 0..1 floats; rounding to
 * paise keeps the result an integer.
 */
export function applyRate(paise: number, rate: number): number {
  return Math.round(paise * rate);
}

/** Format integer paise as INR for display. Uses Indian digit grouping. */
export function formatINR(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / PAISE_PER_RUPEE);
  const fraction = abs % PAISE_PER_RUPEE;
  const fracStr = fraction.toString().padStart(2, '0');
  const rupeesStr = formatIndianGrouping(rupees);
  return `${sign}₹${rupeesStr}.${fracStr}`;
}

function formatIndianGrouping(n: number): string {
  const s = n.toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${grouped},${last3}`;
}
