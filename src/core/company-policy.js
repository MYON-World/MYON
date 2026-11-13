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

// The company world will supply operating cash, realizable net assets (after
// debt) and recent seven-day NET operating profit. Asset valuation, unsettled
// contracts and sale settlement remain separate, unimplemented systems.
// Sale proceeds must go to shared businessCapital, never to personal cash.
export const COMPANY_PROFIT_PREMIUM_PERCENT = 100;
export const COMPANY_PROFIT_PREMIUM_CAP_PERCENT = 30;

// Values are integral won, not floating point M. Revenue from normal missions
// minus recurring wages/operating costs is operating profit. Exclude asset sales,
// capital injections and other non-operating transfers from the profit input.
export function calculateCompanyValuation(operatingCash, netAssetValue, netOperatingProfit7Days) {
  if (!Number.isSafeInteger(operatingCash) || operatingCash < 0 ||
      !Number.isSafeInteger(netAssetValue) ||
      !Number.isSafeInteger(netOperatingProfit7Days)) {
    throw new RangeError('MYON company: invalid valuation input');
  }
  const rawBase = operatingCash + netAssetValue;
  if (!Number.isSafeInteger(rawBase)) throw new RangeError('MYON company: valuation base overflow');
  const baseValue = Math.max(0, rawBase);
  // Exactly floor(baseValue * 30 / 100), without large integer multiplication.
  const premiumLimit = Math.floor(baseValue / 10) * 3 +
    Math.floor((baseValue % 10) * 3 / 10);
  const profitPremium = Math.min(Math.max(0, netOperatingProfit7Days), premiumLimit);
  const valuation = baseValue + profitPremium;
  if (!Number.isSafeInteger(valuation)) throw new RangeError('MYON company: valuation overflow');
  return { baseValue, profitPremium, valuation };
}
