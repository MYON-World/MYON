'use strict';
// Fail the full GitHub test workflow when a new commit has an unchanged version.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const parse=v=>{
 assert.match(v,/^\d+\.\d+\.\d+$/,'Invalid semantic version');
 return v.split('.').map(Number);
};
test('every GitHub commit increases the MYON version compared with its parent',()=>{
 const previous=JSON.parse(execFileSync('git',['show','HEAD^:package.json'],{cwd:root,encoding:'utf8'}));
 const current=read('package.json');
 const [pm,pn,pp]=parse(previous.version),[cm,cn,cp]=parse(current.version);
 assert.ok(cm>pm||(cm===pm&&(cn>pn||(cn===pn&&cp>pp))),
  'New commit must bump the version: '+previous.version+' -> '+current.version);
 const lock=read('package-lock.json');
 assert.equal(lock.version,current.version);
 assert.equal(lock.packages[''].version,current.version);
 assert.equal(read('public/myon-world-baseline.json').release,current.version);
 const html=fs.readFileSync(path.join(root,'public/myon-next.html'),'utf8');
 assert.ok(html.includes("'preview-"+current.version+"'"),
  'DEV preview fallback must equal package version');
 assert.ok(read('public/myon-version-notes.json')[current.version],
  'Version-specific update notes are required');
});
