import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const shell = process.env.CP_HUB_TEST_BASH || (process.platform === 'win32' ? null : '/bin/bash');
const toBash = path => process.platform === 'win32' ? path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_,d) => '/' + d.toLowerCase()) : path;
const oldSha = 'a'.repeat(40), newSha = 'b'.repeat(40);
const mocks = {
  git: `#!/usr/bin/env bash
case "$*" in
  'rev-parse --show-toplevel') echo "$MOCK_ROOT";;
  'branch --show-current') echo main;;
  'remote get-url origin') echo https://github.com/Oxojo/cp-hub.git;;
  'diff --quiet'|'diff --cached --quiet') [[ "\${MOCK_DIRTY:-0}" = 0 ]];;
  'fetch --no-tags origin refs/heads/main:refs/remotes/origin/main') echo fetch >> "$MOCK_ROOT/.calls";;
  'rev-parse refs/remotes/origin/main') echo "$MOCK_TARGET";;
  'rev-parse HEAD') cat "$MOCK_ROOT/.mock-head";;
  merge-base*) [[ "\${MOCK_DIVERGED:-0}" = 0 ]];;
  'merge --ff-only '*) printf '%s\\n' "$MOCK_TARGET" > "$MOCK_ROOT/.mock-head";;
  *) echo "Unexpected git: $*" >&2; exit 9;;
esac
`,
  docker: `#!/usr/bin/env bash
echo "docker $*" >> "$MOCK_ROOT/.calls"
case "$*" in
  'compose ps --status running --services') echo db;;
  'compose exec -T db pg_dump -U cphub -d cphub')
    [[ "\${MOCK_FAIL_BACKUP:-0}" = 0 ]] || exit 8
    echo '-- mock SQL dump';;
  *'node --test'*) [[ "\${MOCK_FAIL_TESTS:-0}" = 0 ]] || exit 7;;
esac
`,
  curl: `#!/usr/bin/env bash
[[ "\${MOCK_BAD_HEALTH:-0}" = 0 ]] || exit 22
echo '{"ok":true,"storage":"postgres"}'
`,
  flock: '#!/usr/bin/env bash\nexit 0\n',
  timeout: '#!/usr/bin/env bash\nshift\nexec "$@"\n',
  sleep: '#!/usr/bin/env bash\nexit 0\n'
};

async function fixture(t, options = {}) {
  await mkdir('data', { recursive: true });
  const root = await mkdtemp(join(process.cwd(), 'data', 'cp-deploy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root,'scripts')); await mkdir(join(root,'bin'));
  await copyFile(new URL('../scripts/deploy-main.sh', import.meta.url), join(root,'scripts/deploy-main.sh'));
  await writeFile(join(root,'.env'), 'OWNER_PASSWORD=test-only\n');
  await writeFile(join(root,'.mock-head'), oldSha+'\n');
  for(const [name, content] of Object.entries(mocks)) await writeFile(join(root,'bin',name), content, { mode:0o755 });
  return { root, run: () => spawnSync(shell, ['-c', 'export PATH="$MOCK_ROOT/bin:$PATH"; bash "$MOCK_ROOT/scripts/deploy-main.sh"'], {
    env:{ ...process.env, MOCK_ROOT:toBash(root), MOCK_TARGET:newSha, ...options }, encoding:'utf8', timeout:20000
  }) };
}

test('deploy scripts have valid Bash syntax', {skip:!shell}, () => {
  for(const file of ['deploy-main.sh','install-auto-deploy.sh']) {
    const result=spawnSync(shell,['-n',toBash(resolve('scripts',file))],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  }
});
test('deployment builds, tests, backs up, switches and records SHA', {skip:!shell}, async t => {
  const f=await fixture(t), result=f.run(); assert.equal(result.status,0,result.stdout+result.stderr);
  const calls=await readFile(join(f.root,'.calls'),'utf8');
  assert.ok(calls.indexOf('node --test')<calls.indexOf('pg_dump'));
  assert.ok(calls.indexOf('pg_dump')<calls.indexOf('up -d --no-deps --no-build --force-recreate web'));
  assert.equal((await readFile(join(f.root,'.deploy/deployed-sha'),'utf8')).trim(),newSha);
  assert.equal(await readFile(join(f.root,'.env'),'utf8'),'OWNER_PASSWORD=test-only\n');
});
test('unchanged main with healthy runtime does not rebuild', {skip:!shell}, async t => {
  const f=await fixture(t,{MOCK_TARGET:oldSha});await mkdir(join(f.root,'.deploy'));await writeFile(join(f.root,'.deploy/deployed-sha'),oldSha);
  const result=f.run();assert.equal(result.status,0,result.stderr);
  assert.doesNotMatch(await readFile(join(f.root,'.calls'),'utf8'),/docker/);
});
for(const failure of ['MOCK_FAIL_TESTS','MOCK_FAIL_BACKUP']) {
  test(`${failure} prevents runtime replacement and success marker`,{skip:!shell},async t => {
    const f=await fixture(t,{[failure]:'1'}), result=f.run();assert.notEqual(result.status,0,result.stdout);
    assert.doesNotMatch(await readFile(join(f.root,'.calls'),'utf8'),/force-recreate web/);
    await assert.rejects(readFile(join(f.root,'.deploy/deployed-sha')));
  });
}
test('post-deployment health failure leaves no success marker', {skip:!shell}, async t => {
  const f=await fixture(t,{MOCK_BAD_HEALTH:'1'}),result=f.run();assert.notEqual(result.status,0,result.stdout);
  await assert.rejects(readFile(join(f.root,'.deploy/deployed-sha')));
});
test('local tracked changes block automatic update', {skip:!shell}, async t => {
  const f=await fixture(t,{MOCK_DIRTY:'1'}),result=f.run();assert.notEqual(result.status,0,result.stdout);
  await assert.rejects(readFile(join(f.root,'.calls')));
});
