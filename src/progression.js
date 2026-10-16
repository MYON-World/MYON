/**
 * MYON v0.02 — 사이트 배포 버전과 유저의 개인 진행 상태를 분리합니다.
 * 관전 임무 데이터베이스는 수정하지 않고 독립된 IndexedDB에 보관합니다.
 * 모든 해금 시간은 Date.now() 기준의 절대 시각으로 저장합니다.
 */
const DB_NAME = 'myon-progression-v002'
const STORE_NAME = 'progress'
const KEY = 'user'
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export function makeInitialProgress(now = Date.now()) {
  return {
    schemaVersion: 1,
    firstSeenAt: now,
    companyUnlockAt: now + DAY_MS,
    companyName: null,
    companyCreatedAt: null,
    menuUnlockStartedAt: null,
    menuUnlockedAt: null,
  }
}

export function validProgress(data) {
  if (!data || data.schemaVersion !== 1 ||
      !Number.isFinite(data.firstSeenAt) ||
      !Number.isFinite(data.companyUnlockAt) ||
      data.companyUnlockAt !== data.firstSeenAt + DAY_MS) return false

  const ownsCompany = typeof data.companyName === 'string' &&
    data.companyName.trim().length > 0 && data.companyName.trim().length <= 40 &&
    Number.isFinite(data.companyCreatedAt)
  if (!ownsCompany && (data.companyName !== null || data.companyCreatedAt !== null)) return false
  if (ownsCompany && data.companyCreatedAt < data.companyUnlockAt) return false
  if (!ownsCompany && (data.menuUnlockStartedAt !== null || data.menuUnlockedAt !== null)) return false

  if (data.menuUnlockStartedAt !== null) {
    if (!ownsCompany || !Number.isFinite(data.menuUnlockStartedAt) ||
        data.menuUnlockStartedAt < data.companyCreatedAt ||
        data.menuUnlockedAt !== data.menuUnlockStartedAt + HOUR_MS) return false
  } else if (data.menuUnlockedAt !== null) return false

  return true
}

export const companyFormOpen = (progress, now = Date.now()) =>
  Boolean(progress && !progress.companyName && now >= progress.companyUnlockAt)

export const menuIsUnlocked = (progress, now = Date.now()) =>
  Boolean(progress?.companyName && progress.menuUnlockedAt !== null && now >= progress.menuUnlockedAt)

export function createCompany(progress, name, now = Date.now()) {
  if (!validProgress(progress) || progress.companyName || now < progress.companyUnlockAt) {
    throw new Error('회사를 생성할 수 있는 상태가 아닙니다.')
  }
  const cleanName = String(name).trim().replace(/\s+/g, ' ')
  if (!cleanName || cleanName.length > 40) throw new Error('회사명은 1~40자로 입력해 주세요.')
  return { ...progress, companyName: cleanName, companyCreatedAt: now }
}

export function beginMenuUnlock(progress, now = Date.now()) {
  if (!validProgress(progress) || !progress.companyName || progress.menuUnlockStartedAt !== null) {
    throw new Error('기본 메뉴 해금을 시작할 수 없습니다.')
  }
  return {
    ...progress,
    menuUnlockStartedAt: now,
    menuUnlockedAt: now + HOUR_MS,
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB 지원이 필요합니다.'))
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('진행 데이터베이스 연결 실패'))
    request.onblocked = () => reject(new Error('진행 데이터베이스 연결 차단'))
  })
}

async function dbAction(mode, callback) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode)
      const request = callback(tx.objectStore(STORE_NAME))
      if (mode === 'readonly') {
        request.onsuccess = () => resolve(request.result ?? null)
        request.onerror = () => reject(request.error)
      } else {
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => reject(tx.error || new Error('저장 실패'))
        tx.onabort = () => reject(tx.error || new Error('저장 취소'))
      }
    })
  } finally {
    db.close()
  }
}

export function loadProgress() {
  return dbAction('readonly', store => store.get(KEY))
}

export function saveProgress(progress) {
  if (!validProgress(progress)) throw new Error('잘못된 진행 상태입니다.')
  return dbAction('readwrite', store => store.put(progress, KEY))
}

// 이미 진행 중인 유저 데이터는 덮어쓰지 않습니다.
export async function loadOrCreateProgress(now = Date.now()) {
  const existing = await loadProgress()
  if (existing !== null) {
    if (!validProgress(existing)) throw new Error('저장된 진행 정보가 올바르지 않습니다.')
    return existing
  }
  const initial = makeInitialProgress(now)
  // 다른 탭에서 최초 접속을 동시에 수행할 수 있으므로 쓰기 전에 다시 확인합니다.
  return new Promise(async (resolve, reject) => {
    let db
    try {
      db = await openDb()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      let selected = initial
      const read = store.get(KEY)
      read.onsuccess = () => {
        if (read.result !== undefined) {
          selected = read.result
        } else {
          store.put(initial, KEY)
        }
      }
      tx.oncomplete = () => {
        db.close()
        if (validProgress(selected)) resolve(selected)
        else reject(new Error('저장된 진행 정보가 올바르지 않습니다.'))
      }
      tx.onerror = () => { db.close(); reject(tx.error || new Error('진행 데이터 생성 실패')) }
      tx.onabort = () => { db.close(); reject(tx.error || new Error('진행 데이터 생성 취소')) }
    } catch (error) {
      db?.close()
      reject(error)
    }
  })
}
