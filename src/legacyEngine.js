/** MYON v0.01 — event-based offline taxi economy; 1 game tick is 1 real second. */
export const GAME_VERSION = '0.01'
export const SAVE_SCHEMA = 4
export const TICK_MS = 1000
export const COMPANY_PRICE = 100_000
export const TAXI_PRICE = 50_000
export const FARE_PER_KM = 100
export const PICKUP_MIN_SECONDS = 120
export const PICKUP_MAX_SECONDS = 300
export const HISTORY_LIMIT = 45
export const LOG_LIMIT = 35
export const DISTRICTS = Object.freeze(['중앙광장','동부주거지','서부시장','북부역','남부공원','신도심','산업단지','종합병원','대학교','시청','공항터미널','문화지구'])
const clone = obj => JSON.parse(JSON.stringify(obj))
const validTime = n => Number.isSafeInteger(n) && n >= 0
const validAmount = n => Number.isSafeInteger(n) && n >= 0
const nextSeed = seed => { let x = seed >>> 0 || 0x6d2b79f5; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0 || 1 }
function roll(vehicle, min, max) { vehicle.seed = nextSeed(vehicle.seed); return min + vehicle.seed % (max - min + 1) }
function addLog(g, at, message) { g.logs.unshift({ at, message }); if (g.logs.length > LOG_LIMIT) g.logs.length = LOG_LIMIT }
function addHistory(g, item) { g.history.unshift(item); if (g.history.length > HISTORY_LIMIT) g.history.length = HISTORY_LIMIT }
function taxi(number, seed, location = '중앙광장') {
  return { id: `TX-${String(number).padStart(3,'0')}`, number, seed: seed >>> 0 || 1,
    location, stage: 'idle', startedAt: null, endsAt: null, job: null,
    stats: { rides: 0, earnings: 0, distanceKm: 0, serviceSeconds: 0, calls: 0 } }
}
export function createInitialGame(now = Date.now(), seed = Math.floor(Math.random() * 0xFFFFFFFF)) {
  const citySeed = seed >>> 0 || 42
  return {
    schemaVersion: SAVE_SCHEMA, gameVersion: GAME_VERSION, createdAt: now, updatedAt: now,
    city: { name: '', seed: citySeed },
    phase: 'intro',
    economy: { balance: 0, currency: 'M', gross: 0, spent: 0 },
    company: null,
    taxis: [taxi(1, nextSeed(citySeed))],
    stats: { completedTrips: 0, revenue: 0, distanceKm: 0, serviceSeconds: 0, callTrips: 0 },
    history: [], logs: [],
  }
}
export function isValidGame(g) {
  if (!g || g.schemaVersion !== SAVE_SCHEMA || !validTime(g.createdAt) || !validTime(g.updatedAt) ||
      !g.city || typeof g.city.name !== 'string' || g.city.name.length > 40 || !Number.isInteger(g.city.seed) ||
      (g.phase === 'ready' && !g.city.name.trim()) || (g.phase === 'intro' && g.city.name !== '') ||
      !['intro','ready'].includes(g.phase) || !g.economy || g.economy.currency !== 'M' ||
      !['balance','gross','spent'].every(k => validAmount(g.economy[k])) ||
      !(g.company === null || (typeof g.company.name === 'string' && g.company.name.trim().length > 0 && g.company.name.length <= 40 && validTime(g.company.acquiredAt) && typeof g.company.welcomed === 'boolean')) ||
      !Array.isArray(g.taxis) || g.taxis.length < 1 || g.taxis.length > 500 ||
      !g.stats || !['completedTrips','revenue','distanceKm','serviceSeconds','callTrips'].every(k => validAmount(g.stats[k])) ||
      !Array.isArray(g.history) || g.history.length > HISTORY_LIMIT || !Array.isArray(g.logs) || g.logs.length > LOG_LIMIT) return false
  const ids = new Set()
  for (const t of g.taxis) {
    if (!t || typeof t.id !== 'string' || ids.has(t.id) || !Number.isSafeInteger(t.number) || !Number.isSafeInteger(t.seed) ||
        typeof t.location !== 'string' || !['idle','waiting','pickup','ride'].includes(t.stage) ||
        !t.stats || !['rides','earnings','distanceKm','serviceSeconds','calls'].every(k=>validAmount(t.stats[k]))) return false
    ids.add(t.id)
    if (t.stage === 'idle') { if (t.startedAt !== null || t.endsAt !== null || t.job !== null) return false }
    else if (!validTime(t.startedAt) || !validTime(t.endsAt) || t.endsAt <= t.startedAt) return false
    if (t.stage === 'pickup' || t.stage === 'ride') {
      if (!t.job || !Number.isSafeInteger(t.job.km) || t.job.km < 1 || !validAmount(t.job.fare) ||
          !['street','call'].includes(t.job.kind) || typeof t.job.destination !== 'string') return false
    }
  }
  if (g.phase === 'intro' && (g.company !== null || g.taxis.some(t=>t.stage!=='idle'))) return false
  if (g.company && g.phase !== 'ready') return false
  return true
}
function ensure(g) { if (!isValidGame(g)) throw new Error('저장 데이터가 올바르지 않습니다.') }
function beginWait(t, at) {
  t.stage = 'waiting'; t.startedAt = at; t.endsAt = at + roll(t, 12, 48) * TICK_MS; t.job = null
}
export function startGame(g, name, now = Date.now()) {
  ensure(g)
  if (g.phase !== 'intro') throw new Error('게임은 이미 시작되었습니다.')
  const cityName=String(name??'').trim()
  if (!cityName || cityName.length > 40) throw new Error('도시 이름을 1~40자로 입력해 주세요.')
  const next = clone(g); next.city.name=cityName; next.phase = 'ready'; next.updatedAt = now
  addLog(next, now, `${next.city.name} 교통 정상화 사업이 시작되었습니다.`)
  return next
}
/** A company is established by naming it, with no purchase price or initial deduction. */
export function establishCompany(g, name, now = Date.now()) {
  ensure(g)
  if (g.phase !== 'ready' || g.company) throw new Error('회사 이름은 처음 한 번만 정할 수 있습니다.')
  const companyName = String(name ?? '').trim()
  if (!companyName || companyName.length > 40) throw new Error('회사 이름을 1~40자로 입력해 주세요.')
  const next = clone(g)
  // Legacy saves could have active taxis before a company existed. Keep their
  // unfinished work, but do not count the company-less period as operation.
  const pauseMs = Math.max(0, now - g.updatedAt)
  for (const t of next.taxis) if (t.stage !== 'idle') {
    t.startedAt += pauseMs
    t.endsAt += pauseMs
  }
  next.company = { name: companyName, acquiredAt: now, welcomed: true }
  next.updatedAt = now
  addLog(next, now, `${companyName} 운영 시작`)
  return next
}
export function beginTaxiService(g, id = 'TX-001', now = Date.now()) {
  ensure(g)
  if (g.phase !== 'ready') throw new Error('게임을 먼저 시작해 주세요.')
  if (!g.company) throw new Error('회사 이름을 먼저 정해 주세요.')
  const next = clone(g)
  const t = next.taxis.find(x => x.id === id)
  if (!t) throw new Error('없는 차량입니다.')
  if (t.stage !== 'idle') throw new Error('이미 영업 중입니다.')
  beginWait(t, now); next.updatedAt = now
  addLog(next, now, `${t.id} 영업 시작 · 콜 & 승객 대기`)
  return next
}
function makeJob(t) {
  const kind = roll(t,0,1) === 0 ? 'street' : 'call'
  const km = roll(t, 2, 14)
  const destination = DISTRICTS[roll(t,0,DISTRICTS.length-1)]
  return { kind, km, destination, fare: km * FARE_PER_KM }
}
function beginRide(t, at) {
  const seconds = t.job.km * roll(t, 65, 105) + roll(t, 15, 70)
  t.stage = 'ride'; t.startedAt = at; t.endsAt = at + seconds * TICK_MS
}
function finishStage(g, t) {
  const when = t.endsAt
  const elapsed = (when - t.startedAt) / TICK_MS
  t.stats.serviceSeconds += elapsed
  g.stats.serviceSeconds += elapsed
  if (t.stage === 'waiting') {
    t.job = makeJob(t)
    if (t.job.kind === 'call') {
      const pickup = roll(t, PICKUP_MIN_SECONDS, PICKUP_MAX_SECONDS)
      t.stage = 'pickup'; t.startedAt = when; t.endsAt = when + pickup * TICK_MS
      addLog(g, when, `${t.id} 콜 접수 · 픽업 ${Math.ceil(pickup/60)}분 이내`)
    } else {
      beginRide(t, when)
      addLog(g, when, `${t.id} 일반 승객 탑승 · ${t.job.destination} ${t.job.km}km`)
    }
  } else if (t.stage === 'pickup') {
    beginRide(t, when)
    addLog(g, when, `${t.id} 콜 승객 탑승 · ${t.job.destination} ${t.job.km}km`)
  } else if (t.stage === 'ride') {
    const job = t.job
    t.location = job.destination
    t.stats.rides++; t.stats.earnings += job.fare; t.stats.distanceKm += job.km
    if (job.kind === 'call') t.stats.calls++
    g.stats.completedTrips++; g.stats.revenue += job.fare; g.stats.distanceKm += job.km
    if (job.kind === 'call') g.stats.callTrips++
    g.economy.balance += job.fare; g.economy.gross += job.fare
    addHistory(g, { at: when, taxiId: t.id, kind: job.kind, destination: job.destination, km: job.km, fare: job.fare })
    addLog(g, when, `${t.id} ${job.destination} 하차 · +${job.fare.toLocaleString('ko-KR')} M`)
    t.stage = 'idle'; t.startedAt = null; t.endsAt = null; t.job = null
    if (g.company) beginWait(t, when)
  }
}
/** Runs missed state transitions from their original due timestamps (also while offline).
 * Bounded work protects the UI on very long gaps; subsequent calls continue catching up. */
export function advanceWorld(g, now = Date.now(), maxEventsPerTaxi = 20000) {
  ensure(g)
  if (g.phase !== 'ready' || !g.company) return { game:g, changed:false, transitions:0, hasBacklog:false, earned:0 }
  const next = clone(g)
  let transitions = 0, hasBacklog = false
  const before = next.economy.balance
  for (const t of next.taxis) {
    let iterations = 0
    while (t.stage !== 'idle' && t.endsAt <= now && iterations < maxEventsPerTaxi) {
      finishStage(next,t); iterations++; transitions++
    }
    if (t.stage !== 'idle' && t.endsAt <= now) hasBacklog = true
  }
  if (!transitions) return { game:g, changed:false, transitions, hasBacklog, earned:0 }
  next.updatedAt = now
  return { game:next, changed:true, transitions, hasBacklog, earned:next.economy.balance-before }
}
export function acquireCompany(g, name, now = Date.now()) {
  ensure(g)
  if (g.phase !== 'ready' || g.company) throw new Error('현재 회사 인수를 진행할 수 없습니다.')
  if (g.economy.balance < COMPANY_PRICE) throw new Error(`${(COMPANY_PRICE-g.economy.balance).toLocaleString('ko-KR')} M이 부족합니다.`)
  const companyName=String(name??'').trim()
  if (!companyName || companyName.length > 40) throw new Error('회사 이름을 1~40자로 입력해 주세요.')
  const next=clone(g)
  next.economy.balance -= COMPANY_PRICE; next.economy.spent += COMPANY_PRICE
  next.company = { name:companyName, acquiredAt:now, welcomed:false }
  for (const t of next.taxis) if (t.stage === 'idle') beginWait(t,now)
  next.updatedAt=now; addLog(next,now,`택시회사 인수 완료 · 100,000 M · 자동운행 시작`)
  return next
}
export function welcomeSecretary(g, now = Date.now()) {
  ensure(g)
  if (!g.company) throw new Error('먼저 회사를 인수해 주세요.')
  const next=clone(g);next.company.welcomed=true;next.updatedAt=now;return next
}
export function purchaseTaxi(g, now = Date.now()) {
  ensure(g)
  if (!g.company) throw new Error('회사 인수 후 차량을 추가할 수 있습니다.')
  if (g.economy.balance < TAXI_PRICE) throw new Error(`${(TAXI_PRICE-g.economy.balance).toLocaleString('ko-KR')} M이 부족합니다.`)
  if (g.taxis.length >= 500) throw new Error('최대 500대까지 관리할 수 있습니다.')
  const next=clone(g)
  next.economy.balance-=TAXI_PRICE;next.economy.spent+=TAXI_PRICE
  const newNumber = Math.max(...next.taxis.map(x=>x.number))+1
  const t=taxi(newNumber,nextSeed((next.city.seed ^ (newNumber*2654435761))>>>0))
  beginWait(t, now);next.taxis.push(t);next.updatedAt=now
  addLog(next,now,`${t.id} 도입 완료 · 50,000 M · 독립 자동운행 시작`)
  return next
}
export function renameCompany(g, name, now=Date.now()) {
  ensure(g);if(!g.company)throw new Error('회사 인수 후 변경 가능합니다.')
  const title=String(name??'').trim()
  if(!title || title.length>40)throw new Error('회사명은 1~40자로 입력해 주세요.')
  const next=clone(g);next.company.name=title;next.updatedAt=now;return next
}
/** New game data only: older backup formats are not silently applied to the reset game. */
export function normalizeImport(input) {
  if (isValidGame(input)) return clone(input)
  throw new Error('새 MYON 저장 형식이 아닙니다. 이전 저장파일은 새 게임에 적용되지 않습니다.')
}
