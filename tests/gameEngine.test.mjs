import test from 'node:test'
import assert from 'node:assert/strict'
import { createInitialGame, isValidGame, startRun, settleRuns, completeResearch, addRoute, deleteRoute } from '../src/gameEngine.js'
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
  s.progress.completedRuns = 3
  s = completeResearch(s, 'route-design', 2_000)
  s = completeResearch(s, 'time-sense', 3_000)
  s = addRoute(s, '호남 시험', '서울, 익산, 목포', 4_000)
  assert.equal(s.routes.length, 2)
  assert.ok(isValidGame(s))
  s = deleteRoute(s, s.routes[1].id, 5_000)
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
