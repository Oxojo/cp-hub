import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, recordAttempt, recordReview, progress, dateKey } from '../server/domain.mjs';
const now = new Date('2026-11-08T14:59:00Z');
const input = {url:'https://atcoder.jp/contests/test/tasks/test_a?utm_source=x', result:'LEARNED', observation:'核心', key:'one'};
test('Learned requires observation; invalid records are not added', () => {
  const s=emptyState(); assert.throws(()=>recordAttempt(s,{...input,observation:' '},now)); assert.equal(s.attempts.length,0);
});
test('canonical duplicate, idempotency, no downgrade, skip excluded', () => {
  const s=emptyState(); recordAttempt(s,input,now); recordAttempt(s,input,now);
  assert.equal(s.attempts.length,1); assert.equal(s.reviews.length,1); assert.equal(s.reviews[0].dueDate,'2026-11-09');
  recordAttempt(s,{...input,key:'two',result:'SOLVED'},now);
  recordAttempt(s,{...input,key:'three',result:'UNKNOWN'},now);
  recordAttempt(s,{url:'https://qoj.ac/problem/1',result:'SKIPPED',key:'four'},now);
  assert.equal(s.problems.length,2); assert.equal(s.problems[0].state,'NEW'); assert.equal(s.problems[1].state,'SOLVED'); assert.equal(progress(s,now).touched,1);
});
test('review 1/7/21, forgot resets, reviews not touched', () => {
  const s=emptyState(); recordAttempt(s,input,now); const r=s.reviews[0];
  recordReview(s,r.id,'remembered','r1',new Date('2026-11-09T03:00:00Z')); assert.equal(r.dueDate,'2026-11-16');
  recordReview(s,r.id,'remembered','r1',now); assert.equal(r.stage,1);
  recordReview(s,r.id,'remembered','r2',new Date('2026-11-16T03:00:00Z')); assert.equal(r.dueDate,'2026-12-07');
  recordReview(s,r.id,'forgot','r3',new Date('2026-12-07T03:00:00Z')); assert.equal(r.dueDate,'2026-12-08'); assert.equal(r.stage,0);
  assert.equal(progress(s,new Date('2026-12-07T03:00:00Z')).touched,0);
});
test('JST midnight and Unknown schedule', () => {
  assert.equal(dateKey(new Date('2026-11-08T15:00:00Z')),'2026-11-09');
  const s=emptyState(); recordAttempt(s,{...input,result:'UNKNOWN'},now); assert.equal(s.reviews[0].dueDate,'2026-11-11');
});
