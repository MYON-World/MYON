// MYON shared economy v1. Do not transfer or reinterpret legacy common funds.
// This record starts with zero new funds and never touches v01322-common-funds.
// All amounts are nonnegative integer won; the existing display convention is 1 M = 10,000 won.
import { openGameDb, transact } from './myon-index.js';

export const MYON_ECONOMY_KEY = 'myon-economy-v1';
export const MYON_MONEY_UNITS_PER_M = 10000;

// Personal cash belongs to the player.
// Business capital is reserved for the next company, including future company-sale proceeds.
// A running company's operating cash and hourly valuation belong in that company's
// own world record and are NOT personal cash or spendable business capital.
// Neither company operations nor the valuation calculation is enabled in this step.
export function initialMyonEconomy() {
  return {
    schema: 1,
    personal: { balance: 0 },
    businessCapital: { balance: 0 },
  };
}

export function validMyonEconomy(value) {
  return Boolean(
    value && value.schema === 1 &&
    value.personal && Number.isSafeInteger(value.personal.balance) && value.personal.balance >= 0 &&
    value.businessCapital &&
    Number.isSafeInteger(value.businessCapital.balance) && value.businessCapital.balance >= 0
  );
}

// Idempotent bootstrap; do not overwrite either a valid save or an unsupported schema.
export async function initializeMyonEconomy() {
  const db = await openGameDb();
  return transact(db, 'readwrite', (store, resolve, fail) => {
    const request = store.get(MYON_ECONOMY_KEY);
    request.onsuccess = () => {
      const saved = request.result;
      if (saved === undefined) {
        const initial = initialMyonEconomy();
        store.add(initial, MYON_ECONOMY_KEY);
        resolve(initial);
      } else if (validMyonEconomy(saved)) {
        resolve(saved);
      } else {
        fail(new Error('MYON economy: unsupported existing economy record'));
      }
    };
  });
}

export async function readMyonEconomy() {
  const db = await openGameDb();
  return transact(db, 'readonly', (store, resolve, fail) => {
    const request = store.get(MYON_ECONOMY_KEY);
    request.onsuccess = () => {
      const saved = request.result;
      if (saved === undefined) resolve(null);
      else if (validMyonEconomy(saved)) resolve(saved);
      else fail(new Error('MYON economy: invalid or unsupported record'));
    };
  });
}
