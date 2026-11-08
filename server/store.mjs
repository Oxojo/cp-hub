import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { emptyState } from './domain.mjs';

export async function createStore(env = process.env) {
  let pool;
  if (env.DATABASE_URL) {
    const { Pool } = await import('pg'); pool = new Pool({ connectionString: env.DATABASE_URL });
    await pool.query(await readFile(new URL('../migrations/001_hub_state.sql', import.meta.url), 'utf8'));
    await pool.query('INSERT INTO hub_state(id, document) VALUES(1,$1) ON CONFLICT DO NOTHING', [JSON.stringify({ state: emptyState(), internal: { interactions: {}, deliveries: {}, sessions: {} } })]);
  }
  const file = resolve(env.DATA_FILE || './data/hub.json');
  let chain = Promise.resolve();
  async function transaction(fn) {
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: [row] } = await client.query('SELECT revision, document FROM hub_state WHERE id=1 FOR UPDATE');
        const doc = row.document; doc.revision = Number(row.revision);
        const before = JSON.stringify(doc);
        const result = await fn(doc); if (JSON.stringify(doc) !== before) doc.revision++;
        if (result?.state) result.revision = doc.revision;
        await client.query('UPDATE hub_state SET revision=$1, document=$2 WHERE id=1', [doc.revision, JSON.stringify(doc)]);
        await client.query('COMMIT'); return result;
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    }
    const operation = chain.then(async () => {
      let doc;
      try { doc = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; doc = { revision: 0, state: emptyState(), internal: { interactions: {}, deliveries: {}, sessions: {} } }; }
      const before = JSON.stringify(doc);
      const result = await fn(doc); if (JSON.stringify(doc) !== before) doc.revision++;
      if (result?.state) result.revision = doc.revision;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(doc), { mode: 0o600 }); await rename(`${file}.tmp`, file); return result;
    });
    chain = operation.catch(() => {}); return operation;
  }
  return { transaction, close: () => pool?.end(), mode: pool ? 'postgres' : 'file' };
}
