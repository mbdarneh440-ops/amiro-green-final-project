import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLocalDatabase, readLocalEnvironment } from '../scripts/local-node-runtime.mjs';

const schema = readFileSync(new URL('../drizzle/0000_outgoing_puma.sql', import.meta.url), 'utf8');

test('actual schema persists data and accepts the existing workspace query contract', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wardiya-node-db-'));
  const file = path.join(directory, 'workspace.sqlite');
  let db = createLocalDatabase(file, schema);
  await db.prepare('INSERT OR IGNORE INTO workspaces (owner_id,version,data,updated_at) VALUES (?,1,?,?)').bind('synthetic', '{"proposals":[]}', '2026-10-10').run();
  await db.prepare('INSERT OR IGNORE INTO workspaces (owner_id,version,data,updated_at) VALUES (?,1,?,?)').bind('synthetic', 'must not replace', '2026-10-10').run();
  assert.deepEqual(await db.prepare('SELECT version,data FROM workspaces WHERE owner_id=?').bind('synthetic').first(), { version: 1, data: '{"proposals":[]}' });
  db.close();
  db = createLocalDatabase(file, schema);
  assert.equal((await db.prepare('SELECT version FROM workspaces WHERE owner_id=?').bind('synthetic').first()).version, 1);
  assert.equal(await db.prepare('SELECT version FROM workspaces WHERE owner_id=?').bind('missing').first(), null);
  db.close();
});

test('concurrent version checks protect a saved manager decision', async () => {
  const db = createLocalDatabase(':memory:', schema);
  await db.prepare('INSERT INTO workspaces (owner_id,version,data,updated_at) VALUES (?,1,?,?)').bind('synthetic', 'pending', 'now').run();
  const query = 'UPDATE workspaces SET data=?,version=version+1,updated_at=? WHERE owner_id=? AND version=?';
  assert.equal((await db.prepare(query).bind('approved by manager', 'later', 'synthetic', 1).run()).meta.changes, 1);
  assert.equal((await db.prepare(query).bind('stale automated overwrite', 'later', 'synthetic', 1).run()).meta.changes, 0);
  assert.equal((await db.prepare('SELECT data FROM workspaces WHERE owner_id=?').bind('synthetic').first()).data, 'approved by manager');
  db.close();
});

test('parameters remain data rather than executable SQL', async () => {
  const db = createLocalDatabase(':memory:', schema);
  const value = "synthetic'); DROP TABLE workspaces; --";
  await db.prepare('INSERT INTO workspaces (owner_id,version,data,updated_at) VALUES (?,1,?,?)').bind(value, 'pending', 'now').run();
  assert.equal((await db.prepare('SELECT data FROM workspaces WHERE owner_id=?').bind(value).first()).data, 'pending');
  assert.throws(() => db.prepare('SELECT ?').bind(undefined), /Unsupported/);
  db.close();
});

test('only owner whitelist is loaded and absent activation flags are false', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wardiya-node-env-'));
  assert.deepEqual(readLocalEnvironment(directory), { MAKE_SYNC_ENABLED: 'false', AI_ENABLED: 'false' });
  writeFileSync(path.join(directory, '.env'), '\uFEFFMAKE_DATA_STORE_ID="123"\nMAKE_SYNC_ENABLED=true\nUNRELATED_SECRET=not-imported\nAI_MODEL="synthetic-model"\n');
  assert.deepEqual(readLocalEnvironment(directory), { MAKE_SYNC_ENABLED: 'true', AI_ENABLED: 'false', MAKE_DATA_STORE_ID: '123', AI_MODEL: 'synthetic-model' });
});
