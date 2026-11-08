import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createStore } from '../server/store.mjs';
import { createClistSync, normalizeContest } from '../server/clist.mjs';
import { verifyDiscord, discordInteraction } from '../server/discord.mjs';
import { runJobs } from '../server/jobs.mjs';
import { emptyState } from '../server/domain.mjs';
const raw = {id:1,event:'Round',href:'https://atcoder.jp/contests/test',start:'2026-11-08T12:00:00',duration:7200,resource:{host:'atcoder.jp'}};
async function fixture(t) {
  await mkdir('data', {recursive:true});
  const directory=await mkdtemp(join(process.cwd(),'data','cp-hub-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  return createStore({DATA_FILE:join(directory,'state.json')});
}
test('file transactions serialize, survive restart, roll back', async t=> {
  const store=await fixture(t);await Promise.all(Array.from({length:20},()=>store.transaction(d=>{d.state.settings.dailyTarget++;})));
  assert.equal(await store.transaction(d=>d.state.settings.dailyTarget),35);
  await assert.rejects(store.transaction(d=>{d.state.settings.dailyTarget=0;throw new Error('rollback');}));
  assert.equal(await store.transaction(d=>d.state.settings.dailyTarget),35);
});
test('CLIST normalization, retry, pagination, upsert and preserve planned',async t=>{
  const store=await fixture(t);let calls=0;
  const fetcher=async()=>{calls++;return calls===1?new Response('',{status:429,headers:{'retry-after':'1'}}):Response.json({objects:[raw],meta:{next:null}});};
  const sync=createClistSync(store,{CLIST_USERNAME:'test',CLIST_API_KEY:'not-real'},fetcher,async()=>{});
  await sync();await store.transaction(d=>{d.state.contests[0].status='PLANNED';});await sync();
  const contests=await store.transaction(d=>d.state.contests);assert.equal(contests.length,1);assert.equal(contests[0].status,'PLANNED');assert.equal(contests[0].time,'21:00');
  assert.equal(normalizeContest(raw).startAt,'2026-11-08T12:00:00.000Z');
  await assert.rejects(createClistSync(store,{CLIST_USERNAME:'t',CLIST_API_KEY:'t'},async()=>new Response('',{status:500}),async()=>{})());
  assert.equal((await store.transaction(d=>d.state.contests)).length,1);
});
test('Discord verifies real Ed25519 signatures and rejects stale/tampered',()=>{
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');const key=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
  const timestamp=String(Math.floor(Date.now()/1000)),body=Buffer.from('{"type":1}');const signature=sign(null,Buffer.concat([Buffer.from(timestamp),body]),privateKey).toString('hex');
  assert.equal(verifyDiscord(body,signature,timestamp,key),true);assert.equal(verifyDiscord(Buffer.from('{}'),signature,timestamp,key),false);assert.equal(verifyDiscord(body,signature,timestamp,key,Date.now()+600000),false);
});
test('Discord owner check, modal validation and feed nonce dedupe',()=>{
  const doc={state:emptyState(),internal:{interactions:{},sessions:{},deliveries:{}}},env={DISCORD_OWNER_ID:'owner',DISCORD_GUILD_ID:'guild'};
  doc.state.problems.push({id:'p',title:'Test',url:raw.href,state:'NEW',topics:[]});
  const command={id:'1',type:2,guild_id:'guild',member:{user:{id:'owner'}},data:{name:'problems'}};
  assert.match(discordInteraction(doc,{...command,member:{user:{id:'other'}}},env).data.content,/専用/);
  const feed=discordInteraction(doc,command,env);const custom=feed.data.components[0].components[0].custom_id;
  const click={...command,id:'2',type:3,data:{custom_id:custom}};discordInteraction(doc,click,env);discordInteraction(doc,click,env);
  assert.equal(doc.state.attempts.length,1);assert.equal(doc.state.problems[0].state,'SOLVED');
});
test('daily notification is sent once across ticks',async t=>{
  const store=await fixture(t);let sent=0; const env={DISCORD_BOT_TOKEN:'test',DISCORD_CHANNEL_ID:'1'};
  const fetcher=async()=>{sent++;return Response.json({id:'message'});};const now=new Date('2026-11-08T01:00:00Z');
  await runJobs(store,async()=>{},env,fetcher,now);await runJobs(store,async()=>{},env,fetcher,now);assert.equal(sent,1);
});
