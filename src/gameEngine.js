/** MYON v0.01 — pure game rules. Timestamps are stored, never derived from a Vue proxy. */
export const SAVE_SCHEMA = 1
export const GAME_VERSION = '0.01'
// The four foundational unlocks are independent 24-hour real-time tasks.
export const UNLOCK_DURATION_MS = 24 * 60 * 60 * 1000
export const BASIC_UNLOCKS = [
  { id: 'company', title: '회사 신설하기', description: '회사 메뉴와 후속 심층 연구의 기반을 엽니다.' },
  { id: 'time', title: '시간 연구하기', description: '표준시간, 도시 임무와 연구의 소요·남은 시간을 확인합니다.' },
  { id: 'funds', title: '자금 연구하기', description: '자금 0 M부터 도시 임무의 완료 수익을 쌓습니다.' },
  { id: 'assistant', title: '비서 연구하기', description: '시스템 변경기록을 확인합니다. 이후 회사 연구로 확장됩니다.' },
]
export const CITY_TASKS = [
  '도심 기반시설 현황 조사', '신도시 개발계획 검토', '지역 교통수요 분석',
  '도시 생활환경 실태조사', '주요 상업지구 현황 분석', '도시 인구이동 조사',
  '공공시설 운영현황 점검', '지역 산업단지 수요조사',
  '도시 연결망 개선방안 검토', '신규 도시개발 후보지 조사',
]
export const CITIES = ['서울', '부산', '인천', '수원', '대전', '대구', '광주', '울산', '세종', '제주']
// Deep research from the original functioning railway game remains available after company unlock.
export const RESEARCH = [
  { id: 'route-design', title: '노선 설계', requirement: 1, description: '내 운행 경로를 자유롭게 추가하고 관리합니다.' },
]

// Deterministic task generation: an offline catch-up produces the same rotations as online play.
function taskRandom(seed, slot, sequence) {
  let n = (Math.floor(seed / 1000) ^ Math.imul(slot + 1, 0x9e3779b1) ^ Math.imul(sequence + 1, 0x85ebca6b)) >>> 0
  n ^= n >>> 16; n = Math.imul(n, 0x7feb352d)
  n ^= n >>> 15; n = Math.imul(n, 0x846ca68b)
  return (n ^ (n >>> 16)) >>> 0
}
export function makeCityMission(slot, sequence, startedAt, seed) {
  const n = taskRandom(seed, slot, sequence)
  // Each city assignment lasts 15 minutes to 4 hours, in five-minute increments.
  const durationSeconds = (3 + (n % 46)) * 300
  return {
    id: `city-${slot + 1}`, slot, sequence,
    cityId: (slot + Math.floor(n / 47)) % CITIES.length,
    taskId: sequence === 0 ? slot % CITY_TASKS.length : Math.floor(n / 997) % CITY_TASKS.length,
    startedAt, endsAt: startedAt + durationSeconds * 1000,
  }
}
export const cityMissionName = mission => `${CITIES[mission.cityId]} · ${CITY_TASKS[mission.taskId]}`

const uniqueId = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`

export function createInitialGame(now = Date.now()) {
  return {
    schemaVersion: SAVE_SCHEMA,
    gameVersion: GAME_VERSION,
    createdAt: now,
    updatedAt: now,
    identity: { company: null },
    economy: { mode: 'none', balance: null, realModeUnlocked: false },
    progress: { completedRuns: 0, research: [], fixedDispatchUnlocked: false, unlockStartedAt: {} },
    routes: [{ id: 'route-001', name: '첫 번째 경로', stations: ['서울', '대전', '부산'], runs: 0 }],
    vehicles: [
      { id: 'L-001', name: '기관차 001', type: 'locomotive', station: '서울', attachedTo: null },
      { id: 'C-001', name: '객차 001', type: 'coach', station: '서울', attachedTo: 'L-001' },
      { id: 'C-002', name: '객차 002', type: 'coach', station: '서울', attachedTo: 'L-001' },
    ],
    activeRuns: [],
    cityMissions: Array.from({ length: 10 }, (_, i) => makeCityMission(i, 0, now, now)),
    // Prior to fixed dispatch, completed operations are settled then discarded.
    runHistory: [],
    extensions: { aviation: {}, manufacturing: {} },
  }
}

const isString = (v, limit = 200) => typeof v === 'string' && v.length > 0 && v.length <= limit
const validTime = v => Number.isFinite(v) && v >= 0
export function isValidGame(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.schemaVersion !== SAVE_SCHEMA) return false
  if (!validTime(data.createdAt) || !validTime(data.updatedAt)) return false
  if (!data.identity || !Object.hasOwn(data.identity, 'company')) return false
  if (!data.economy || typeof data.economy.mode !== 'string') return false
  const p = data.progress
  if (!p || !Number.isSafeInteger(p.completedRuns) || p.completedRuns < 0 ||
    !Array.isArray(p.research) || !p.research.every(x => isString(x, 100)) ||
    typeof p.fixedDispatchUnlocked !== 'boolean') return false
  if (p.unlockStartedAt !== undefined && (
    !p.unlockStartedAt || typeof p.unlockStartedAt !== 'object' || Array.isArray(p.unlockStartedAt) ||
    Object.entries(p.unlockStartedAt).some(([k, v]) => !BASIC_UNLOCKS.some(item => item.id === k) || !validTime(v))
  )) return false
  if (data.cityMissions !== undefined && (
    !Array.isArray(data.cityMissions) || data.cityMissions.length !== 10 ||
    data.cityMissions.some((m, i) => !m || m.id !== `city-${i+1}` || m.slot !== i ||
      !Number.isSafeInteger(m.sequence) || m.sequence < 0 ||
      !Number.isSafeInteger(m.cityId) || m.cityId < 0 || m.cityId >= CITIES.length ||
      !Number.isSafeInteger(m.taskId) || m.taskId < 0 || m.taskId >= CITY_TASKS.length ||
      !validTime(m.startedAt) || !validTime(m.endsAt) || m.endsAt <= m.startedAt)
  )) return false
  if (data.economy.balance !== null && (!Number.isSafeInteger(data.economy.balance) || data.economy.balance < 0)) return false
  if (!Array.isArray(data.routes) || data.routes.length < 1 || data.routes.length > 5000 ||
    !Array.isArray(data.vehicles) || data.vehicles.length > 100000 ||
    !Array.isArray(data.activeRuns) || data.activeRuns.length > 100000 ||
    !Array.isArray(data.runHistory) || !data.extensions || typeof data.extensions !== 'object') return false
  const routeIds = new Set()
  for (const route of data.routes) {
    if (!isString(route.id) || !isString(route.name, 50) || routeIds.has(route.id) ||
      !Array.isArray(route.stations) || route.stations.length < 2 || route.stations.length > 30 ||
      route.stations.some(s => !isString(s, 40)) || new Set(route.stations).size !== route.stations.length ||
      !Number.isSafeInteger(route.runs) || route.runs < 0) return false
    routeIds.add(route.id)
  }
  const vehicles = new Map()
  for (const vehicle of data.vehicles) {
    if (!isString(vehicle.id) || vehicles.has(vehicle.id) || !isString(vehicle.name, 60) ||
      !['locomotive', 'coach'].includes(vehicle.type) || !isString(vehicle.station, 40) ||
      !(vehicle.attachedTo === null || isString(vehicle.attachedTo))) return false
    vehicles.set(vehicle.id, vehicle)
  }
  for (const v of data.vehicles) {
    if (v.attachedTo && (v.type !== 'coach' || vehicles.get(v.attachedTo)?.type !== 'locomotive')) return false
  }
  const activeLocos = new Set(), activeIds = new Set()
  for (const run of data.activeRuns) {
    if (!isString(run.id) || activeIds.has(run.id) || !routeIds.has(run.routeId) ||
      vehicles.get(run.locoId)?.type !== 'locomotive' || activeLocos.has(run.locoId) ||
      !isString(run.from, 40) || !isString(run.to, 40) || run.from === run.to ||
      !validTime(run.startedAt) || !validTime(run.endsAt) || run.endsAt <= run.startedAt) return false
    const route = data.routes.find(r => r.id === run.routeId)
    if (!route.stations.includes(run.from) || !route.stations.includes(run.to) || vehicles.get(run.locoId).station !== run.from) return false
    activeIds.add(run.id)
    activeLocos.add(run.locoId)
  }
  return true
}

/** Upgrade old v0.01 snapshots without deleting routes, vehicles, research, or active runs. */
export function migrateGame(snapshot, now = Date.now()) {
  if (!isValidGame(snapshot)) throw new Error('MYON 저장 데이터가 올바르지 않습니다.')
  const game = JSON.parse(JSON.stringify(snapshot))
  const isLegacySave = !game.cityMissions
  // Older v0.01 players could use railway operations without a company.
  // Grandfather their existing railway progress so an update does not hide
  // features they already used behind a fresh 24-hour company research.
  const hadRailwayProgress = game.progress.completedRuns > 0 ||
    game.activeRuns.length > 0 || game.routes.length > 1 ||
    game.progress.research.includes('route-design')
  game.progress.unlockStartedAt ??= {}
  // Prior time-sense research is honored instead of silently taking access away.
  if (game.progress.research.includes('time-sense') && !game.progress.research.includes('time')) {
    game.progress.research.push('time')
  }
  if (!game.cityMissions) {
    game.cityMissions = Array.from({ length: 10 }, (_, i) => makeCityMission(i, 0, now, game.createdAt))
  }
  if (isLegacySave && hadRailwayProgress && !game.progress.research.includes('company')) {
    game.progress.research.push('company')
  }
  if (game.progress.research.includes('company') && !game.identity.company) {
    const started = game.progress.unlockStartedAt.company
    game.identity.company = {
      name: '나의 회사',
      foundedAt: Number.isFinite(started) ? started + UNLOCK_DURATION_MS : now,
    }
  }
  if (game.progress.research.includes('funds') && !Number.isSafeInteger(game.economy.balance)) {
    game.economy = { ...game.economy, mode: 'myon', balance: 0 }
  }
  return game
}

export function beginUnlock(game, id, now = Date.now()) {
  if (!BASIC_UNLOCKS.some(u => u.id === id)) throw new Error('존재하지 않는 해금 임무입니다.')
  if (game.progress.research.includes(id)) throw new Error('이미 해금된 기능입니다.')
  if (Object.hasOwn(game.progress.unlockStartedAt, id)) throw new Error('이미 진행 중인 연구입니다.')
  return {
    ...game, updatedAt: now,
    progress: { ...game.progress, unlockStartedAt: { ...game.progress.unlockStartedAt, [id]: now } },
  }
}

/** One settlement pass handles both resumed offline sessions and normal 1-second ticks. */
export function advanceWorld(game, now = Date.now()) {
  const research = [...game.progress.research]
  const newlyUnlocked = []
  for (const { id } of BASIC_UNLOCKS) {
    const started = game.progress.unlockStartedAt[id]
    if (!research.includes(id) && Number.isFinite(started) && now >= started + UNLOCK_DURATION_MS) {
      research.push(id)
      newlyUnlocked.push(id)
    }
  }
  const fundsUnlocked = research.includes('funds')
  // Completion is eligible only if it occurs strictly after the exact research unlock time.
  const fundsAt = Number.isFinite(game.progress.unlockStartedAt.funds)
    ? game.progress.unlockStartedAt.funds + UNLOCK_DURATION_MS : (fundsUnlocked ? 0 : Infinity)
  let balance = fundsUnlocked ? (game.economy.balance ?? 0) : null
  let cityCompleted = 0
  let cityEarned = 0
  const cityMissions = game.cityMissions.map(original => {
    let mission = original
    while (mission.endsAt <= now) {
      cityCompleted++
      if (fundsUnlocked && mission.endsAt > fundsAt) {
        // 100 M / second reward - 50 M / second acceptance cost, settled at completion.
        const net = ((mission.endsAt - mission.startedAt) / 1000) * 50
        cityEarned += net
      }
      mission = makeCityMission(mission.slot, mission.sequence + 1, mission.endsAt, game.createdAt)
    }
    return mission
  })
  const companyWasUnlocked = newlyUnlocked.includes('company')
  const companyStartedAt = game.progress.unlockStartedAt.company
  const identity = companyWasUnlocked && !game.identity.company
    ? { ...game.identity, company: { name: '나의 회사', foundedAt: companyStartedAt + UNLOCK_DURATION_MS } }
    : game.identity
  const base = newlyUnlocked.length || cityCompleted ? {
    ...game, updatedAt: now, identity,
    progress: { ...game.progress, research },
    economy: fundsUnlocked ? { ...game.economy, mode: 'myon', balance: balance + cityEarned } : game.economy,
    cityMissions,
  } : game
  const runsResult = settleRuns(base, now)
  return {
    game: runsResult.game,
    changed: runsResult.game !== game,
    cityCompleted, cityEarned, newlyUnlocked, finished: runsResult.finished,
  }
}

export function availableLocomotives(game) {
  const busy = new Set(game.activeRuns.map(r => r.locoId))
  return game.vehicles.filter(v => v.type === 'locomotive' && !busy.has(v.id))
}

export function startRun(game, { routeId, locoId, to }, now = Date.now(), random = Math.random) {
  const route = game.routes.find(r => r.id === routeId)
  const loco = availableLocomotives(game).find(v => v.id === locoId)
  if (!route || !loco) throw new Error('운행 가능한 기관차와 노선을 선택해 주세요.')
  if (!route.stations.includes(loco.station)) throw new Error('현재 기관차 위치가 이 노선에 포함되어 있지 않아요.')
  if (!route.stations.includes(to) || to === loco.station) throw new Error('다른 도착역을 선택해 주세요.')
  const distance = Math.abs(route.stations.indexOf(to) - route.stations.indexOf(loco.station))
  const randomUnit = Math.min(.999999, Math.max(0, Number(random()) || 0))
  // Hidden duration: not shown until 'time-sense' research is completed.
  const duration = (20 + distance * 12 + Math.floor(randomUnit * 24)) * 1000
  const run = { id: uniqueId(), routeId, locoId, from: loco.station, to, startedAt: now, endsAt: now + duration }
  return { ...game, updatedAt: now, activeRuns: [...game.activeRuns, run] }
}

export function settleRuns(game, now = Date.now()) {
  const due = game.activeRuns.filter(r => r.endsAt <= now).sort((a, b) => a.endsAt - b.endsAt)
  if (!due.length) return { game, finished: [] }
  const completedSet = new Set(due.map(r => r.id))
  const destinations = new Map(due.map(run => [run.locoId, run.to]))
  const newVehicles = game.vehicles.map(vehicle => {
    const mainId = vehicle.type === 'locomotive' ? vehicle.id : vehicle.attachedTo
    return destinations.has(mainId) ? { ...vehicle, station: destinations.get(mainId) } : vehicle
  })
  const perRoute = due.reduce((m, run) => m.set(run.routeId, (m.get(run.routeId) || 0) + 1), new Map())
  const runHistory = game.progress.fixedDispatchUnlocked
    ? [...game.runHistory, ...due.map(({ id, routeId, locoId, from, to, startedAt, endsAt }) => ({ id, routeId, locoId, from, to, startedAt, endsAt }))]
    : game.runHistory
  return {
    game: {
      ...game, updatedAt: now,
      vehicles: newVehicles,
      routes: game.routes.map(r => perRoute.has(r.id) ? { ...r, runs: r.runs + perRoute.get(r.id) } : r),
      activeRuns: game.activeRuns.filter(r => !completedSet.has(r.id)),
      runHistory,
      progress: { ...game.progress, completedRuns: game.progress.completedRuns + due.length },
    },
    finished: due,
  }
}

export function completeResearch(game, researchId, now = Date.now()) {
  const tech = RESEARCH.find(item => item.id === researchId)
  if (!tech) throw new Error('아직 개발되지 않은 연구입니다.')
  if (!game.progress.research.includes('company')) throw new Error('회사 해금 후 심층 연구를 진행할 수 있습니다.')
  if (game.progress.research.includes(researchId)) throw new Error('이미 완료된 연구입니다.')
  if (game.progress.completedRuns < tech.requirement) throw new Error('운영 경험이 부족합니다.')
  return {
    ...game, updatedAt: now,
    progress: { ...game.progress, research: [...game.progress.research, researchId] },
  }
}

export function addRoute(game, name, stationInput, now = Date.now()) {
  if (!game.progress.research.includes('company')) throw new Error('회사 해금이 필요합니다.')
  if (!game.progress.research.includes('route-design')) throw new Error('노선 설계 연구가 필요합니다.')
  const cleanName = String(name || '').trim()
  const stations = String(stationInput || '').split(/[,，→\n]+/).map(x => x.trim()).filter(Boolean)
  if (!cleanName || cleanName.length > 40) throw new Error('노선 이름은 1~40자로 입력해 주세요.')
  if (stations.length < 2 || stations.length > 30 || stations.some(s => s.length > 40) || new Set(stations).size !== stations.length)
    throw new Error('중복 없이 역 이름을 2~30개 입력해 주세요.')
  if (game.routes.length >= 5000) throw new Error('노선 수가 너무 많습니다.')
  return {
    ...game, updatedAt: now,
    routes: [...game.routes, { id: uniqueId(), name: cleanName, stations, runs: 0 }],
  }
}

export function deleteRoute(game, routeId, now = Date.now()) {
  if (game.routes.length < 2) throw new Error('기본 운행을 위해 노선 하나는 남겨 두어야 합니다.')
  if (game.activeRuns.some(r => r.routeId === routeId)) throw new Error('운행 중인 노선은 삭제할 수 없습니다.')
  if (!game.routes.some(r => r.id === routeId)) throw new Error('노선을 찾을 수 없습니다.')
  return { ...game, updatedAt: now, routes: game.routes.filter(r => r.id !== routeId) }
}
