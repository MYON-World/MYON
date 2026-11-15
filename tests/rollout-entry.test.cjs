'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const core=()=>import('../src/core/myon-release-state.mjs');
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),D='d'.repeat(40);
const releases=[
 {revision:A,version:'0.13.51'},
 {revision:B,version:'0.13.52'},
 {revision:C,version:'0.13.53'},
 {revision:D,version:'0.13.54'}
];
const now=1760000000000;
test('new player can start at current release, existing unknown player cannot skip history',async()=>{
 const {initialState}=await core();
 assert.equal(initialState(releases,{existing:false}).installed,D);
 assert.equal(initialState(releases,{existing:true}).installed,A);
 assert.equal(initialState(releases,{existing:true,bus:true}).installed,B);
 assert.equal(initialState(releases,{existing:true,bus:true,passes:true}).installed,D);
});
test('legacy player on 0.13.51 with latest target cannot jump over 0.13.52',async()=>{
 const {migrateLegacy}=await core();
 const state=migrateLegacy({schema:1,from:A,target:D,startedAt:now-60*60000},releases,now);
 assert.equal(state.installed,A);
 assert.equal(state.target,B);
 assert.equal(state.phase,'rollout');
 assert.equal(state.startedAt,now,'Wrong legacy target cannot reuse an unrelated countdown');
});
test('legitimate legacy next-commit countdown retains its timestamp',async()=>{
 const {migrateLegacy}=await core();
 const state=migrateLegacy({schema:1,from:B,target:C,startedAt:now-34*60000},releases,now);
 assert.equal(state.installed,B);
 assert.equal(state.target,C);
 assert.equal(state.startedAt,now-34*60000);
});
test('legacy clients that stored version markers resolve to a matching oldest release',async()=>{
 const {migrateLegacy}=await core();
 const state=migrateLegacy({schema:1,from:'version:0.13.52',target:D,startedAt:now-1000},releases,now);
 assert.equal(state.installed,B);
 assert.equal(state.target,C);
});
test('stale v2 state cannot skip commits and preserves the existing hour',async()=>{
 const {reconcileState}=await core();
 const state=reconcileState({schema:2,installed:A,phase:'rollout',target:D,startedAt:now-12*60000},releases,now);
 assert.equal(state.installed,A);
 assert.equal(state.target,B);
 assert.equal(state.startedAt,now-12*60000);
});
test('cooldown remains a separate hour after installing exactly one commit',async()=>{
 const {reconcileState}=await core();
 const state=reconcileState({schema:2,installed:B,phase:'cooldown',target:'',startedAt:now-20*60000},releases,now);
 assert.equal(state.phase,'cooldown');
 assert.equal(state.startedAt,now-20*60000);
 assert.equal(state.installed,B);
});
test('unknown old pin cannot be rewritten as HEAD',async()=>{
 const {reconcileState}=await core();
 assert.equal(reconcileState({schema:2,installed:'e'.repeat(40),phase:'idle',target:'',startedAt:0},releases,now),null);
});
test('production builder redirects direct root and archived top-level visits to pinned launcher',()=>{
 const src=fs.readFileSync(path.resolve(__dirname,'../scripts/build-rollouts.cjs'),'utf8');
 assert.match(src,/fs\.writeFileSync\(path\.join\(dist,'myon\.html'\),redirect\)/);
 assert.match(src,/new URL\("\.\/\",location\.href\)/);
 assert.match(src,/new URL\("\.\.\/\.\.\/",location\.href\)/);
 assert.match(src,/window\.self===window\.top/);
});
test('official parent displays installed commit version, not HEAD in browser title',()=>{
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 assert.match(app,/document\.title=version\?'MYON v'\+version/);
 assert.match(app,/reconcileState\(saved,releases,now\)/);
});
