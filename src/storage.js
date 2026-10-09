/** Isolated clean baseline store. The old myon-game-v001 IndexedDB remains untouched. */
import { isValidGame, normalizeImport } from './gameEngine.js'
const DB_NAME = 'myon-world-core-v001'
const STORE = 'snapshots'
const KEY = 'primary'
const FALLBACK_KEY = 'myon-world-core-v001-cache'

async function openDb() {
  return await new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'))
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB access blocked'))
  })
}
export async function loadFromIndexedDB() {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } finally { db.close() }
}
export async function saveToIndexedDB(snapshot) {
  if (!isValidGame(snapshot)) throw new Error('저장 데이터 검증 실패')
  const db = await openDb()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(snapshot, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'))
    })
  } finally { db.close() }
}
export const makePlainSnapshot = game => JSON.parse(JSON.stringify(game))
export function loadFallback() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY)
    const data = raw ? JSON.parse(raw) : null
    return isValidGame(data) ? data : null
  } catch { return null }
}
export function saveFallback(data) {
  if (!isValidGame(data)) throw new Error('저장 데이터 검증 실패')
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(data))
}
export function downloadSaveJson(data) {
  const snapshot = makePlainSnapshot(data)
  if (!isValidGame(snapshot)) throw new Error('내보낼 저장 데이터가 올바르지 않습니다.')
  const file = new Blob([JSON.stringify({ ...snapshot, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = 'save.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
export function parseSaveJson(text, now = Date.now()) {
  let input
  try { input = JSON.parse(text) } catch { throw new Error('올바른 JSON 파일이 아닙니다.') }
  return normalizeImport(input, now)
}
