/** Save whole game as one snapshot; IndexedDB for autosave, save.json for transfer. */
import { isValidGame } from './gameEngine.js'
const DB_NAME = 'myon-game-v001'
const STORE = 'snapshots'
const KEY = 'primary'
const FALLBACK_KEY = 'myon-game-v001-cache'

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'))
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('Cannot open database'))
    req.onblocked = () => reject(new Error('Database blocked'))
  })
}

export async function loadFromIndexedDB() {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } finally { db.close() }
}

export async function saveToIndexedDB(snapshot) {
  // The caller must supply a PLAIN object; never pass Vue's reactive Proxy to IDB.
  const db = await openDb()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(snapshot, KEY)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'))
    })
  } finally { db.close() }
}

export function makePlainSnapshot(game) {
  return JSON.parse(JSON.stringify(game))
}

export function loadFallback() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY)
    const snapshot = raw ? JSON.parse(raw) : null
    return isValidGame(snapshot) ? snapshot : null
  } catch { return null }
}

export function saveFallback(snapshot) {
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(snapshot))
}

export function downloadSaveJson(game) {
  const plain = makePlainSnapshot(game)
  if (!isValidGame(plain)) throw new Error('내보낼 데이터가 올바르지 않습니다.')
  const output = { ...plain, exportedAt: new Date().toISOString() }
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'save.json'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function parseSaveJson(text) {
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new Error('JSON 파일 형식이 올바르지 않습니다.') }
  if (!isValidGame(parsed)) throw new Error('MYON v0.01용 save.json이 아니거나 데이터가 손상되었습니다.')
  // Imported data is always fully detached plain JSON, no extra mutation of input.
  return makePlainSnapshot(parsed)
}
