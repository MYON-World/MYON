// MYON company-world common policy v1 (rule definition only).
// Every company category/version uses the same mandatory hold and valuation cadence.
// These helpers do not read or write saves, value companies, or settle transfers.
export const COMPANY_MIN_OPERATION_SECONDS = 7 * 24 * 60 * 60;
export const COMPANY_PROFIT_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const COMPANY_VALUATION_INTERVAL_SECONDS = 60 * 60;

// Current behavior: a new company must operate for at least seven REAL-TIME days
// before it can be sold. Switching company industries or versions requires sale.
// No automatic exception for development/official versions has been authorized.
export function companySaleAvailableAt(foundedAtSeconds) {
  if (!Number.isSafeInteger(foundedAtSeconds) || foundedAtSeconds < 0) {
    throw new RangeError('MYON company: invalid founding timestamp');
  }
  const when = foundedAtSeconds + COMPANY_MIN_OPERATION_SECONDS;
  if (!Number.isSafeInteger(when)) throw new RangeError('MYON company: timestamp overflow');
  return when;
}

export function canSellCompany(foundedAtSeconds, nowSeconds) {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new RangeError('MYON company: invalid current timestamp');
  }
  return nowSeconds >= companySaleAvailableAt(foundedAtSeconds);
}

// Fixed cadence anchored to founding time, not to game-open sessions.
// On future loading after time offline, the world can catch up against wall time.
export function nextCompanyValuationAt(foundedAtSeconds, lastValuedAtSeconds) {
  if (!Number.isSafeInteger(foundedAtSeconds) || foundedAtSeconds < 0) {
    throw new RangeError('MYON company: invalid founding timestamp');
  }
  if (lastValuedAtSeconds == null) return foundedAtSeconds;
  if (!Number.isSafeInteger(lastValuedAtSeconds) ||
      lastValuedAtSeconds < foundedAtSeconds) {
    throw new RangeError('MYON company: invalid last valuation timestamp');
  }
  const periods = Math.floor((lastValuedAtSeconds - foundedAtSeconds) /
    COMPANY_VALUATION_INTERVAL_SECONDS) + 1;
  const next = foundedAtSeconds + periods * COMPANY_VALUATION_INTERVAL_SECONDS;
  if (!Number.isSafeInteger(next)) throw new RangeError('MYON company: timestamp overflow');
  return next;
}

// Valuation concept (NOT calculated in v0.13.29):
// current operating cash + net realizable asset value (less debt)
// + profitability component based on the most recent seven REAL-TIME days.
// The profit multiplier, precise asset valuation, and handling of ongoing jobs
// on sale still require later design decisions; do not invent them here.
// At actual sale time, liquid balances/assets/liabilities must be rechecked;
// proceeds go ONLY to shared businessCapital, never to personal balance.
