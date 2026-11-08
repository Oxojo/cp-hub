import { createStore } from './store.mjs';
import { createClistSync } from './clist.mjs';
import { runJobs } from './jobs.mjs';
if (!process.env.DATABASE_URL) throw new Error('Standalone worker requires DATABASE_URL. File mode runs jobs inside the web process.');
const store = await createStore(), sync = createClistSync(store);
let stop = false;
process.on('SIGTERM', () => { stop = true; }); process.on('SIGINT', () => { stop = true; });
while (!stop) {
  try { await runJobs(store, sync); } catch { console.error('Worker tick failed'); }
  await new Promise(r => setTimeout(r, 30000));
}
await store.close();
