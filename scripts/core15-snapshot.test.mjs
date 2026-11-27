import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { checkManifest, options, safeFileName, within } from './core15-snapshot.mjs';

const validPhoto = '123e4567-e89b-42d3-a456-426614174000-123e4567-e89b-42d3-a456-426614174001.png';
const validOffer = '123e4567-e89b-42d3-a456-426614174002.pdf';
const digest = value => createHash('sha256').update(value).digest('hex');
const cli = (...args) => spawnSync(process.execPath, ['scripts/core15-snapshot.mjs', ...args], {
  encoding: 'utf8',
});

function manifest(files = [], references = []) {
  return {
    format: 'supply-manager-core15-v1',
    database: 'supply_manager',
    schema: 'public',
    pgMajor: 17,
    counts: { User: 1, Task: 0 },
    references,
    files: [{ path: 'database.dump', bytes: 4, sha256: digest('dump') }, ...files],
  };
}

test('allow only server-generated attachment names, never traversal or arbitrary folders', () => {
  for (const name of ['purchase-requests/' + validPhoto, 'offer-documents/' + validOffer, 'database.dump']) {
    assert.equal(safeFileName(name), true, name);
  }
  for (const name of [
    '../database.dump', 'purchase-requests/../../etc/passwd',
    'offer-documents/invoice.pdf', 'offer-documents/some-file.svg',
    'attachments/' + validOffer, 'purchase-requests/' + validOffer,
    'database.dump/../evil', 'offer-documents/' + validOffer + '/other',
  ]) {
    assert.equal(safeFileName(name), false, name);
  }
  assert.equal(within('/tmp/a', '/tmp/ab'), false);
  assert.equal(within('/tmp/a', '/tmp/a/b'), true);
});

test('reject duplicate paths, unsafe references and missing DB files before restore', () => {
  const attachment = { path: 'purchase-requests/' + validPhoto, bytes: 6, sha256: digest('image!') };
  assert.doesNotThrow(() => checkManifest(manifest([attachment], [attachment.path])));
  assert.throws(() => checkManifest(manifest([], [attachment.path])), /missing/);
  assert.throws(() => checkManifest(manifest([attachment, attachment])), /Duplicate/);
  assert.throws(() => checkManifest(manifest([{ ...attachment, path: '../evil' }])), /Invalid/);
  assert.throws(() => checkManifest(manifest([{ ...attachment, sha256: 'not-a-hash' }])), /Invalid/);
});

test('backup requires an explicit writes-paused acknowledgment and strict flags', () => {
  assert.deepEqual(options(['backup', '--source-container', 'db', '--writes-paused', '--out', '/tmp/snap']), {
    verb: 'backup', values: { '--source-container': 'db', '--writes-paused': true, '--out': '/tmp/snap' },
  });
  assert.throws(() => options(['backup', '--out', '/tmp/a', '--out', '/tmp/b']), /duplicated/);
  assert.throws(() => options(['restore', '--writes-paused']), /Unsupported/);
  const output = cli('backup', '--source-container', 'supply-manager-postgres', '--out', '/tmp/core15-dont-create');
  assert.equal(output.status, 1);
  assert.match(output.stderr, /Stop API and all writers/);
});

test('verify detects a changed or truncated attachment without Docker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'core15-integrity-'));
  const filename = 'offer-documents/' + validOffer;
  try {
    await mkdir(join(root, 'offer-documents'));
    await writeFile(join(root, 'database.dump'), 'dump');
    await writeFile(join(root, filename), 'PDF mock');
    const data = manifest([{ path: filename, bytes: 8, sha256: digest('PDF mock') }], [filename]);
    await writeFile(join(root, 'manifest.json'), JSON.stringify(data));
    const ok = cli('verify', '--snapshot', root);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /VERIFY OK/);
    await writeFile(join(root, filename), 'tampered');
    const bad = cli('verify', '--snapshot', root);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /damaged or changed/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('restore rejects non-isolated target containers before touching Docker or uploads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'core15-reject-'));
  const target = join(tmpdir(), 'core15-never-create-target');
  try {
    const run = cli('restore', '--snapshot', root, '--target-container', 'supply-manager-postgres', '--target-uploads', target);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /dedicated supply-core15-restore/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
