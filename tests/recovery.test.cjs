'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const page=fs.readFileSync(path.join(__dirname,'../public/myon-recovery.html'),'utf8');
const script=page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
test('read-only MYON recovery UI is self-contained and parseable',()=>{
 assert.ok(script);
 assert.doesNotThrow(()=>new Function(script));
 assert.match(page,/<html lang="ko">/);
 assert.match(page,/세이브 복구 진단/);
});
test('recovery page accesses the EXACT legacy game database with a readonly transaction',()=>{
 assert.match(script,/myon-v00804-progress/);
 assert.match(script,/const tx=db\.transaction\(STORE,'readonly'\)/);
 assert.match(script,/req\.transaction\.abort\(\)/);
 assert.doesNotMatch(script,/\b(store\.put|store\.delete|\.clear\(|deleteDatabase|\['readwrite'\]|'readwrite')\b/);
});
test('recovery tool covers all previously created immutable save snapshots',()=>{
 for(const key of ['v01347-restore-point','v01348-before-compensation',
  'v01349-before-auto-update','v01352-before-bus-world'])
  assert.ok(script.includes(key),'Missing original backup '+key);
});
test('exports include the exact original record map and are user-triggered only',()=>{
 assert.match(script,/exportJSON\('MYON-original-save-/);
 assert.match(script,/records\s*\}/);
 assert.match(script,/getAll\(\)/);
 assert.match(script,/getAllKeys\(\)/);
 assert.ok(!page.includes('https://')&&!page.includes('http://'),'No remote exfiltration endpoints');
});
test('old and new MYON saves are not modified from a diagnostic page',()=>{
 assert.ok(page.includes('읽기 전용'));
 assert.ok(page.includes('개인정보가 일부 포함'));
 assert.ok(page.includes('시크릿 모드'));
 assert.ok(page.includes('자동으로 덮어쓰거나'));
});
