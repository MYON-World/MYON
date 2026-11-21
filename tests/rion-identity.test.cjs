'use strict';
// Registry, legacy field indexes, and explicitly approved UI/wiki ID migration.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const registry=read('data/rions/registry.v1.json'),lock=read('data/rions/id-lock.v1.json');
const baseline=read('public/myon-world-baseline.json');
const codes=['AGR','LFS','RES','MFG','ENE','CON','TRN','LOG','COM','CUL','EDU','MED','ENV','PUB','TEC'];
const canonical=r=>({id:r.id,number:r.number,namespace:r.namespace,legacyFieldIndex:r.legacyFieldIndex??null});
test('159 Rions have unique permanent IDs and namespace-specific numbers',()=>{
 assert.equal(registry.schemaVersion,1);
 assert.equal(registry.status,'v0.13.96_discovery_stage_zero');
 assert.ok(registry.records.length>=159);
 assert.equal(lock.schemaVersion,1);
 const ids=new Set(),numbers=new Set();
 for(const r of registry.records){
  assert.match(r.id,/^rion\.(?:role|style|field|material)\.[a-z0-9.-]+$/);
  assert.match(r.number,/^[A-Z]{3}-\d{6}$/);
  assert.ok(Number.isSafeInteger(r.serial)&&r.serial>=1&&r.serial<=999999);
  assert.equal(r.number,r.namespace+'-'+String(r.serial).padStart(6,'0'));
  assert.ok(!ids.has(r.id),'Duplicate Rion ID: '+r.id);ids.add(r.id);
  assert.ok(!numbers.has(r.number),'Duplicate Rion number: '+r.number);numbers.add(r.number);
 }
 assert.deepEqual(lock.records,registry.records.map(canonical));
 assert.deepEqual(registry.records.slice(0,4).map(r=>r.id),['rion.role.ui','rion.role.development','rion.role.wiki','rion.role.narrative']);
 assert.deepEqual(registry.records.slice(4,9).map(r=>r.id),['rion.style.observation','rion.style.management','rion.style.creation','rion.style.exploration','rion.style.story']);
 assert.deepEqual(registry.records.slice(0,9).map(r=>r.number),['UIR-000001','DEV-000001','WIK-000001','NAR-000001','OBS-000001','MGT-000001','CRE-000001','EXP-000001','STY-000001']);
});
test('original 150 field Rions retain the precise 15 x 10 legacy mapping',()=>{
 assert.ok(baseline.domains.length>=15);
 for(let d=0;d<15;d++){
  const domain=baseline.domains[d];
  assert.equal(domain.id,'mission-'+String(d+1).padStart(2,'0'));
  assert.ok(domain.scope.length>=10);
  for(let n=0;n<10;n++){
   const i=d*10+n,r=registry.records[9+i];
   assert.ok(r,'Missing Rion for original field '+i);
   assert.equal(r.id,'rion.field.'+domain.id+'.'+String(n+1).padStart(2,'0'));
   assert.equal(r.namespace,codes[d]);
   assert.equal(r.number,codes[d]+'-'+String(n+1).padStart(6,'0'));
   assert.equal(r.kind,'field');assert.equal(r.domainId,domain.id);
   assert.equal(r.fieldName,domain.scope[n]);
   assert.equal(r.legacyFieldIndex,i);assert.equal(r.sourceOrdinal,n+1);
  }
 }
});
test('previous ID-number allocations cannot be removed or changed',()=>{
 let old;
 try{old=JSON.parse(execFileSync('git',['show','HEAD^:data/rions/id-lock.v1.json'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}));}
 catch{return;} // First registration commit has no previous identity lock.
 assert.ok(lock.records.length>=old.records.length,'Identity registry must be append-only');
 const aliases=read('data/rions/id-aliases.v1.json').aliases;
 const authorized=new Map(aliases.map(a=>[a.oldId,a]));
 for(let i=0;i<old.records.length;i++){
  const before=old.records[i],after=lock.records[i];
  const alias=authorized.get(before.id);
  if(alias){
   assert.deepEqual(after,{...before,id:alias.newId,number:alias.newNumber,namespace:alias.newNumber.split('-')[0]});
   assert.equal(before.number,alias.oldNumber);
  }else assert.deepEqual(after,before,'Existing identities cannot change: '+before.id);
 }
 assert.equal(aliases.length,2,'Only UI and wiki IDs have authorized migrations');
 const currentIDs=new Set(lock.records.map(r=>r.id)),currentNumbers=new Set(lock.records.map(r=>r.number));
 for(const a of aliases){assert.ok(currentIDs.has(a.newId));assert.ok(currentNumbers.has(a.newNumber));assert.ok(!currentIDs.has(a.oldId));assert.ok(!currentNumbers.has(a.oldNumber));}
});

test('published runtime Rion identity list matches the canonical GitHub registry',()=>{
 const published=read('public/myon-rion-registry.json');
 assert.equal(published.schema,1);
 assert.deepEqual(published.records,registry.records.map(r=>({
  id:r.id,kind:r.kind,name:r.name,
  ...(r.kind==='field'?{fieldName:r.fieldName,legacyFieldIndex:r.legacyFieldIndex}:{})
 })));
});
