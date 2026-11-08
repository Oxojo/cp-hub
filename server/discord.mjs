import { createPublicKey, verify, randomBytes } from 'node:crypto';
import { progress, recordAttempt, recordReview } from './domain.mjs';

export function verifyDiscord(body, signature, timestamp, publicKey, now = Date.now()) {
  try {
    if (!/^[a-f0-9]{128}$/i.test(signature || '') || !/^\d+$/.test(timestamp || '') || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
    const key = createPublicKey({ key: Buffer.from(`302a300506032b6570032100${publicKey}`, 'hex'), format: 'der', type: 'spki' });
    return verify(null, Buffer.concat([Buffer.from(timestamp), body]), key, Buffer.from(signature, 'hex'));
  } catch { return false; }
}
const message = content => ({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
const button = (label, custom_id, style = 2) => ({ type: 2, label, custom_id, style });
const row = components => ({ type: 1, components });
export function discordInteraction(doc, interaction, env = process.env) {
  if (interaction.type === 1) return { type: 1 };
  const actor = interaction.member?.user?.id || interaction.user?.id;
  if (!env.DISCORD_OWNER_ID || actor !== env.DISCORD_OWNER_ID || interaction.guild_id !== env.DISCORD_GUILD_ID) return message('この操作は設定済み Owner / Guild 専用です。');
  if (doc.internal.interactions[interaction.id]) return doc.internal.interactions[interaction.id];
  const s = doc.state;
  let reply;
  const session = (kind, target) => {
    const nonce = randomBytes(12).toString('hex');
    doc.internal.sessions[nonce] = { kind, target, actor, guild: interaction.guild_id, expires: Date.now() + 3600000, used: false };
    return nonce;
  };
  const feed = () => {
    const p = s.problems.find(p => p.state === 'NEW');
    if (!p) return message('未接触の候補はありません。/add で URL を登録してください。');
    const nonce = session('problem', p.id);
    return { type: 4, data: { content: `${p.title}\n${p.url}\n制約 → 素直解 → 性質 → 解法候補`, flags: 64, allowed_mentions: { parse: [] }, components: [row([button('Solved', `solve:${nonce}`, 3), button('Learned', `learn:${nonce}`, 1), button('Thinking', `think:${nonce}`), button('Unknown', `unknown:${nonce}`, 4), button('Skip', `skip:${nonce}`)])] } };
  };
  if (interaction.type === 2) {
    const name = interaction.data.name;
    if (['today', 'progress'].includes(name)) {
      const p = progress(s);
      reply = message(`${p.date}\nTouched ${p.touched}/${s.settings.dailyTarget} · Solved ${p.solved} · Learned ${p.learned} · Unknown ${p.unknown}\nReview ${p.due}\n${s.contests.filter(c => c.date === p.date && !c.hidden).map(c => `${c.time} ${c.name}`).join('\n')}`);
    } else if (name === 'setup') {
      doc.internal.discordChannel = interaction.channel_id;
      reply = message('このチャンネルを日次投稿先に設定しました。個人ログの自動投稿を行うため、Owner 専用チャンネルを使用してください。');
    } else if (name === 'problems') reply = feed();
    else if (name === 'add') {
      const url = interaction.data.options?.find(o => o.name === 'url')?.value;
      recordAttempt(s, { url, result: 'SKIPPED', key: interaction.id });
      reply = message('問題候補を登録しました。/problems で開始できます。');
    } else if (name === 'contests') reply = message(s.contests.filter(c => !c.hidden).slice(0, 10).map(c => `${c.date} ${c.time} ${c.name}\n${c.url}`).join('\n') || 'コンテスト予定はありません。');
    else if (name === 'review') {
      const r = s.reviews.filter(r => r.status === 'PENDING' && r.dueDate <= progress(s).date).sort((a,b) => a.dueDate.localeCompare(b.dueDate))[0];
      if (!r) reply = message('期限の来た復習はありません。');
      else {
        const p = s.problems.find(p => p.id === r.problemId); const nonce = session('review', r.id);
        reply = { type: 4, data: { content: `${p.title}\n${p.url}\n5分以内に核心を再構築できますか？`, flags: 64, allowed_mentions: { parse: [] }, components: [row([button('Remembered', `remembered:${nonce}`, 3), button('Forgot', `forgot:${nonce}`, 4), button('Still Unknown', `still:${nonce}`)])] } };
      }
    } else reply = message('未対応のコマンドです。');
  } else {
    const [action, nonce] = String(interaction.data.custom_id || '').split(':');
    const ref = doc.internal.sessions[nonce];
    if (!ref || ref.actor !== actor || ref.guild !== interaction.guild_id || ref.expires < Date.now() || ref.used) return message('この操作は終了済みです。コマンドで再開してください。');
    if (ref.kind === 'problem') {
      const p = s.problems.find(p => p.id === ref.target);
      if (action === 'learn' && interaction.type === 3) return { type: 9, data: { custom_id: `observation:${nonce}`, title: 'Key Observation', components: [row([{ type: 4, custom_id: 'observation', label: '解法の核心を1文で', style: 2, required: true, min_length: 1, max_length: 1000 }])] } };
      const result = { solve: 'SOLVED', observation: 'LEARNED', think: 'ATTEMPTED', unknown: 'UNKNOWN', skip: 'SKIPPED' }[action];
      if (!result || (action === 'observation' && interaction.type !== 5)) return message('不正な操作です。');
      const observation = interaction.data.components?.flatMap(r => r.components || []).find(c => c.custom_id === 'observation')?.value;
      recordAttempt(s, { url: p.url, title: p.title, topics: p.topics, result, observation, key: `feed:${nonce}` });
      ref.used = true;
      reply = feed();
      reply.data.content = `${p.title}: ${result} を保存しました。\n\n${reply.data.content}`;
    } else {
      const answer = { remembered: 'remembered', forgot: 'forgot', still: 'unknown' }[action];
      const r = s.reviews.find(r => r.id === ref.target);
      recordReview(s, r.id, answer, `review:${nonce}`); ref.used = true;
      const p = s.problems.find(p => p.id === r.problemId);
      reply = message(`復習結果を保存しました。次回: ${r.status === 'COMPLETED' ? '完了' : r.dueDate}${answer === 'forgot' ? `\nObservation: ${p.observation || '未記録'}` : ''}`);
    }
  }
  doc.internal.interactions[interaction.id] = reply;
  // Keep replay responses for 1000 recent interactions; domain keys persist independently.
  const keys = Object.keys(doc.internal.interactions);
  if (keys.length > 1000) delete doc.internal.interactions[keys[0]];
  for (const [k,v] of Object.entries(doc.internal.sessions)) if (v.expires < Date.now()) delete doc.internal.sessions[k];
  return reply;
}
