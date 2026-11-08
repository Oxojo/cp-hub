import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createStore } from './store.mjs';
import { createClistSync } from './clist.mjs';
import { discordInteraction, verifyDiscord } from './discord.mjs';
import { progress, recordAttempt, recordReview } from './domain.mjs';
import { runJobs } from './jobs.mjs';

export async function buildServer(env = process.env, suppliedStore) {
  const store = suppliedStore || await createStore(env);
  const sync = createClistSync(store, env), sessions = new Map(), loginLimits = new Map();
  const origin = env.APP_ORIGIN || `http://127.0.0.1:${env.PORT || 4173}`;
  const equal = (a,b) => { const x=Buffer.from(a || ''), y=Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x,y); };
  const root = fileURLToPath(new URL('../dist/', import.meta.url));
  const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };
  async function rawBody(req) {
    const chunks=[]; let size=0;
    for await (const c of req) { size+=c.length; if(size>2*1024*1024) throw Object.assign(new Error('Body too large'), {status:413}); chunks.push(c); }
    return Buffer.concat(chunks);
  }
  const server = createServer(async (req,res) => {
    try {
      const path = new URL(req.url, origin).pathname;
      if (!env.OWNER_PASSWORD && req.headers.host !== new URL(origin).host) return json(res,403,{error:'Host does not match APP_ORIGIN'});
      if (path === '/api/health') return json(res,200,{ ok:true, storage:store.mode });
      if (path === '/api/discord/interactions' && req.method === 'POST') {
        const raw=await rawBody(req);
        if (!verifyDiscord(raw,req.headers['x-signature-ed25519'],req.headers['x-signature-timestamp'],env.DISCORD_PUBLIC_KEY)) return json(res,401,{error:'Invalid signature'});
        const interaction=JSON.parse(raw);
        try {
          const reply=await store.transaction(d=>discordInteraction(d,interaction,env)); return json(res,200,reply);
        } catch {
          return json(res,200,{type:4,data:{content:'保存できませんでした。URL・Observation・復習の状態を確認して再実行してください。',flags:64,allowed_mentions:{parse:[]}}});
        }
      }
      if (path.startsWith('/api/')) {
        if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== origin) return json(res,403,{error:'Invalid origin'});
        if (path === '/api/login' && req.method === 'POST') {
          const ip = req.socket.remoteAddress;
          const rate = loginLimits.get(ip) || { count: 0, until: Date.now()+60000 };
          if (rate.until < Date.now()) { rate.count=0; rate.until=Date.now()+60000; }
          rate.count++; loginLimits.set(ip,rate);
          if (rate.count > 10) return json(res,429,{error:'Please wait a minute before retrying'});
          const input=JSON.parse(await rawBody(req));
          if (!env.OWNER_PASSWORD || !equal(input.password,env.OWNER_PASSWORD)) return json(res,401,{error:'Invalid password'});
          const token=randomBytes(32).toString('hex'); sessions.set(token,Date.now()+86400000);
          return json(res,200,{ok:true},{'Set-Cookie':`hub_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${origin.startsWith('https:')?'; Secure':''}`});
        }
        const token=(req.headers.cookie || '').match(/(?:^|;\s*)hub_session=([a-f0-9]+)/)?.[1];
        const local=!env.OWNER_PASSWORD && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        if (!local && (!token || (sessions.get(token)||0)<Date.now())) return json(res,401,{error:'Login required'});
        if (req.method === 'GET' && path === '/api/state') return json(res,200,await store.transaction(d=>({state:d.state,revision:d.revision})));
        if (req.method === 'GET' && path === '/api/status') return json(res,200,await store.transaction(d=>({storage:store.mode,clist:{configured:!!env.CLIST_API_KEY,...d.internal.clist},discord:{configured:!!(env.DISCORD_PUBLIC_KEY && env.DISCORD_OWNER_ID),channelConfigured:!!(d.internal.discordChannel || env.DISCORD_CHANNEL_ID)},deliveries:Object.values(d.internal.deliveries).filter(d=>d.status==='FAILED').length})));
        if (req.method === 'GET' && path === '/api/v1/today') return json(res,200,await store.transaction(d=>progress(d.state)));
        if (req.method === 'POST' && path === '/api/v1/clist/sync') {
          if (!env.CLIST_USERNAME || !env.CLIST_API_KEY) return json(res,503,{error:'CLIST credentials not configured'});
          void sync().catch(()=>{}); return json(res,202,{message:'Sync started'});
        }
        if (req.method === 'POST' && path === '/api/v1/reviews/postpone') {
          const input = JSON.parse(await rawBody(req));
          const result = await store.transaction(d => {
            const review = d.state.reviews.find(r => r.id === input.id && r.status === 'PENDING');
            if (!review) throw new Error('Unknown review');
            const next = new Date(`${review.dueDate}T12:00:00Z`); next.setUTCDate(next.getUTCDate()+1); review.dueDate=next.toISOString().slice(0,10);
            return {state:d.state};
          }); return json(res,200,result);
        }
        if (req.method === 'POST' && ['/api/v1/attempts','/api/v1/reviews'].includes(path)) {
          const input=JSON.parse(await rawBody(req));
          const payload=await store.transaction(d=>{
            const result=path.endsWith('attempts')?recordAttempt(d.state,input):recordReview(d.state,input.id,input.answer,input.key);
            return {result,state:d.state,revision:d.revision+1};
          }); return json(res,200,payload);
        }
        if (req.method === 'PUT' && path === '/api/state') {
          const input=JSON.parse(await rawBody(req));
          const payload=await store.transaction(d=>{
            if(input.revision!==d.revision) throw Object.assign(new Error('Data changed. Reload before saving.'),{status:409});
            const s=input.state;
            if(!s || !['problems','attempts','reviews','events','contests'].every(k=>Array.isArray(s[k])) || !s.settings) throw new Error('Invalid state');
            // Attempts/reviews and CLIST facts remain authoritative on the server.
            d.state.events=s.events;
            const {dailyTarget,weeklyTarget,morningTime,eveningTime,notifyContests}=s.settings;
            if (!Number.isInteger(dailyTarget)||dailyTarget<0||dailyTarget>100||!Number.isInteger(weeklyTarget)||weeklyTarget<1||weeklyTarget>500||!/^([01]\d|2[0-3]):[0-5]\d$/.test(morningTime)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(eveningTime)) throw new Error('Invalid settings');
            Object.assign(d.state.settings,{dailyTarget,weeklyTarget,morningTime,eveningTime,notifyContests:!!notifyContests});
            for(const c of d.state.contests) { const changed=s.contests.find(x=>x.id===c.id); if(changed) { c.status=changed.status; c.result=changed.result; c.hidden=!!changed.hidden; } }
            return {state:d.state,revision:d.revision+1};
          }); return json(res,200,payload);
        }
        return json(res,404,{error:'Unknown API endpoint'});
      }
      if(!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'Method not allowed'});
      const file=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path));
      if(!file.startsWith(resolve(root)+sep)) return json(res,403,{error:'Forbidden'});
      let body; try { body=await readFile(file); } catch { return json(res,404,{error:'Not found'}); }
      res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"}); res.end(req.method==='HEAD'?undefined:body);
    } catch(e) { json(res,e.status||400,{error:e.status?e.message:'Request failed. Check input or server configuration.'}); }
  });
  return {server,store,sync};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host=process.env.HOST||'127.0.0.1';
  if(!['127.0.0.1','localhost','::1'].includes(host)&&!process.env.OWNER_PASSWORD) throw new Error('OWNER_PASSWORD required for public binding');
  const {server,store,sync}=await buildServer();
  server.listen(Number(process.env.PORT||4173),host,()=>console.log(`CP Hub listening on ${host}:${process.env.PORT||4173}`));
  let busy=false;
  const tick=async()=>{ if(busy)return;busy=true;try{await runJobs(store,sync);}catch{console.error('Job tick failed');}finally{busy=false;} };
  const timer=setInterval(tick,30000); void tick();
  const stop=()=>{clearInterval(timer);server.close(()=>{void store.close();});};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
