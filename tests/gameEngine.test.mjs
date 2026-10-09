import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SAVE_SCHEMA, GAME_VERSION, MISSION_COUNT, CITY_TASKS, BASIC_UNLOCKS, UNLOCK_DURATION_MS,
  ACCEPT_RATE, REWARD_RATE, createInitialGame, isValidGame, createCityMission,
  cityMissionName, isUnlocked, beginUnlock, advanceWorld, renameCompany,
  migrateLegacyGame, normalizeImport,
} from '../src/gameEngine.js'
import { parseSaveJson, makePlainSnapshot } from '../src/storage.js'
const DAY = UNLOCK_DURATION_MS

test('fresh v0.01 contains only 10 city tasks and 4 independent studies; no old railway', () => {
  const g = createInitialGame(1_000)
  assert.equal(SAVE_SCHEMA, 2)
  assert.equal(GAME_VERSION, '0.01')
  assert.equal(g.cityMissions.length, 10)
  assert.equal(BASIC_UNLOCKS.length, 4)
  assert.deepEqual(g.progress.unlocked, [])
  assert.equal(g.identity.company, null)
  assert.equal(g.economy.balance, null)
  for (const key of ['routes', 'vehicles', 'activeRuns', 'runHistory']) assert.equal(key in g, false)
  assert.ok(isValidGame(g))
})

test('first ten city tasks have ten distinctive topic names', () => {
  const g = createInitialGame(1_000)
  assert.equal(CITY_TASKS.length, 10)
  assert.equal(new Set(g.cityMissions.map(m => m.taskId)).size, 10)
  assert.ok(g.cityMissions.every(m => cityMissionName(m).includes(' · ')))
  assert.deepEqual(createCityMission(0, 0, 1_000, 1_000), g.cityMissions[0])
})

test('all four unlock tasks can start simultaneously in any order', () => {
  let g = createInitialGame(1_000)
  for (const item of [...BASIC_UNLOCKS].reverse()) g = beginUnlock(g, item.id, 2_000)
  assert.equal(Object.keys(g.progress.startedAt).length, 4)
  assert.throws(() => beginUnlock(g, 'company', 3_000))
  assert.throws(() => beginUnlock(g, 'bogus', 3_000))
  assert.ok(isValidGame(g))
})

test('24-hour research is real time and auto-completes across offline gaps', () => {
  let g = beginUnlock(createInitialGame(1_000), 'assistant', 4_000)
  g = advanceWorld(g, 4_000 + DAY - 1).game
  assert.equal(isUnlocked(g, 'assistant'), false)
  const result = advanceWorld(g, 4_000 + DAY)
  assert.deepEqual(result.newlyUnlocked, ['assistant'])
  assert.equal(isUnlocked(result.game, 'assistant'), true)
  assert.equal(isUnlocked(result.game, 'company'), false)
  assert.equal(advanceWorld(result.game, 4_000 + DAY).changed, false)
})

test('city rotation is stable after a month offline with exactly 10 running', () => {
  const g = createInitialGame(1_000)
  const next = advanceWorld(g, 1_000 + DAY * 30)
  assert.ok(next.completed > 10)
  assert.equal(next.game.cityMissions.length, MISSION_COUNT)
  assert.ok(next.game.cityMissions.every(m => m.startedAt <= 1_000 + DAY * 30 && m.endsAt > 1_000 + DAY * 30))
  assert.equal(next.game.economy.balance, null)
  assert.equal(advanceWorld(next.game, 1_000 + DAY * 30).completed, 0)
  assert.ok(isValidGame(next.game))
})

test('funds unlock begins at zero and never pays for a completion on or before the unlock time', () => {
  let g = beginUnlock(createInitialGame(1_000), 'funds', 1_000)
  const first = advanceWorld(g, 1_000 + DAY)
  assert.equal(first.game.economy.balance, 0)
  assert.equal(first.paid, 0)
  const later = advanceWorld(first.game, 1_000 + DAY * 2)
  assert.ok(later.paid > 0)
  assert.equal(later.game.economy.balance, later.paid)
  assert.equal(later.game.economy.ledger.gross - later.game.economy.ledger.expenses, later.paid)
  assert.equal(REWARD_RATE, 100)
  assert.equal(ACCEPT_RATE, 50)
  assert.ok(later.game.economy.ledger.completed > 0)
})

test('offline simultaneous funds research settles eligible completions exactly once', () => {
  let g = beginUnlock(createInitialGame(1_000), 'funds', 1_000)
  const result = advanceWorld(g, 1_000 + DAY * 3)
  assert.ok(result.paid > 0)
  const second = advanceWorld(result.game, 1_000 + DAY * 3)
  assert.equal(second.paid, 0)
  assert.equal(second.changed, false)
  assert.equal(second.game.economy.balance, result.paid)
})

test('company unlock creates a company but does not grant time/funds/assistant', () => {
  let g = beginUnlock(createInitialGame(1_000), 'company', 1_000)
  g = advanceWorld(g, 1_000 + DAY).game
  assert.equal(g.identity.company.name, '나의 회사')
  assert.equal(g.economy.balance, null)
  assert.equal(isUnlocked(g, 'assistant'), false)
  assert.equal(isUnlocked(g, 'time'), false)
  assert.equal(isUnlocked(g, 'funds'), false)
  g = renameCompany(g, 'MYON 교통', 1_000 + DAY)
  assert.equal(g.identity.company.name, 'MYON 교통')
  assert.throws(() => renameCompany(g, '', 1_000 + DAY))
})

test('company cannot be renamed before its research finishes', () => {
  const g = createInitialGame(1_000)
  assert.throws(() => renameCompany(g, '철도', 10_000))
})

test('v0.01 JSON round-trips all new state including ongoing studies', () => {
  let g = createInitialGame(1_000)
  g = beginUnlock(g, 'company', 2_000)
  const roundTrip = parseSaveJson(JSON.stringify(makePlainSnapshot(g)), 2_000)
  assert.deepEqual(roundTrip, g)
  assert.notEqual(roundTrip, g)
  assert.throws(() => parseSaveJson('{malformed'))
  assert.throws(() => parseSaveJson(JSON.stringify({ schemaVersion: 44 })))
})

test('previous railway v0.01 saves import into archive without showing obsolete vehicles', () => {
  const legacy = {
    schemaVersion: 1, gameVersion: '0.01', createdAt: 1_000, updatedAt: 5_000,
    identity: { company: { name: '내 회사', foundedAt: 1_000 } },
    economy: { mode: 'myon', balance: 78900 },
    progress: { completedRuns: 3, research: ['company', 'funds', 'time-sense', 'route-design'], fixedDispatchUnlocked: false, unlockStartedAt: {} },
    routes: [{ id: 'route-001', name: '서울 부산', stations: ['서울','부산'], runs: 3 }],
    vehicles: [{ id: 'L-001', name: '기관차', type: 'locomotive', station: '서울', attachedTo: null }],
    activeRuns: [], runHistory: [], extensions: { aviation: {} },
  }
  const imported = parseSaveJson(JSON.stringify(legacy), DAY * 5)
  assert.ok(isValidGame(imported))
  assert.equal(imported.identity.company.name, '내 회사')
  assert.equal(imported.economy.balance, 78900)
  assert.ok(isUnlocked(imported, 'time'))
  assert.equal(imported.legacyArchive.routes.length, 1)
  assert.equal(imported.routes, undefined)
  assert.equal(imported.vehicles, undefined)
  assert.deepEqual(normalizeImport(imported), imported)
})

test('clean initial state does not auto-migrate old data or give free company', () => {
  const fresh = createInitialGame(8_000)
  assert.equal(isUnlocked(fresh, 'company'), false)
  assert.equal(fresh.legacyArchive, null)
  assert.equal(fresh.progress.startedAt.company, undefined)
})

test('invalid financial snapshots are rejected', () => {
  const g = createInitialGame(1_000)
  g.economy.balance = 1_000
  assert.equal(isValidGame(g), false)
})
