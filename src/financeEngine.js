/**
 * MYON 자금 엔진 — 기존 관전 DB 및 v0.02 진행 DB와 분리된 확장 모듈.
 * 금액은 M 단위로 표시하며, 저장은 '임무가 활성인 밀리초' 단위로 처리합니다.
 * 1개 임무 × 1,000ms = 1M. 오프라인에 종료된 임무도 슬롯 생성 이력으로 정산합니다.
 */
import { makeTaskForSlot, validObservation } from './observation.js'

const DB_NAME = 'myon-finance-engine-v1'
const STORE = 'finance'
const KEY = 'current'
export const HOUR_MS = 60 * 60 * 1000
const MAX_TASK_MS = 120 * 24 * HOUR_MS
const KNOWN_MENUS = ['company', 'settings']

export function makeInitialFinance() {
  return {
    schemaVersion: 1,
    unlockStartedAt: null,
    unlockedAt: null,
    enabled: false,
    balanceTaskMs: 0,
    accruedUntil: null,
    menuUnlocks: { company: null, settings: null },
  }
}

export function validFinance(data) {
  if (!data || data.schemaVersion !== 1 || typeof data.enabled !== 'boolean' ||
      !Number.isSafeInteger(data.balanceTaskMs) || data.balanceTaskMs < 0 ||
      !data.menuUnlocks || typeof data.menuUnlocks !== 'object') return false
  if (data.unlockStartedAt === null) {
    if (data.unlockedAt !== null) return false
  } else if (!Number.isFinite(data.unlockStartedAt) || data.unlockedAt !== data.unlockStartedAt + HOUR_MS) return false
  if (data.enabled && (data.unlockedAt === null || !Number.isFinite(data.accruedUntil) || data.accruedUntil < data.unlockedAt)) return false
  if (!data.enabled && data.accruedUntil !== null) return false
  return KNOWN_MENUS.every(id => data.menuUnlocks[id] === null || Number.isFinite(data.menuUnlocks[id]))
}

export const financeUnlocked = (data, now = Date.now()) =>
  Boolean(data?.unlockedAt !== null && data?.unlockedAt !== undefined && now >= data.unlockedAt)

export const submenuUnlocked = (data, menu, now = Date.now()) =>
  Boolean(KNOWN_MENUS.includes(menu) && Number.isFinite(data?.menuUnlocks?.[menu]) &&
    now >= data.menuUnlocks[menu] + HOUR_MS)

export function startFinanceUnlock(data, now = Date.now()) {
  if (!validFinance(data) || data.unlockStartedAt !== null) throw new Error('자금 엔진 해금을 시작할 수 없습니다.')
  return { ...data, unlockStartedAt: now, unlockedAt: now + HOUR_MS }
}

export function startSubmenuUnlock(data, menu, now = Date.now()) {
  if (!validFinance(data) || !KNOWN_MENUS.includes(menu) || data.menuUnlocks[menu] !== null) {
    throw new Error('해당 메뉴의 해금을 시작할 수 없습니다.')
  }
  return { ...data, menuUnlocks: { ...data.menuUnlocks, [menu]: now } }
}

/** 진행 중/과거 임무 각각의 [시작, 종료) 구간과 정산 구간의 교집합을 계산합니다. */
export function earnedTaskMilliseconds(observation, from, to) {
  if (!validObservation(observation)) throw new Error('관전 기록을 확인할 수 없습니다.')
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0

  const anchor = observation.createdAt
  const startSlot = Math.max(0, Math.floor((from - anchor - MAX_TASK_MS) / HOUR_MS))
  const endSlot = Math.floor((to - anchor) / HOUR_MS)
  const knownIds = new Set()
  let amount = 0
  function add(task) {
    if (knownIds.has(task.id)) return
    knownIds.add(task.id)
    const overlap = Math.min(to, task.endsAt) - Math.max(from, task.startedAt)
    if (overlap > 0) amount += overlap
  }
  // 이관 당시의 v0.01 임시 임무도 실제 종료 시간까지 수익 계산 대상입니다.
  for (const task of observation.tasks) add(task)
  for (let slot = startSlot; slot <= endSlot; slot++) add(makeTaskForSlot(observation.seed, slot, anchor))
  if (!Number.isSafeInteger(amount)) throw new Error('정산 가능한 자금 범위를 초과했습니다.')
  return amount
}

export function settleFinance(data, observation, now = Date.now()) {
  if (!validFinance(data)) throw new Error('자금 엔진 저장 상태가 올바르지 않습니다.')
  if (!data.enabled || now <= data.accruedUntil) return data
  const earned = earnedTaskMilliseconds(observation, data.accruedUntil, now)
  const total = data.balanceTaskMs + earned
  if (!Number.isSafeInteger(total)) throw new Error('자금 데이터 범위를 초과했습니다.')
  return { ...data, balanceTaskMs: total, accruedUntil: now }
}

export function toggleFinance(data, enable, now = Date.now()) {
  if (!validFinance(data) || !financeUnlocked(data, now)) throw new Error('자금 엔진이 아직 해금되지 않았습니다.')
  if (data.enabled === enable) return data
  if (enable) {
    // 재활성화 시 무조건 0에서 시작 (이전 수익은 재사용할 수 없음).
    return { ...data, enabled: true, balanceTaskMs: 0, accruedUntil: now }
  }
  // OFF 상태에는 정산이 더 이상 진행되지 않고, 다시 ON할 때 잔액을 초기화합니다.
  return { ...data, enabled: false, accruedUntil: null }
}

/** 후속 업그레이드/엔진 구현에서 자금 비용이 정해졌을 때 사용합니다. 임의 가격은 정의하지 않습니다. */
export function spendFunds(data, costM) {
  if (!validFinance(data) || !data.enabled || !Number.isSafeInteger(costM) || costM < 0) {
    throw new Error('자금 비용이 유효하지 않거나 자금 엔진이 꺼져 있습니다.')
  }
  const costMs = costM * 1000
  if (!Number.isSafeInteger(costMs) || costMs > data.balanceTaskMs) throw new Error('자금이 부족합니다.')
  return { ...data, balanceTaskMs: data.balanceTaskMs - costMs }
}

export function balanceM(data, observation, now = Date.now()) {
  if (!validFinance(data)) return 0
  const extra = data.enabled && validObservation(observation)
    ? earnedTaskMilliseconds(observation, data.accruedUntil, now) : 0
  return Math.floor((data.balanceTaskMs + extra) / 1000)
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB를 지원하지 않는 브라우저입니다.'))
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('자금 엔진 DB 연결 실패'))
    request.onblocked = () => reject(new Error('자금 엔진 DB 연결 차단'))
  })
}

export async function loadOrCreateFinance() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    let selected
    store.get(KEY).onsuccess = event => {
      selected = event.target.result ?? makeInitialFinance()
      if (event.target.result === undefined) store.put(selected, KEY)
    }
    tx.oncomplete = () => { db.close(); validFinance(selected) ? resolve(selected) : reject(new Error('자금 엔진 데이터가 유효하지 않습니다.')) }
    tx.onerror = () => { db.close(); reject(tx.error || new Error('자금 엔진 불러오기 실패')) }
    tx.onabort = () => { db.close(); reject(tx.error || new Error('자금 엔진 트랜잭션 취소')) }
  })
}

/**
 * 여러 탭에서 동시에 켜더라도 정산이 두 번 더해지지 않도록
 * 조회 → 누적 정산 → 조작 → 저장을 하나의 IndexedDB readwrite 트랜잭션으로 처리합니다.
 */
export async function updateFinance(observation, now, transform = current => current) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    let result
    let operationError = null
    store.get(KEY).onsuccess = event => {
      try {
        const current = event.target.result ?? makeInitialFinance()
        const settled = settleFinance(current, observation, now)
        result = transform(settled)
        if (!validFinance(result)) throw new Error('자금 엔진 변경 내용이 올바르지 않습니다.')
        if (result !== current) store.put(result, KEY)
      } catch (error) {
        operationError = error
        tx.abort()
      }
    }
    tx.oncomplete = () => { db.close(); resolve(result) }
    tx.onerror = () => { db.close(); reject(operationError || tx.error || new Error('자금 저장 실패')) }
    tx.onabort = () => { db.close(); reject(operationError || tx.error || new Error('자금 저장 취소')) }
  })
}
