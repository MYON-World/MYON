'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const base=path.resolve(__dirname,'../src/core/myon-test-retirement.mjs');
test('sunset metadata requires exactly seven days from the commit',async()=>{
 const {validSunset}=await import(base);
 const ts=1795000000000;
 assert.equal(validSunset({schema:1,startedAt:ts,endsAt:ts+604800000}),true);
 assert.equal(validSunset({schema:1,startedAt:ts,endsAt:ts+604799999}),false);
});
test('a completed TEST visit remains blocked after page reload',async()=>{
 const {readTestRetirement,TEST_RETIREMENT_KEY}=await import(base);
 const saved={schema:1,phase:'complete',claimedAt:1795000000000,missionCash:30,fundsUnits:10000};
 const storage={getItem:k=>k===TEST_RETIREMENT_KEY?JSON.stringify(saved):null};
 assert.deepEqual(readTestRetirement(storage),saved);
});
test('a corrupt visit record blocks reuse rather than resetting',async()=>{
 const {readTestRetirement,TEST_RETIREMENT_KEY}=await import(base);
 const storage={getItem:k=>k===TEST_RETIREMENT_KEY?'not json':null};
 assert.throws(()=>readTestRetirement(storage),/접속을 차단/);
});
test('an expired TEST server cannot start another transfer',async()=>{
 const {retireTestOnce}=await import(base);
 const locks={request:(_key,_opts,fn)=>fn()};
 const storage={getItem:()=>null};
 await assert.rejects(retireTestOnce({locks,storage,deadline:1795000000000,now:1795000000001}),/기한이 종료/);
});
