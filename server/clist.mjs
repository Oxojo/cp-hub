export function normalizeContest(raw, timezone = 'Asia/Tokyo') {
  const parse = v => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`);
  const start = parse(raw.start), end = raw.end ? parse(raw.end) : new Date(+start + Number(raw.duration) * 1000);
  const url = new URL(raw.href);
  if (!raw.id || !raw.event || !Number.isFinite(+start) || !Number.isFinite(+end) || !['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid CLIST contest');
  const parts = date => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  const a = parts(start), b = parts(end);
  const resource = String(raw.resource?.host || raw.host || raw.resource || '').toLowerCase();
  return { id: `clist:${raw.id}`, externalId: String(raw.id), source: 'clist', name: raw.event.trim(), url: url.href, resource, platform: resource, startAt: start.toISOString(), endAt: end.toISOString(), date: `${a.year}-${a.month}-${a.day}`, time: `${a.hour}:${a.minute}`, endTime: `${b.hour}:${b.minute}`, kind: 'live', status: 'NONE' };
}
export function createClistSync(store, env = process.env, fetcher = fetch, pause = ms => new Promise(r => setTimeout(r, ms))) {
  let running;
  return function sync() {
    if (running) return running;
    running = run().finally(() => { running = null; }); return running;
  };
  async function run() {
    if (!env.CLIST_USERNAME || !env.CLIST_API_KEY) throw new Error('CLIST credentials not configured');
    const acquired = await store.transaction(d => {
      if ((d.internal.clistLease || 0) > Date.now()) return false;
      d.internal.clistLease = Date.now()+15*60000; return true;
    });
    if (!acquired) return { message: 'Sync already running' };
    const resources = (env.CLIST_RESOURCES || 'atcoder.jp,codeforces.com').split(',').map(s => s.trim().toLowerCase());
    const contests = []; let offset = 0;
    try {
      for (let page = 0; page < 100; page++) {
        const url = new URL('https://clist.by/api/v4/contest/');
        url.search = new URLSearchParams({ format: 'json', limit: '100', offset: String(offset), order_by: 'start', start__gte: new Date(Date.now() - 7 * 86400000).toISOString(), start__lte: new Date(Date.now() + 90 * 86400000).toISOString() });
        let response;
        for (let retry = 0; retry < 4; retry++) {
          const nextRequest = await store.transaction(d => {
            const next = Math.max(Date.now(), (d.internal.lastClistRequest || 0) + 6500);
            d.internal.lastClistRequest = next; return next;
          });
          await pause(Math.max(0,nextRequest-Date.now()));
          try {
            response = await fetcher(url, { headers: { Authorization: `ApiKey ${env.CLIST_USERNAME}:${env.CLIST_API_KEY}` }, signal: AbortSignal.timeout(20000) });
          } catch {
            if (retry === 3) throw new Error('CLIST network timeout or connection failure');
            await pause(6500*2**retry); continue;
          }
          if (response.ok || (response.status !== 429 && response.status < 500)) break;
          if (retry < 3) await pause(Math.max(6500, Number(response.headers.get('retry-after') || 0) * 1000, 1000 * 2 ** retry));
        }
        if (!response.ok) throw new Error(`CLIST HTTP ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload.objects)) throw new Error('Invalid CLIST response');
        contests.push(...payload.objects);
        if (!payload.meta?.next) break;
        if (page === 99) throw new Error('CLIST pagination limit reached');
        offset += payload.objects.length;
        await store.transaction(d => { d.internal.clistLease = Date.now()+15*60000; });
      }
      return await store.transaction(doc => {
        const normalized = contests.map(c => normalizeContest(c, doc.state.settings.timezone)).filter(c => resources.includes(c.resource));
        for (const c of normalized) {
          const existing = doc.state.contests.find(x => x.id === c.id);
          if (existing) Object.assign(existing, c, { status: existing.status, result: existing.result, hidden: existing.hidden, missingSince: null, missingRuns: 0, isStale: false });
          else doc.state.contests.push(c);
        }
        const seen = new Set(normalized.map(c => c.id));
        for (const c of doc.state.contests.filter(c => c.source === 'clist' && resources.includes(c.resource))) {
          if (!seen.has(c.id) && new Date(c.startAt) > Date.now()-7*86400000 && new Date(c.startAt) < Date.now()+90*86400000) {
            c.missingSince ||= new Date().toISOString(); c.missingRuns=(c.missingRuns||0)+1;
            c.isStale = c.missingRuns>=3 || Date.now()-Date.parse(c.missingSince)>=86400000;
          }
        }
        doc.internal.clist = { lastSuccess: new Date().toISOString(), count: normalized.length, error: null };
        return doc.internal.clist;
      });
    } catch (e) {
      await store.transaction(doc => { doc.internal.clist = { ...doc.internal.clist, error: e.message, lastFailure: new Date().toISOString() }; });
      throw e;
    } finally { await store.transaction(d => { d.internal.clistLease = 0; }); }
  }
}
