import test from 'node:test'
import assert from 'node:assert/strict'
import { createInitialGame, isValidGame, startRun, settleRuns, completeResearch, addRoute, deleteRoute,
  BASIC_UNLOCKS, UNLOCK_DURATION_MS, beginUnlock, advanceWorld, migrateGame } from '../src/gameEngine.js'
import { parseSaveJson, makePlainSnapshot } from '../src/storage.js'

test('new game has no company, money, or visible time dependency', () => {
  const s = createInitialGame(1_000)
  assert.equal(s.identity.company, null)
  assert.equal(s.economy.balance, null)
  assert.equal(s.progress.completedRuns, 0)
  assert.equal(s.runHistory.length, 0)
  assert.ok(isValidGame(s))
})

test('hidden run completes after offline elapsed and moves attached coaches', () => {
  const s = createInitialGame(1_000)
  const active = startRun(s, { routeId: 'route-001', locoId: 'L-001', to: '부산' }, 1_000, () => 0)
  assert.ok(isValidGame(active))
  assert.equal(active.activeRuns.length, 1)
  assert.equal(settleRuns(active, 10_000).finished.length, 0)
  const { game: done, finished } = settleRuns(active, 100_000)
  assert.equal(finished.length, 1)
  assert.deepEqual(done.vehicles.map(v => v.station), ['부산', '부산', '부산'])
  assert.equal(done.progress.completedRuns, 1)
  assert.equal(done.runHistory.length, 0)
  assert.equal(done.routes[0].runs, 1)
  assert.ok(isValidGame(done))
  assert.equal(settleRuns(done, 200_000).finished.length, 0)
})

test('a locomotive cannot be dispatched twice, locations must match', () => {
  const s = createInitialGame(1_000)
  assert.throws(() => startRun(s, { routeId: 'route-001', locoId: 'L-001', to: '서울' }, 1_000))
  const busy = startRun(s, { routeId: 'route-001', locoId: 'L-001', to: '대전' }, 1_000, () => 0)
  assert.throws(() => startRun(busy, { routeId: 'route-001', locoId: 'L-001', to: '부산' }, 2_000))
})

test('research unlocks editable personal routes and later time readout', () => {
  let s = createInitialGame(1_000)
  assert.throws(() => completeResearch(s, 'route-design', 1_000))
  s = beginUnlock(s, 'company', 1_000)
  s = advanceWorld(s, 1_000 + UNLOCK_DURATION_MS).game
  s.progress.completedRuns = 3
  s = completeResearch(s, 'route-design', 2_000 + UNLOCK_DURATION_MS)
  s = addRoute(s, '호남 시험', '서울, 익산, 목포', 4_000 + UNLOCK_DURATION_MS)
  assert.equal(s.routes.length, 2)
  assert.ok(isValidGame(s))
  s = deleteRoute(s, s.routes[1].id, 5_000 + UNLOCK_DURATION_MS)
  assert.equal(s.routes.length, 1)
})

test('entire state roundtrips in one save.json and rejects invalid backups', () => {
  const original = createInitialGame(1_000)
  const parsed = parseSaveJson(JSON.stringify(makePlainSnapshot(original)))
  assert.deepEqual(parsed, original)
  assert.notEqual(parsed, original)
  assert.throws(() => parseSaveJson('{bad json'))
  assert.throws(() => parseSaveJson(JSON.stringify({ schemaVersion: 1 })))
})


test('four independent 24-hour researches begin without initial capital', () => {
  let g = createInitialGame(1_000)
  assert.equal(BASIC_UNLOCKS.length, 4)
  assert.equal(g.cityMissions.length, 10)
  assert.equal(g.progress.research.length, 0)
  g = beginUnlock(g, 'time', 2_000)
  g = beginUnlock(g, 'assistant', 3_000)
  assert.throws(() => beginUnlock(g, 'assistant', 4_000))
  const tooSoon = advanceWorld(g, 2_000 + UNLOCK_DURATION_MS - 1).game
  assert.equal(tooSoon.progress.research.includes('time'), false)
  assert.equal(tooSoon.progress.research.includes('assistant'), false)
  const timeComplete = advanceWorld(tooSoon, 2_000 + UNLOCK_DURATION_MS).game
  assert.equal(timeComplete.progress.research.includes('time'), true)
  assert.equal(timeComplete.progress.research.includes('assistant'), false)
  assert.ok(isValidGame(timeComplete))
})

test('city tasks keep ten active slots, rotate offline without storing history', () => {
  const g = createInitialGame(1_000)
  const next = advanceWorld(g, 1_000 + 7 * UNLOCK_DURATION_MS)
  assert.equal(next.game.cityMissions.length, 10)
  assert.ok(next.cityCompleted > 10)
  assert.equal(next.game.cityMissions.every(t => t.endsAt > 1_000 + 7 * UNLOCK_DURATION_MS), true)
  assert.equal(next.game.runHistory.length, 0)
  assert.equal(next.game.economy.balance, null)
  assert.equal(advanceWorld(next.game, 1_000 + 7 * UNLOCK_DURATION_MS).changed, false)
})

test('funds start at 0 M after research, only later city completions pay 100-50 M per second', () => {
  let g = createInitialGame(1_000)
  g = beginUnlock(g, 'funds', 1_000)
  const cutoff = 1_000 + UNLOCK_DURATION_MS
  const unlocked = advanceWorld(g, cutoff)
  assert.ok(unlocked.game.progress.research.includes('funds'))
  assert.equal(unlocked.game.economy.balance, 0)
  assert.equal(unlocked.cityEarned, 0)
  const advanced = advanceWorld(unlocked.game, cutoff + UNLOCK_DURATION_MS)
  assert.ok(advanced.cityEarned > 0)
  assert.equal(advanced.game.economy.balance, advanced.cityEarned)
  assert.equal(advanceWorld(advanced.game, cutoff + UNLOCK_DURATION_MS).cityEarned, 0)
  assert.ok(isValidGame(advanced.game))
})

test('funds research completed while offline settles missions by exact unlock time', () => {
  let g = createInitialGame(1_000)
  g = beginUnlock(g, 'funds', 1_000)
  const end = 1_000 + UNLOCK_DURATION_MS * 3
  const result = advanceWorld(g, end)
  assert.ok(result.game.progress.research.includes('funds'))
  assert.ok(result.cityEarned > 0)
  // Money only from completions AFTER the research elapsed, not all three days.
  assert.ok(result.cityEarned < 10 * 50 * 3 * UNLOCK_DURATION_MS / 1000)
  assert.equal(result.game.economy.balance, result.cityEarned)
})

test('existing v0.01 saves migrate with routes, vehicles and previous time unlock preserved', () => {
  const original = createInitialGame(1_000)
  original.progress.research.push('time-sense', 'route-design')
  original.progress.completedRuns = 7
  delete original.cityMissions
  delete original.progress.unlockStartedAt
  assert.ok(isValidGame(original))
  const upgraded = migrateGame(original, 123_000)
  assert.equal(upgraded.cityMissions.length, 10)
  assert.ok(upgraded.progress.research.includes('time'))
  assert.ok(upgraded.progress.research.includes('company'))
  assert.ok(upgraded.identity.company)
  assert.ok(upgraded.progress.research.includes('route-design'))
  assert.equal(upgraded.progress.completedRuns, 7)
  assert.deepEqual(upgraded.vehicles, original.vehicles)
  assert.ok(isValidGame(upgraded))
  assert.equal(original.cityMissions, undefined)
})

test('an untouched legacy save is not given a free company; existing active railways are preserved', () => {
  const untouched = createInitialGame(1_000)
  delete untouched.cityMissions
  delete untouched.progress.unlockStartedAt
  const fresh = migrateGame(untouched, 2_000)
  assert.equal(fresh.progress.research.includes('company'), false)
  assert.equal(fresh.identity.company, null)

  const active = startRun(untouched, { routeId: 'route-001', locoId: 'L-001', to: '대전' }, 1_000, () => 0)
  const migrated = migrateGame(active, 2_000)
  assert.equal(migrated.progress.research.includes('company'), true)
  assert.equal(migrated.activeRuns.length, 1)
  assert.equal(migrated.vehicles.length, active.vehicles.length)
  assert.ok(isValidGame(migrated))
})

test('city mission finance awards only net payout exactly once across save-json round trip', () => {
  let g = createInitialGame(1_000)
  g = beginUnlock(g, 'funds', 1_000)
  g = advanceWorld(g, 1_000 + UNLOCK_DURATION_MS).game
  assert.equal(g.economy.balance, 0)
  const firstMission = g.cityMissions[0]
  const end = firstMission.endsAt
  const later = advanceWorld(g, end)
  // The other slots may complete as well. Every eligible mission has 50 M/s net.
  assert.equal(later.game.economy.balance, later.cityEarned)
  assert.equal(advanceWorld(later.game, end).cityEarned, 0)
  const backup = parseSaveJson(JSON.stringify(makePlainSnapshot(later.game)))
  assert.equal(backup.economy.balance, later.game.economy.balance)
  assert.equal(backup.cityMissions.length, 10)
})
