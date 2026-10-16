/**
 * MYON v0.01 - 교통 운행/운항 관전 엔진
 *
 * 생성: 관전 시작 시 1개, 이후 정확히 1시간마다 1개.
 * 폐기: 각 임무의 남은 시간이 0초가 되는 시점에만 폐기.
 * 재접속: 최초 관전 시작 시각과 시간 슬롯을 이용해 누락된 임무를 복원.
 */
const DB_NAME = 'myon-observation-preview-v1' // 기존 관전 데이터베이스를 유지합니다.
const STORE = 'states'
const KEY = 'current'
const HOUR_MS = 60 * 60 * 1000
const DAY_MINUTES = 24 * 60
const MONTH_DAYS = 30 // 랜덤 소요시간의 '1달'은 30일로 계산합니다.
const MAX_DURATION_MINUTES = 4 * MONTH_DAYS * DAY_MINUTES
const MAX_DURATION_MS = MAX_DURATION_MINUTES * 60 * 1000
const MAX_ACTIVE_TASKS = Math.ceil(MAX_DURATION_MS / HOUR_MS) + 16

export const TRANSPORT_CATEGORIES = Object.freeze([
  { key: 'bus', label: '버스', minMinutes: 30, maxMinutes: 4 * 60 },
  { key: 'rail', label: '철도', minMinutes: 2 * 60, maxMinutes: 6 * 60 },
  { key: 'air', label: '항공', minMinutes: 2 * 60, maxMinutes: 15 * 60 },
  { key: 'sea', label: '해상', minMinutes: 2 * 60, maxMinutes: MONTH_DAYS * DAY_MINUTES },
  { key: 'space', label: '우주', minMinutes: MONTH_DAYS * DAY_MINUTES, maxMinutes: 4 * MONTH_DAYS * DAY_MINUTES },
])

const RAIL_NAMES = ['지하철 운행', '일반열차 운행', '고속열차 운행']
const AIR_NAMES = ['국내선 항공편 운항', '국제선 항공편 운항']
const SEA_NAMES = ['국내선 선박 운항', '국제선 선박 운항', '관광선 운항', '해상버스 운항']
const SPACE_NAMES = ['항성 간 이동', '우주셔틀 운항', '행성 간 수송', '궤도 수송선 운항']

// 슬롯마다 동일한 난수 결과를 내므로, 장시간 미접속 후에도 생성 이력을 재현할 수 있습니다.
function randomForSlot(seed, slot) {
  let value = (seed ^ Math.imul(slot + 1, 0x9e3779b9)) >>> 0
  return () => {
    value = (value + 0x6d2b79f5) >>> 0
    let result = Math.imul(value ^ (value >>> 15), value | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}
const randomInteger = (rng, min, max) => min + Math.floor(rng() * (max - min + 1))
const randomItem = (rng, array) => array[randomInteger(rng, 0, array.length - 1)]
function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint32Array(1)
    globalThis.crypto.getRandomValues(bytes)
    return bytes[0]
  }
  return Math.floor(Math.random() * 4294967296)
}

function missionTitle(category, rng) {
  switch (category.key) {
    case 'bus': {
      const number = String(randomInteger(rng, 0, 9999))
      // 0~9999 중 선택. 버스 노선번호는 1~4자리(앞자리 0 허용)로 표현합니다.
      const width = randomInteger(rng, number.length, 4)
      return `${number.padStart(width, '0')}번 노선 운행`
    }
    case 'rail': return randomItem(rng, RAIL_NAMES)
    case 'air': return randomItem(rng, AIR_NAMES)
    case 'sea': return randomItem(rng, SEA_NAMES)
    case 'space': return randomItem(rng, SPACE_NAMES)
    default: throw new Error('Unknown transport category')
  }
}

export function makeTaskForSlot(seed, slot, anchor) {
  const rng = randomForSlot(seed, slot)
  const category = TRANSPORT_CATEGORIES[randomInteger(rng, 0, TRANSPORT_CATEGORIES.length - 1)]
  const title = missionTitle(category, rng)
  const durationMinutes = randomInteger(rng, category.minMinutes, category.maxMinutes)
  const startedAt = anchor + slot * HOUR_MS
  return {
    id: `transport-${anchor}-${slot}`,
    category: category.key,
    title,
    startedAt,
    durationSeconds: durationMinutes * 60,
    endsAt: startedAt + durationMinutes * 60 * 1000,
  }
}

export function makeInitialObservation(now = Date.now(), seed = randomSeed()) {
  const normalizedSeed = seed >>> 0
  return {
    schemaVersion: 2,
    mode: 'observation',
    createdAt: now,
    updatedAt: now,
    seed: normalizedSeed,
    lastGeneratedSlot: 0,
    tasks: [makeTaskForSlot(normalizedSeed, 0, now)],
  }
}

const validTask = task => Boolean(task && typeof task.id === 'string' &&
  TRANSPORT_CATEGORIES.some(category => category.key === task.category) &&
  typeof task.title === 'string' && task.title.length > 0 &&
  Number.isFinite(task.startedAt) && Number.isFinite(task.durationSeconds) &&
  task.durationSeconds > 0 && Number.isFinite(task.endsAt) &&
  task.endsAt === task.startedAt + task.durationSeconds * 1000)

export function validObservation(state) {
  return Boolean(state && state.schemaVersion === 2 && state.mode === 'observation' &&
    Number.isFinite(state.createdAt) && Number.isFinite(state.updatedAt) &&
    Number.isInteger(state.seed) && state.seed >= 0 && state.seed <= 0xffffffff &&
    Number.isSafeInteger(state.lastGeneratedSlot) && state.lastGeneratedSlot >= 0 &&
    Array.isArray(state.tasks) && state.tasks.length <= MAX_ACTIVE_TASKS &&
    state.tasks.every(validTask))
}

/**
 * v0.01 이전의 관전 체험 임무를 불러온 경우, 남은 시간이 0초가 되기 전까지
 * 임무를 폐기하지 않습니다. 임시로 쓰던 제목만 운행/운항 제목으로 치환하며
 * 개별 임무 ID, 시작/종료 시각, 카운트다운은 그대로 보존합니다.
 */
export function migrateLegacyObservation(state, now = Date.now()) {
  if (!state || state.schemaVersion !== 1 || state.mode !== 'observation' ||
      !Number.isFinite(state.createdAt) || !Array.isArray(state.tasks)) return null

  const seed = randomSeed()
  const originalTasks = state.tasks
    .filter(task => task && typeof task.id === 'string' &&
      Number.isFinite(task.startedAt) && Number.isFinite(task.endsAt) &&
      Number.isFinite(task.durationSeconds) && task.durationSeconds > 0 &&
      task.endsAt === task.startedAt + task.durationSeconds * 1000 &&
      task.endsAt > now)
    .slice(0, MAX_ACTIVE_TASKS - 1)
    .map((task, index) => {
      const replacement = makeTaskForSlot(seed, index + 1, state.createdAt)
      return {
        ...replacement,
        id: task.id,
        startedAt: task.startedAt,
        endsAt: task.endsAt,
        durationSeconds: task.durationSeconds,
      }
    })

  // 기존 저장본의 8개 체험 임무는 각각 원래 종료 시각까지 유지합니다.
  // 새 운행 임무는 관전 시작 시각 기준 정시 슬롯에서만 생성합니다.
  const migrated = {
    schemaVersion: 2,
    mode: 'observation',
    createdAt: state.createdAt,
    updatedAt: now,
    seed,
    lastGeneratedSlot: 0,
    tasks: [makeTaskForSlot(seed, 0, state.createdAt), ...originalTasks],
  }
  return advanceObservation(migrated, now)
}

/**
 * 유저 접속 여부와 무관하게 1시간마다 딱 1개씩 생성했다고 계산합니다.
 * 오래된 누락 슬롯 중 최대 임무 시간(120일)을 넘은 것은 모두 완료됐으므로
 * 순회하지 않아도 됩니다. 이미 생성된 진행 중 임무는 끝날 때까지 유지합니다.
 */
export function advanceObservation(state, now = Date.now()) {
  if (!validObservation(state)) throw new Error('Invalid observation snapshot')
  const currentSlot = Math.max(0, Math.floor((now - state.createdAt) / HOUR_MS))
  const newSlotsAvailable = currentSlot > state.lastGeneratedSlot
  const completed = state.tasks.some(task => task.endsAt <= now)
  if (!newSlotsAvailable && !completed) return state

  const remainingTasks = state.tasks.filter(task => task.endsAt > now)
  if (newSlotsAvailable) {
    // 4개월보다 오래된 임무는 현재 살아 있을 수 없습니다.
    const earliestUsefulSlot = Math.max(0, Math.floor((now - state.createdAt - MAX_DURATION_MS) / HOUR_MS))
    const from = Math.max(state.lastGeneratedSlot + 1, earliestUsefulSlot)
    for (let slot = from; slot <= currentSlot; slot++) {
      const task = makeTaskForSlot(state.seed, slot, state.createdAt)
      if (task.endsAt > now) remainingTasks.push(task)
    }
  }

  return {
    ...state,
    lastGeneratedSlot: Math.max(state.lastGeneratedSlot, currentSlot),
    updatedAt: now,
    tasks: remainingTasks,
  }
}

export function remainingSeconds(task, now = Date.now()) {
  return Math.max(0, Math.ceil((task.endsAt - now) / 1000))
}
export function formatCountdown(seconds) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const clock = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return days > 0 ? `${days}일 ${clock}` : clock
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB unsupported'))
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('DB open failure'))
    request.onblocked = () => reject(new Error('DB blocked'))
  })
}
async function withDb(mode, operation) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = operation(tx.objectStore(STORE))
      if (mode === 'readonly') {
        request.onsuccess = () => resolve(request.result ?? null)
        request.onerror = () => reject(request.error)
      } else {
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error || new Error('DB aborted'))
      }
    })
  } finally {
    db.close()
  }
}
export async function loadObservation() {
  return withDb('readonly', store => store.get(KEY))
}
export async function saveObservation(state) {
  if (!validObservation(state)) throw new Error('Invalid observation snapshot')
  return withDb('readwrite', store => store.put(state, KEY))
}
