import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, recordAttempt, progress, canonicalUrl } from '../server/domain.mjs';
import { stockProblems, editProblem, updateQueue, dailyQueue, nextProblem } from '../server/problems.mjs';
import { discordInteraction } from '../server/discord.mjs';
const now=new Date('2026-11-09T03:00:00Z');
const urls=['https://atcoder.jp/contests/abc001/tasks/abc001_1','https://codeforces.com/problemset/problem/2059/C'];

test('stock batch reuses canonical URLs without attempts or reviews',()=>{
  const s=emptyState();const result=stockProblems(s,{urls:urls.join('\n')+'\n'+urls[0]+'?lang=ja&utm_source=x',source:'読書会',topics:['DP','DP'],difficulty:'MID',rating:1600},now);
  assert.equal(result.added,2);assert.equal(result.reused,1);assert.equal(s.attempts.length,0);assert.equal(s.reviews.length,0);assert.equal(progress(s,now).touched,0);
  assert.ok(s.problems.every(p=>p.state==='NEW'&&p.firstTouchedAt===null));assert.deepEqual(s.problems[0].topics,['DP']);
  const again=stockProblems(s,{urls,source:'上書きしない'},now);assert.equal(again.added,0);assert.equal(s.problems[0].source,'読書会');
  assert.equal(canonicalUrl('https://codeforces.com/contest/2059/problem/C'),urls[1]);
});
test('invalid batch and metadata fail before adding problems',()=>{
  const s=emptyState();assert.throws(()=>stockProblems(s,{urls:[urls[0],'javascript:alert(1)']},now),/2件目/);assert.equal(s.problems.length,0);
  assert.throws(()=>stockProblems(s,{urls,rating:-1},now));assert.throws(()=>stockProblems(s,{urls:Array(101).fill(urls[0])},now));
  assert.throws(()=>stockProblems(s,{urls:['https://user:secret@example.com/problem']},now));assert.equal(s.problems.length,0);
});
test('today queue is ordered, duplicate-safe, shared with feed, and day-scoped',()=>{
  const s=emptyState();const {ids}=stockProblems(s,{urls,queueToday:true},now);
  updateQueue(s,{action:'add',problemIds:ids},now);assert.equal(dailyQueue(s,now).length,2);
  assert.equal(nextProblem(s,now).id,ids[0]);updateQueue(s,{action:'up',problemId:ids[1]},now);assert.equal(nextProblem(s,now).id,ids[1]);
  updateQueue(s,{action:'down',problemId:ids[1]},now);assert.equal(nextProblem(s,now).id,ids[0]);
  updateQueue(s,{action:'remove',problemId:ids[0]},now);assert.equal(dailyQueue(s,now).length,1);assert.equal(s.problems.length,2);
  assert.equal(dailyQueue(s,new Date('2026-11-09T15:00:00Z')).length,0);
});
test('attempt outcomes update queue; skip does not count or immediately repeat',()=>{
  const s=emptyState();const {ids}=stockProblems(s,{urls,queueToday:true},now);
  recordAttempt(s,{url:urls[0],result:'ATTEMPTED',key:'thinking'},now);assert.equal(dailyQueue(s,now)[0].status,'THINKING');assert.equal(nextProblem(s,now).id,ids[1]);
  recordAttempt(s,{url:urls[1],result:'SKIPPED',key:'skip'},now);assert.equal(dailyQueue(s,now)[1].status,'SKIPPED');assert.equal(progress(s,now).touched,1);
  assert.equal(nextProblem(s,now).id,ids[0]);recordAttempt(s,{url:urls[0],result:'SOLVED',key:'done'},now);assert.equal(nextProblem(s,now),null);
  assert.equal(s.problems.find(p=>p.id===ids[1]).state,'NEW');
});
test('editing/archive preserves history and prevents archived feed selection',()=>{
  const s=emptyState();const {ids}=stockProblems(s,{urls},now);recordAttempt(s,{url:urls[0],result:'LEARNED',observation:'核心',key:'learn'},now);
  editProblem(s,ids[0],{title:'編集済み',source:'ABC',topics:['Greedy'],archived:true,rating:null});
  const p=s.problems.find(p=>p.id===ids[0]);assert.equal(p.state,'LEARNED');assert.equal(p.observation,'核心');assert.equal(s.attempts.length,1);assert.equal(s.reviews.length,1);
  assert.throws(()=>updateQueue(s,{action:'add',problemIds:[ids[0]]},now),/アーカイブ/);assert.equal(nextProblem(s,now).id,ids[1]);
  editProblem(s,ids[0],{archived:false});updateQueue(s,{action:'add',problemIds:[ids[0]]},now);assert.equal(nextProblem(s,now).id,ids[0]);
});
test('legacy persisted state without queues or stock metadata remains usable',()=>{
  const s=emptyState();delete s.problemQueues;s.problems=[{id:'old',url:urls[0],title:'Old',state:'NEW',topics:[]}];
  assert.equal(stockProblems(s,{urls:[urls[0]]},now).added,0);updateQueue(s,{action:'add',problemIds:['old']},now);assert.equal(dailyQueue(s,now)[0].problemId,'old');
});
test('Discord add/context menu stock links without touching; owner guard and replay',()=>{
  const doc={state:emptyState(),internal:{interactions:{},sessions:{},deliveries:{}}},env={DISCORD_OWNER_ID:'owner',DISCORD_GUILD_ID:'guild'};
  const base={type:2,guild_id:'guild',member:{user:{id:'owner'}}};
  const command={...base,id:'context',data:{type:3,name:'ストックに追加',target_id:'message',resolved:{messages:{message:{content:`あとで解く <${urls[0]}>\n${urls[1]}`}}}}};
  const reply=discordInteraction(doc,command,env);assert.match(reply.data.content,/2 件追加/);discordInteraction(doc,command,env);assert.equal(doc.state.problems.length,2);assert.equal(doc.state.attempts.length,0);
  const other={...command,id:'other',member:{user:{id:'other'}}};assert.match(discordInteraction(doc,other,env).data.content,/専用/);
  discordInteraction(doc,{...base,id:'add',data:{name:'add',options:[{name:'url',value:urls[0]}]}},env);assert.equal(doc.state.attempts.length,0);
});
