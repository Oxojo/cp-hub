import { randomUUID } from 'node:crypto';

export function dateKey(now = new Date(), timezone = 'Asia/Tokyo') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function plusDays(key, days) {
  const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function emptyState() {
  return { version: 1, settings: { timezone: 'Asia/Tokyo', dailyTarget: 15, weeklyTarget: 80, morningTime: '09:00', eveningTime: '23:30', notifyContests: true }, problems: [], attempts: [], reviews: [], contests: [], events: [] };
}
export function canonicalUrl(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('HTTP(S) URL required');
  if (u.username || u.password) throw new Error('Credentials in URL are not allowed');
  u.hostname = u.hostname.replace(/^www\./, ''); u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_') || k === 'ref') u.searchParams.delete(k);
  if (u.hostname === 'atcoder.jp') u.searchParams.delete('lang');
  if (u.hostname === 'codeforces.com') {
    const match=u.pathname.match(/^\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)\/?$/);
    if(match) u.pathname=`/problemset/problem/${match[1]}/${match[2]}`;
  }
  u.pathname = u.pathname.replace(/\/$/, '') || '/'; return u.href;
}
const rank = { NEW: 0, ATTEMPTED: 1, UNKNOWN: 2, LEARNED: 3, SOLVED: 4 };
export function recordAttempt(s, input, now = new Date()) {
  if (!input.key || input.key.length > 160) throw new Error('Idempotency key required');
  const previous = s.attempts.find(a => a.key === input.key);
  if (previous) return previous;
  const result = input.result;
  if (!['SOLVED', 'LEARNED', 'UNKNOWN', 'ATTEMPTED', 'SKIPPED'].includes(result)) throw new Error('Invalid result');
  const observation = String(input.observation || '').trim();
  if (observation.length > 1000 || (result === 'LEARNED' && !observation)) throw new Error('Learned requires an observation (1–1000 characters)');
  const url = canonicalUrl(input.url);
  let p = s.problems.find(p => canonicalUrl(p.url) === url);
  if (!p) {
    p = { id: randomUUID(), url, title: String(input.title || new URL(url).pathname).slice(0, 300), platform: new URL(url).hostname, topics: [], state: 'NEW', rating: null, firstTouchedAt: null, observation: '', failureReasons: [] };
    s.problems.unshift(p);
  }
  const date = dateKey(now, s.settings.timezone);
  const topics = Array.isArray(input.topics) ? input.topics.slice(0, 20).map(t => String(t).slice(0, 60)) : [];
  const a = { id: randomUUID(), key: input.key, sessionId: input.sessionId || date, problemId: p.id, result, date, time: now.toISOString().slice(11, 16), topics, observation, slow: !!input.slow, multipleWa: !!input.multipleWa, isReview: false, at: now.toISOString() };
  s.attempts.push(a);
  const queued = s.problemQueues?.[date]?.find(e=>e.problemId===p.id);
  if (queued) { queued.status=result==='SKIPPED'?'SKIPPED':result==='ATTEMPTED'?'THINKING':'DONE'; queued.result=result; }
  if (result === 'SKIPPED') return a;
  if (rank[result] > rank[p.state]) p.state = result;
  p.firstTouchedAt ||= date;
  p.topics = [...new Set([...p.topics, ...topics])];
  if (observation) p.observation = observation;
  const trigger = result === 'LEARNED' ? 'LEARNED' : result === 'UNKNOWN' ? 'UNKNOWN' : result === 'SOLVED' && input.slow ? 'SLOW_SOLVED' : null;
  if (trigger) {
    const dueDate = plusDays(date, { LEARNED: 1, UNKNOWN: 3, SLOW_SOLVED: 7 }[trigger]);
    const pending = s.reviews.find(r => r.problemId === p.id && r.status === 'PENDING');
    if (pending) { pending.dueDate = pending.dueDate < dueDate ? pending.dueDate : dueDate; if (trigger === 'LEARNED') pending.trigger = trigger; }
    else s.reviews.push({ id: randomUUID(), problemId: p.id, dueDate, stage: 0, trigger, status: 'PENDING' });
  }
  return a;
}
export function recordReview(s, id, answer, key, now = new Date()) {
  const previous = s.attempts.find(a => a.key === key); if (previous) return previous;
  const r = s.reviews.find(r => r.id === id && r.status === 'PENDING');
  if (!r || !['remembered', 'forgot', 'unknown'].includes(answer) || !key) throw new Error('Invalid review');
  const today = dateKey(now, s.settings.timezone);
  if (answer === 'forgot') { r.stage = 0; r.dueDate = plusDays(today, 1); }
  else if (answer === 'unknown') r.dueDate = plusDays(today, 3);
  else if (r.trigger === 'SLOW_SOLVED' || r.stage >= 2) { r.status = 'COMPLETED'; r.completedAt = today; }
  else { r.dueDate = plusDays(today, [7, 21][r.stage]); r.stage++; }
  const a = { id: randomUUID(), key, problemId: r.problemId, result: `REVIEW_${answer.toUpperCase()}`, date: today, time: now.toISOString().slice(11,16), isReview: true, topics: [] };
  s.attempts.push(a); return a;
}
export function progress(s, now = new Date()) {
  const date = dateKey(now, s.settings.timezone);
  const a = s.attempts.filter(a => a.date === date && !a.isReview && a.result !== 'SKIPPED');
  return { date, touched: new Set(a.map(a => a.problemId)).size, solved: a.filter(a => a.result === 'SOLVED').length, learned: a.filter(a => a.result === 'LEARNED').length, unknown: a.filter(a => a.result === 'UNKNOWN').length, due: s.reviews.filter(r => r.status === 'PENDING' && r.dueDate <= date).length };
}
