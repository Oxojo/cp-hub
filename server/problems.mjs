import { randomUUID } from 'node:crypto';
import { canonicalUrl, dateKey } from './domain.mjs';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export const difficultyLevels = ['UNSET', 'EASY', 'MID', 'HARD'];
function metadata(input) {
  const fields = {};
  for (const [key, max] of [['title', 300], ['source', 300]]) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || input[key].length > max) fail(`${key}: ${max}文字以内で入力してください。`);
      fields[key] = input[key].trim();
    }
  }
  if (input.topics !== undefined) {
    if (!Array.isArray(input.topics) || input.topics.length > 20 || input.topics.some(t => typeof t !== 'string' || !t.trim() || t.length > 60)) fail('Topic は1件60文字、最大20件です。');
    fields.topics = [...new Set(input.topics.map(t => t.trim()))];
  }
  if (input.rating !== undefined) {
    const rating = input.rating;
    if (rating !== null && (!Number.isInteger(rating) || rating < 0 || rating > 10000)) fail('Rating は0〜10000の整数、または空欄にしてください。');
    fields.rating = rating;
  }
  if (input.difficulty !== undefined) {
    if (!difficultyLevels.includes(input.difficulty)) fail('難易度が不正です。');
    fields.difficulty = input.difficulty;
  }
  if (input.archived !== undefined) {
    if (typeof input.archived !== 'boolean') fail('アーカイブ設定が不正です。');
    fields.archived = input.archived;
  }
  return fields;
}
function fallbackTitle(url) {
  const u = new URL(url);
  return `${u.hostname} · ${u.pathname.split('/').filter(Boolean).slice(-2).join(' / ')}`.slice(0,300);
}
export function stockProblems(s, input, now = new Date(), capturedVia = 'web') {
  const entries = typeof input.urls === 'string' ? input.urls.trim().split(/\s+/).filter(Boolean) : input.urls;
  if (!Array.isArray(entries) || !entries.length || entries.length > 100) fail('URL を1〜100件入力してください。');
  const fields = metadata(input);
  // Validate the entire batch before changing any records, including in-memory callers.
  const urls = entries.map((entry,index) => {
    try {
      if (typeof entry !== 'string' || entry.length > 2000) throw new Error();
      return canonicalUrl(entry);
    } catch { fail(`${index+1}件目の URL が不正です。HTTP(S) の問題 URL を入力してください。`); }
  });
  let added = 0; const ids = [];
  for (const url of urls) {
    let p = s.problems.find(p => canonicalUrl(p.url) === url);
    if (!p) {
      p = { id: randomUUID(), url, title: fields.title || fallbackTitle(url), platform: new URL(url).hostname, rating: null, difficulty: 'UNSET', source: '', archived: false, topics: [], state: 'NEW', observation: '', firstTouchedAt: null, failureReasons: [], createdAt: now.toISOString(), capturedVia, ...fields };
      s.problems.unshift(p); added++;
    }
    if (!ids.includes(p.id)) ids.push(p.id);
  }
  if (input.queueToday === true) updateQueue(s, { action:'add', problemIds:ids }, now);
  return { added, reused: urls.length-added, ids };
}
export function editProblem(s, id, input) {
  const p = s.problems.find(p => p.id === id);
  if (!p) fail('問題が見つかりません。');
  const fields = metadata(input);
  if (fields.title === '') fail('問題名を入力してください。');
  Object.assign(p, fields); return p;
}
export function dailyQueue(s, now = new Date()) {
  return s.problemQueues?.[dateKey(now,s.settings.timezone)] || [];
}
export function updateQueue(s, input, now = new Date()) {
  if (!['add','remove','up','down'].includes(input.action)) fail('キュー操作が不正です。');
  const date = dateKey(now,s.settings.timezone);
  const ids = input.action === 'add' ? input.problemIds : [input.problemId];
  if (!Array.isArray(ids) || !ids.length || ids.length>100 || ids.some(id => typeof id !== 'string' || !s.problems.some(p => p.id === id))) fail('追加する問題を選択してください（最大100件）。');
  if (input.action === 'add' && ids.some(id => s.problems.find(p=>p.id===id).archived)) fail('アーカイブを解除してからキューへ追加してください。');
  s.problemQueues ||= {};
  const q = s.problemQueues[date] ||= [];
  if (input.action === 'add') {
    for (const id of ids) if (!q.some(e=>e.problemId===id)) q.push({problemId:id,status:'PENDING',queuedAt:now.toISOString()});
  } else {
    const index=q.findIndex(e=>e.problemId===input.problemId);
    if (index>=0) {
      if(input.action==='remove') q.splice(index,1);
      else { const to=index+(input.action==='up'?-1:1); if(to>=0 && to<q.length) [q[index],q[to]]=[q[to],q[index]]; }
    }
  }
  return {date,items:q};
}
export function nextProblem(s, now = new Date()) {
  const q = dailyQueue(s,now);
  if (q.length) {
    for (const status of ['PENDING','THINKING']) {
      const entry=q.find(e=>e.status===status && s.problems.some(p=>p.id===e.problemId&&!p.archived));
      if(entry) return s.problems.find(p=>p.id===entry.problemId);
    }
    return null;
  }
  const skipped = new Set(s.attempts.filter(a=>a.date===dateKey(now,s.settings.timezone)&&a.result==='SKIPPED').map(a=>a.problemId));
  return s.problems.find(p=>p.state==='NEW'&&!p.archived&&!skipped.has(p.id)) || null;
}
export function extractProblemUrls(content) {
  return String(content || '').match(/https?:\/\/[^\s<>\[\]"`]+/gi)?.map(url=>url.replace(/[.,;!?)、。）」』]+$/u,'')) || [];
}
