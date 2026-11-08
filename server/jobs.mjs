import { createHash } from 'node:crypto';
import { progress } from './domain.mjs';

export async function runJobs(store, sync, env = process.env, fetcher = fetch, now = new Date()) {
  const work = await store.transaction(doc => {
    const p = progress(doc.state, now), s = doc.state.settings;
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: s.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const channel = doc.internal.discordChannel || env.DISCORD_CHANNEL_ID;
    const jobs = [];
    const schedule = (key, content) => {
      const delivery = doc.internal.deliveries[key];
      if (delivery?.status === 'SENT' || delivery?.status === 'FAILED' || (delivery?.leaseUntil || 0) > +now || (delivery?.nextTry || 0) > +now) return;
      doc.internal.deliveries[key] = { ...delivery, status: 'SENDING', leaseUntil: +now + 60000, attempts: (delivery?.attempts || 0) + 1 };
      jobs.push({ key, content, channel });
    };
    if (env.DISCORD_BOT_TOKEN && channel) {
      const summary = `${p.date}\nTouched ${p.touched}/${s.dailyTarget} · Solved ${p.solved} · Learned ${p.learned} · Unknown ${p.unknown}\nReview ${p.due}`;
      if (clock >= s.morningTime && clock < s.eveningTime) schedule(`morning:${p.date}`, `☀️ CP Hub\n${summary}`);
      if (clock >= s.eveningTime) schedule(`evening:${p.date}`, `🌙 CP Hub\n${summary}`);
      const weekday = new Intl.DateTimeFormat('en-US', {timeZone:s.timezone,weekday:'short'}).format(now);
      if (weekday === 'Sun' && clock >= '23:45') {
        const start = new Date(`${p.date}T12:00:00Z`); start.setUTCDate(start.getUTCDate()-6);
        const weekStart = start.toISOString().slice(0,10);
        const touched = doc.state.problems.filter(p => p.firstTouchedAt >= weekStart && p.firstTouchedAt <= progress(doc.state,now).date).length;
        schedule(`weekly:${p.date}`, `📊 Weekly CP Hub\nNew touched ${touched}/${s.weeklyTarget}\n${summary}`);
      }
      if (s.notifyContests) for (const c of doc.state.contests.filter(c => c.startAt && !c.hidden && c.status === 'PLANNED')) {
        const mins = (+new Date(c.startAt) - +now) / 60000;
        for (const offset of [60, 10]) if (mins > offset - 5 && mins <= offset) schedule(`contest:${c.id}:${c.startAt}:${offset}`, `🏁 ${c.name}\n開始約 ${Math.ceil(mins)} 分前\n${c.url}`);
      }
    }
    const clistDue = env.CLIST_API_KEY && +now - (doc.internal.syncAttempt || 0) > 6 * 3600000;
    if (clistDue) doc.internal.syncAttempt = +now;
    return { jobs, clistDue };
  });
  if (work.clistDue) try { await sync(); } catch { /* persisted by sync; retry after 5 min */ await store.transaction(d => { d.internal.syncAttempt = +now - 6 * 3600000 + 300000; }); }
  for (const job of work.jobs) {
    let status;
    try {
      const response = await fetcher(`https://discord.com/api/v10/channels/${job.channel}/messages`, { method: 'POST', headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: job.content.slice(0, 2000), allowed_mentions: { parse: [] }, nonce: createHash('sha256').update(job.key).digest('hex').slice(0, 24), enforce_nonce: true }), signal: AbortSignal.timeout(15000) });
      status = response.status;
      if (!response.ok) throw new Error('delivery failed');
      const message = await response.json();
      await store.transaction(d => { Object.assign(d.internal.deliveries[job.key], { status: 'SENT', messageId: message.id, leaseUntil: 0 }); });
    } catch {
      await store.transaction(d => { const delivery = d.internal.deliveries[job.key]; Object.assign(delivery, { status: [401,403,404].includes(status) || delivery.attempts >= 5 ? 'FAILED' : 'RETRY', httpStatus: status || null, leaseUntil: 0, nextTry: +now + 60000 * 2 ** delivery.attempts }); });
    }
  }
}
