'use strict';
// Immutable releases: every first-parent commit since v0.13.51 remains playable.
// No Pages deployment may overwrite an older release directory with newer game code.
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist');
const anchor='5fa8f6e36f4b1da0d66f933508d88b477193f5d5';
const cmd=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:10*1024*1024,encoding:'utf8'}).trim();
const revisions=cmd('rev-list','--first-parent','--reverse',anchor+'^..HEAD').split(/\s+/).filter(Boolean);
if(!revisions.length||revisions[0]!==anchor)throw Error('Immutable release history anchor missing');
const latestUpdater=fs.readFileSync(path.join(root,'public/myon-auto-update.js'));
const versionNotes=JSON.parse(fs.readFileSync(path.join(root,'public/myon-version-notes.json'),'utf8'));

const releases=[];
for(const sha of revisions){
 if(!/^[a-f0-9]{40}$/.test(sha))throw Error('Malformed revision');
 const pkg=JSON.parse(cmd('show',sha+':package.json'));
 // npm package versions must follow SemVer, but MYON may display a four-part
 // correction revision, mapped from package.myonVersion.
 const releaseVersion=pkg.myonVersion||pkg.version;
 if(!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(releaseVersion))
  throw Error('Invalid MYON release version: '+releaseVersion);
 const out=path.join(dist,'releases',sha);
 fs.mkdirSync(out,{recursive:true});
 const files=cmd('ls-tree','-r','--name-only',sha,'--','public/').split('\n');
 for(const name of files){
  if(!name.startsWith('public/')||name.includes('..')||/\/(?:test|dev)\//.test(name))continue;
  const target=path.join(out,name.slice('public/'.length));
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const data=execFileSync('git',['show',sha+':'+name],{cwd:root,maxBuffer:10*1024*1024});
  fs.writeFileSync(target,data);
 }
 if(!fs.existsSync(path.join(out,'myon.html')))throw Error('Missing archived MYON game: '+sha);
 // Opening an archived HTML file as the top-level page must not bypass the
 // canonical parent. Inside the official iframe it runs unchanged.
 const archivePath=path.join(out,'myon.html');
 const archiveHtml=fs.readFileSync(archivePath,'utf8');
 const guard='<script>if(window.self===window.top){var u=new URL("../../",location.href);u.search=location.search;u.hash=location.hash;location.replace(u.href);}</script>';
 if(!archiveHtml.includes('<head>'))throw Error('Archived game lacks head element: '+sha);
 fs.writeFileSync(archivePath,archiveHtml.replace('<head>','<head>'+guard));
 // Coordinator is infrastructure, not game logic: even old games use latest safe FIFO protocol.
 fs.writeFileSync(path.join(out,'myon-auto-update.js'),latestUpdater);
 const subject=cmd('show','-s','--format=%s',sha);
 const note=versionNotes[releaseVersion];
 releases.push({revision:sha,version:releaseVersion,
  title:note?.title||subject.replace(/^v\d+\.\d+\.\d+(?:\.\d+)?:\s*/,''),
  subject,entries:Array.isArray(note?.entries)?note.entries:[]});
}
fs.writeFileSync(path.join(dist,'myon-rollouts.json'),JSON.stringify({schema:1,releases})+'\n');
// Generate official approvals directly from frozen server pins, not from the latest DEV revision.
const entry=fs.readFileSync(path.join(root,'src/core/myon-server-entry.mjs'),'utf8');
function approval(key){
 const start=entry.indexOf('export const '+key+'=Object.freeze({');
 if(start<0)throw Error('Missing approved release: '+key);
 const block=entry.slice(start,start+250);
 const revision=block.match(/revision:'([a-f0-9]{40})'/);
 const version=block.match(/version:'(\d+\.\d+\.\d+)'/);
 if(!revision||!version)throw Error('Invalid official approval: '+key);
 return {revision:revision[1],version:version[1]};
}
fs.writeFileSync(path.join(dist,'myon-approved-releases.json'),
 JSON.stringify({schema:1,live:approval('LIVE_RELEASE'),test:approval('TEST_RELEASE')})+'\n');
// The legacy /MYON/myon.html shortcut previously served HEAD immediately,
// bypassing the rollout queue. Publish ONLY a redirect at that URL.
const redirect='<!doctype html><html lang="ko"><head><meta charset="utf-8">'+
 '<meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<title>MYON · 버전 확인</title>'+
 '<script>var u=new URL("./",location.href);u.search=location.search;u.hash=location.hash;location.replace(u.href);</script>'+
 '</head><body><a href="./">MYON 시작 화면으로 이동</a></body></html>';
fs.writeFileSync(path.join(dist,'myon.html'),redirect);

process.stdout.write('Archived '+releases.length+' immutable MYON releases\n');
