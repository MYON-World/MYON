'use strict';
// Fail the full GitHub test workflow when a new commit has an unchanged version.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const parse=v=>{
 assert.match(v,/^\d+\.\d+\.\d+(?:\.\d+)?$/,'Invalid MYON version');
 return v.split('.').map(Number);
};
const displayedVersion=pkg=>pkg.myonVersion||pkg.version;
test('every GitHub commit increases the MYON version compared with its parent',()=>{
 const previous=JSON.parse(execFileSync('git',['show','HEAD^:package.json'],{cwd:root,encoding:'utf8'}));
 const current=read('package.json');
 const prev=parse(displayedVersion(previous)),now=parse(displayedVersion(current));
 const compare=(a,b)=>{
  for(let i=0;i<4;i++){
   if((a[i]||0)>(b[i]||0))return 1;
   if((a[i]||0)<(b[i]||0))return -1;
  }
  return 0;
 };
 assert.equal(compare(now,prev),1,
  'New commit must bump MYON version: '+displayedVersion(previous)+' -> '+displayedVersion(current));
 if(current.myonVersion){
  assert.equal(now.length,4,'Failure correction must have fourth MYON component');
  assert.equal(current.version,now.slice(0,3).join('.')+'+hotfix.'+now[3],
    'npm version must remain valid SemVer while MYON displays four components');
 }
 const lock=read('package-lock.json');
 assert.equal(lock.version,current.version);
 assert.equal(lock.packages[''].version,current.version);
 assert.equal(read('public/myon-world-baseline.json').release,displayedVersion(current));
 const html=fs.readFileSync(path.join(root,'public/myon-next.html'),'utf8');
 assert.ok(html.includes("'preview-"+displayedVersion(current)+"'"),
  'DEV preview fallback must equal package version');
 assert.ok(read('public/myon-version-notes.json')[displayedVersion(current)],
  'Version-specific update notes are required');
});
