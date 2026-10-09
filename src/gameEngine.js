/** MYON v0.01 — city-first world; seconds are wall-clock seconds, not frame counts. */
export const SAVE_SCHEMA = 2
export const GAME_VERSION = '0.01'
export const SECOND_MS = 1_000
export const UNLOCK_DURATION_MS = 24 * 60 * 60 * SECOND_MS
export const ACCEPT_RATE = 50
export const REWARD_RATE = 100
export const MISSION_COUNT = 10

export const BASIC_UNLOCKS = Object.freeze([
  { id: 'company', title: '회사 신설하기', description: '나만의 회사와 심층 연구의 기반을 엽니다.', symbol: 'C' },
  { id: 'time', title: '시간 연구하기', description: '표준시간과 진행 중인 임무의 시간을 볼 수 있습니다.', symbol: 'T' },
  { id: 'funds', title: '자금 연구하기', description: 'MYON 화폐 M을 활성화하고 도시 임무 수익을 축적합니다.', symbol: 'M' },
  { id: 'assistant', title: '비서 연구하기', description: '시스템 변경기록을 확인할 수 있습니다.', symbol: 'A' },
])
export const CITY_TASKS = Object.freeze([
  '도심 기반시설 현황 조사',
  '신도시 개발계획 검토',
  '지역 교통수요 분석',
  '도시 생활환경 실태조사',
  '주요 상업지구 현황 분석',
  '도시 인구이동 조사',
  '공공시설 운영현황 점검',
  '지역 산업단지 수요조사',
  '도시 연결망 개선방안 검토',
  '신규 도시개발 후보지 조사',
])
export const CITIES = Object.freeze(['서울', '부산', '인천', '수원', '대전', '대구', '광주', '울산', '세종', '제주'])
const UNLOCK_IDS = new Set(BASIC_UNLOCKS.map(x => x.id))
const isTime = x => Number.isSafeInteger(x) && x >= 0
const isStr = (v, max = 100) => typeof v === 'string' && v.length > 0 && v.length <= max
const copy = item => JSON.parse(JSON.stringify(item))

// Stable pseudo-random mission generation makes offline recovery reproducible.
function noise(seed, slot, sequence) {
  let x = ((Math.floor(seed / 1000) >>> 0) ^ Math.imul(slot + 1, 0x9e3779b1) ^ Math.imul(sequence + 1, 0x85ebca6b)) >>> 0
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b)
  return (x ^ (x >>> 16)) >>> 0
}
export function createCityMission(slot, sequence, startedAt, seed) {
  const random = noise(seed, slot, sequence)
  const durationSeconds = (3 + (random % 46)) * 300 // 15 min to 4 h, 5-min increments
  return {
    id: `city-${slot + 1}`, slot, sequence,
    cityId: (slot + Math.floor(random / 47)) % CITIES.length,
    taskId: sequence === 0 ? slot : Math.floor(random / 997) % CITY_TASKS.length,
    startedAt,
    endsAt: startedAt + durationSeconds * SECOND_MS,
  }
}
export const cityMissionName = mission => `${CITIES[mission.cityId]} · ${CITY_TASKS[mission.taskId]}`
export const isUnlocked = (game, id) => game.progress.unlocked.includes(id)

export function createInitialGame(now = Date.now()) {
  return {
    schemaVersion: SAVE_SCHEMA,
    gameVersion: GAME_VERSION,
    createdAt: now, updatedAt: now,
    progress: { unlocked: [], startedAt: {} },
    identity: { company: null },
    economy: { balance: null, currency: 'M', ledger: { completed: 0, gross: 0, expenses: 0 } },
    cityMissions: Array.from({ length: MISSION_COUNT }, (_, slot) => createCityMission(slot, 0, now, now)),
    // Extension space for subsequent company research. Does not appear in the base UI.
    modules: { studies: [], data: {} },
    // Old railway state can be imported without returning obsolete railway menus.
    legacyArchive: null,
  }
}

export function isValidGame(g) {
  if (!g || typeof g !== 'object' || Array.isArray(g) || g.schemaVersion !== SAVE_SCHEMA ||
      !isTime(g.createdAt) || !isTime(g.updatedAt)) return false
  const p = g.progress
  if (!p || !Array.isArray(p.unlocked) || p.unlocked.some(id => !UNLOCK_IDS.has(id)) ||
      new Set(p.unlocked).size !== p.unlocked.length || !p.startedAt || typeof p.startedAt !== 'object' ||
      Array.isArray(p.startedAt) || Object.entries(p.startedAt).some(([id, at]) => !UNLOCK_IDS.has(id) || !isTime(at))) return false
  if (!g.identity || !(g.identity.company === null || (
    isStr(g.identity.company.name, 40) && isTime(g.identity.company.foundedAt)))) return false
  const e = g.economy
  if (!e || e.currency !== 'M' || !(e.balance === null || Number.isSafeInteger(e.balance) && e.balance >= 0) ||
      !e.ledger || ['completed', 'gross', 'expenses'].some(k => !Number.isSafeInteger(e.ledger[k]) || e.ledger[k] < 0)) return false
  if (p.unlocked.includes('funds') !== (e.balance !== null)) return false
  if (p.unlocked.includes('company') !== Boolean(g.identity.company)) return false
  if (!Array.isArray(g.cityMissions) || g.cityMissions.length !== MISSION_COUNT ||
      g.cityMissions.some((m, slot) => !m || m.id !== `city-${slot + 1}` || m.slot !== slot ||
        !Number.isSafeInteger(m.sequence) || m.sequence < 0 || !Number.isInteger(m.cityId) ||
        m.cityId < 0 || m.cityId >= CITIES.length || !Number.isInteger(m.taskId) ||
        m.taskId < 0 || m.taskId >= CITY_TASKS.length || !isTime(m.startedAt) ||
        !isTime(m.endsAt) || m.endsAt <= m.startedAt)) return false
  if (!g.modules || !Array.isArray(g.modules.studies) || !g.modules.data || typeof g.modules.data !== 'object') return false
  if (!Object.hasOwn(g, 'legacyArchive')) return false
  return true
}

export function beginUnlock(g, id, now = Date.now()) {
  if (!UNLOCK_IDS.has(id)) throw new Error('없는 연구입니다.')
  if (isUnlocked(g, id)) throw new Error('이미 해금된 연구입니다.')
  if (Object.hasOwn(g.progress.startedAt, id)) throw new Error('이미 진행 중입니다.')
  return {
    ...g, updatedAt: now,
    progress: { ...g.progress, startedAt: { ...g.progress.startedAt, [id]: now } },
  }
}

export function renameCompany(g, name, now = Date.now()) {
  if (!isUnlocked(g, 'company')) throw new Error('회사를 먼저 해금해 주세요.')
  const clean = String(name ?? '').trim()
  if (!clean || clean.length > 40) throw new Error('회사 이름은 1~40자로 입력해 주세요.')
  return { ...g, updatedAt: now, identity: { company: { ...g.identity.company, name: clean } } }
}

// Each completed city task can settle once; rewards begin strictly AFTER fund unlock.
export function advanceWorld(g, now = Date.now()) {
  const research = [...g.progress.unlocked]
  const newlyUnlocked = []
  for (const { id } of BASIC_UNLOCKS) {
    const started = g.progress.startedAt[id]
    if (!research.includes(id) && isTime(started) && now >= started + UNLOCK_DURATION_MS) {
      research.push(id)
      newlyUnlocked.push(id)
    }
  }
  const fundsUnlocked = research.includes('funds')
  const cutoff = isTime(g.progress.startedAt.funds)
    ? g.progress.startedAt.funds + UNLOCK_DURATION_MS : (isUnlocked(g, 'funds') ? g.updatedAt : Infinity)
  let completed = 0
  let paid = 0
  let gross = 0
  let expenses = 0
  let paidCompletions = 0
  const cityMissions = g.cityMissions.map(original => {
    let m = original
    while (m.endsAt <= now) {
      completed++
      if (fundsUnlocked && m.endsAt > cutoff) {
        const seconds = (m.endsAt - m.startedAt) / SECOND_MS
        const amount = seconds * REWARD_RATE
        const cost = seconds * ACCEPT_RATE
        paid += amount - cost
        paidCompletions++
        gross += amount
        expenses += cost
      }
      m = createCityMission(m.slot, m.sequence + 1, m.endsAt, g.createdAt)
    }
    return m
  })
  const changed = newlyUnlocked.length > 0 || completed > 0
  if (!changed) return { game: g, changed: false, newlyUnlocked, completed, paid }
  const company = newlyUnlocked.includes('company')
    ? { name: '나의 회사', foundedAt: g.progress.startedAt.company + UNLOCK_DURATION_MS }
    : g.identity.company
  const baseBalance = fundsUnlocked ? (g.economy.balance ?? 0) : null
  const result = {
    ...g, updatedAt: now,
    progress: { ...g.progress, unlocked: research },
    identity: { ...g.identity, company },
    economy: { ...g.economy, balance: fundsUnlocked ? baseBalance + paid : null,
      ledger: { completed: g.economy.ledger.completed + paidCompletions,
        gross: g.economy.ledger.gross + gross, expenses: g.economy.ledger.expenses + expenses } },
    cityMissions,
  }
  return { game: result, changed: true, newlyUnlocked, completed, paid }
}

/** Converts the former railway-first v0.01 save into the clean city-first format. */
export function migrateLegacyGame(previous, now = Date.now()) {
  if (!previous || previous.schemaVersion !== 1 || !previous.progress ||
      !Array.isArray(previous.progress.research) || !Array.isArray(previous.routes) ||
      !Array.isArray(previous.vehicles) || !Array.isArray(previous.activeRuns) ||
      !Array.isArray(previous.runHistory) || !isTime(previous.createdAt)) {
    throw new Error('이전 저장 데이터가 올바르지 않습니다.')
  }
  const next = createInitialGame(now)
  const unlocked = [...new Set(previous.progress.research.map(id => id === 'time-sense' ? 'time' : id)
    .filter(id => UNLOCK_IDS.has(id)))]
  const previousStart = previous.progress.unlockStartedAt || {}
  const startedAt = {}
  for (const id of UNLOCK_IDS) {
    if (isTime(previousStart[id])) startedAt[id] = previousStart[id]
    else if (unlocked.includes(id)) startedAt[id] = Math.max(0, now - UNLOCK_DURATION_MS)
  }
  next.progress = { unlocked, startedAt }
  if (unlocked.includes('company')) next.identity.company = {
    name: (previous.identity?.company?.name || '나의 회사').slice(0, 40),
    foundedAt: previous.identity?.company?.foundedAt ?? now,
  }
  if (unlocked.includes('funds')) next.economy.balance = Number.isSafeInteger(previous.economy?.balance)
    ? Math.max(0, previous.economy.balance) : 0
  // Keep the former railway assets in save.json, but do not reactivate their obsolete interface.
  next.legacyArchive = {
    importedAt: now,
    routes: copy(previous.routes),
    vehicles: copy(previous.vehicles),
    activeRuns: copy(previous.activeRuns),
    runHistory: copy(previous.runHistory),
    progress: copy(previous.progress),
    extensions: copy(previous.extensions || {}),
  }
  // Preserve ongoing city tasks when the previous snapshot already had them.
  if (Array.isArray(previous.cityMissions) && previous.cityMissions.length === MISSION_COUNT) {
    next.createdAt = previous.createdAt
    next.cityMissions = copy(previous.cityMissions)
  }
  if (!isValidGame(next)) throw new Error('구 저장 데이터를 변환할 수 없습니다.')
  return next
}
export function normalizeImport(input, now = Date.now()) {
  if (isValidGame(input)) return copy(input)
  if (input?.schemaVersion === 1) return migrateLegacyGame(input, now)
  throw new Error('MYON 저장 파일이 아니거나 데이터가 손상되었습니다.')
}
