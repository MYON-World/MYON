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
const releases=[];
for(const sha of revisions){
 if(!/^[a-f0-9]{40}$/.test(sha))throw Error('Malformed revision');
 const pkg=JSON.parse(cmd('show',sha+':package.json'));
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
 // Coordinator is infrastructure, not game logic: even old games use latest safe FIFO protocol.
 fs.writeFileSync(path.join(out,'myon-auto-update.js'),latestUpdater);
 releases.push({revision:sha,version:pkg.version});
}
fs.writeFileSync(path.join(dist,'myon-rollouts.json'),JSON.stringify({schema:1,releases})+'\n');
process.stdout.write('Archived '+releases.length+' immutable MYON releases\n');
