import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readLocalEnvironment, createLiveEnvironment } from '../scripts/local-owner-env.mjs';

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'wardiya-private-env-'));
  mkdirSync(path.join(directory, '.sites-runtime'));
  return { directory, pointer: path.join(directory, '.sites-runtime', 'owner-env-path.txt'), external: path.join(directory, 'owner-private.env') };
}

test('default configuration stays disabled and unrelated bindings are excluded', () => {
  const { directory } = fixture();
  assert.deepEqual(readLocalEnvironment(directory), { MAKE_SYNC_ENABLED: 'false', AI_ENABLED: 'false' });
  writeFileSync(path.join(directory, '.env'), 'MAKE_DATA_STORE_ID=123\nOTHER_SECRET=excluded\nDB=wrong-database\n');
  assert.deepEqual(readLocalEnvironment(directory), { MAKE_SYNC_ENABLED: 'false', AI_ENABLED: 'false', MAKE_DATA_STORE_ID: '123' });
});

test('private pointer replaces local config, without copying or inheriting keys', () => {
  const { directory, pointer, external } = fixture();
  writeFileSync(path.join(directory, '.env'), 'MAKE_API_TOKEN=local-synthetic\nMAKE_SYNC_ENABLED=true\n');
  writeFileSync(external, '\uFEFFMAKE_API_TOKEN="external-synthetic"\nMAKE_DATA_STORE_ID=213123\nUNRELATED_SECRET=excluded\nDB=wrong-database\n');
  writeFileSync(pointer, '\uFEFF' + external + '\r\n');
  assert.deepEqual(readLocalEnvironment(directory), { MAKE_SYNC_ENABLED: 'false', AI_ENABLED: 'false', MAKE_API_TOKEN: 'external-synthetic', MAKE_DATA_STORE_ID: '213123' });
});

test('live getters follow external changes while preserving the actual database', () => {
  const { directory, pointer, external } = fixture();
  const DB = Object.freeze({ prepare() {} });
  const original = Object.freeze({ DB, MAKE_API_TOKEN: 'stale-synthetic', MAKE_SYNC_ENABLED: 'true', EXTRA_BINDING: 'unchanged' });
  const live = createLiveEnvironment(original, directory);
  assert.equal(live.DB, DB);
  assert.equal(live.EXTRA_BINDING, 'unchanged');
  assert.equal(live.MAKE_SYNC_ENABLED, 'false');
  assert.equal(live.MAKE_API_TOKEN, undefined);
  writeFileSync(external, 'MAKE_API_TOKEN=external-synthetic\nMAKE_SYNC_ENABLED=true\nAI_ENABLED=false\nDB=wrong\n');
  writeFileSync(pointer, external);
  assert.equal(live.MAKE_API_TOKEN, 'external-synthetic');
  assert.equal(live.MAKE_SYNC_ENABLED, 'true');
  assert.equal(live.DB, DB);
  writeFileSync(external, 'MAKE_SYNC_ENABLED=false\n');
  assert.equal(live.MAKE_SYNC_ENABLED, 'false');
  assert.equal(live.MAKE_API_TOKEN, undefined);
  unlinkSync(pointer);
  assert.equal(live.MAKE_SYNC_ENABLED, 'false');
});

test('an invalid or missing explicit file fails clearly rather than enabling another config', () => {
  const { directory, pointer, external } = fixture();
  writeFileSync(path.join(directory, '.env'), 'MAKE_SYNC_ENABLED=true\n');
  for (const invalid of ['', '.env', external + '\nanother-file']) {
    writeFileSync(pointer, invalid);
    assert.throws(() => readLocalEnvironment(directory), /one absolute file path/);
  }
  writeFileSync(pointer, external);
  assert.throws(() => readLocalEnvironment(directory), /missing or unreadable/);
  writeFileSync(pointer, directory);
  assert.throws(() => readLocalEnvironment(directory), /missing or unreadable/);
  assert.throws(() => createLiveEnvironment(undefined, directory), /project launcher/);
});
