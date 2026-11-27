#!/usr/bin/env node
// CORE-15 / #59: offline PostgreSQL + private attachments snapshots.
// All database operations are executed inside explicit PostgreSQL 17 Docker containers.
// This tool never connects to DATABASE_URL, changes the live schema, or reads secrets.
import { createHash, randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  chmod, copyFile, mkdir, lstat, readFile, readdir, realpath, rename, rm, stat,
} from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kinds = ['purchase-requests', 'offer-documents'];
const photoName = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:png|jpg|webp)$/i;
const offerName = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:pdf|jpg|png)$/i;
const hashPattern = /^[a-f0-9]{64}$/;
const containerPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

function assert(test, message) {
  if (!test) throw new Error(message);
}
function within(parent, candidate) {
  const diff = relative(parent, candidate);
  return diff === '' || (diff !== '..' && !diff.startsWith('..' + sep) && !isAbsolute(diff));
}
function externalPath(input) {
  assert(input && isAbsolute(input), 'Use an explicit absolute path, outside the Git checkout');
  const location = resolve(input);
  assert(!within(projectRoot, location), 'Backups and restored uploads must be outside the Git checkout');
  return location;
}
function safeFileName(relativeName) {
  if (relativeName === 'database.dump') return true;
  const parts = relativeName.split('/');
  return parts.length === 2 && (
    (parts[0] === kinds[0] && photoName.test(parts[1])) ||
    (parts[0] === kinds[1] && offerName.test(parts[1]))
  );
}
function safeContainer(name) {
  assert(name && containerPattern.test(name), 'Invalid or missing Docker container name');
  return name;
}
function options(argv) {
  const [verb, ...rest] = argv;
  assert(['backup', 'verify', 'restore'].includes(verb), 'Usage: node scripts/core15-snapshot.mjs backup|verify|restore --key value');
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    assert(key?.startsWith('--') && key.length > 2 && !Object.hasOwn(values, key), 'Invalid or duplicated option: ' + key);
    if (key === '--writes-paused') {
      values[key] = true;
      index -= 1;
    } else {
      assert(index + 1 < rest.length && !rest[index + 1].startsWith('--'), 'Missing value for ' + key);
      values[key] = rest[index + 1];
    }
  }
  const allowed = {
    backup: ['--source-container', '--uploads', '--out', '--writes-paused'],
    verify: ['--snapshot'],
    restore: ['--snapshot', '--target-container', '--target-uploads'],
  };
  for (const key of Object.keys(values)) assert(allowed[verb].includes(key), 'Unsupported option: ' + key);
  return { verb, values };
}
function dockerQuery(container, sql) {
  const command = 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"';
  return execFileSync('docker', ['exec', safeContainer(container), 'sh', '-ec', command, 'core15', sql], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function dbCounts(container) {
  const sql = 'SELECT json_build_object(' +
    "'User',(SELECT count(*) FROM public.\"User\")," +
    "'Task',(SELECT count(*) FROM public.\"Task\")," +
    "'PurchaseRequest',(SELECT count(*) FROM public.\"PurchaseRequest\")," +
    "'PurchaseRequestItem',(SELECT count(*) FROM public.\"PurchaseRequestItem\")," +
    "'SupplierOfferDocument',(SELECT count(*) FROM public.\"SupplierOfferDocument\")," +
    "'PurchaseOrder',(SELECT count(*) FROM public.\"PurchaseOrder\")," +
    "'Invoice',(SELECT count(*) FROM public.\"Invoice\")," +
    "'Payment',(SELECT count(*) FROM public.\"Payment\")" +
    ')::text';
  return JSON.parse(dockerQuery(container, sql));
}
function dbReferences(container) {
  const sql = 'SELECT name FROM (' +
    'SELECT \'purchase-requests/\' || "photoPath" AS name FROM public."PurchaseRequestItem" WHERE "photoPath" IS NOT NULL ' +
    'UNION ALL SELECT \'offer-documents/\' || "storageName" AS name FROM public."SupplierOfferDocument"' +
    ') AS files ORDER BY name';
  const lines = dockerQuery(container, sql);
  return lines ? lines.split('\n') : [];
}
async function sha256(filePath) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest('hex');
}
async function regularFile(filePath) {
  const info = await lstat(filePath);
  assert(info.isFile() && !info.isSymbolicLink(), 'Refusing a non-regular file or symlink: ' + filePath);
  return info;
}
async function dockerStream(container, action, archive) {
  const pg = action === 'dump'
    ? 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --schema=public --format=custom --no-owner --no-acl'
    : action === 'inspect'
      ? 'exec pg_restore --list'
      : 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl --exit-on-error';
  const child = spawn('docker', ['exec', ...(action === 'dump' ? [] : ['-i']), safeContainer(container), 'sh', '-ec', pg], {
    stdio: [action === 'dump' ? 'ignore' : 'pipe', action === 'dump' ? 'pipe' : 'ignore', 'pipe'],
  });
  let message = '';
  child.stderr.on('data', chunk => { message = (message + String(chunk)).slice(-800); });
  const result = new Promise((ok, fail) => {
    child.on('error', fail);
    child.on('close', code => code === 0 ? ok() : fail(new Error('Docker PostgreSQL command failed: ' + message)));
  });
  try {
    await Promise.all([
      action === 'dump'
        ? pipeline(child.stdout, createWriteStream(archive, { flags: 'wx', mode: 0o600 }))
        : pipeline(createReadStream(archive), child.stdin),
      result,
    ]);
  } catch (error) {
    child.kill();
    throw error;
  }
}
function checkManifest(manifest) {
  assert(manifest && manifest.format === 'supply-manager-core15-v1' &&
    manifest.database === 'supply_manager' && manifest.schema === 'public' &&
    Array.isArray(manifest.files) && Array.isArray(manifest.references) &&
    manifest.counts && typeof manifest.counts === 'object', 'Unsupported or incomplete manifest');
  const names = new Set();
  for (const entry of manifest.files) {
    assert(entry && typeof entry.path === 'string' && safeFileName(entry.path) &&
      Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 &&
      typeof entry.sha256 === 'string' && hashPattern.test(entry.sha256),
      'Invalid file metadata in snapshot');
    assert(!names.has(entry.path), 'Duplicate snapshot path: ' + entry.path);
    names.add(entry.path);
  }
  assert(names.has('database.dump'), 'Snapshot database.dump is missing');
  for (const ref of manifest.references) {
    assert(typeof ref === 'string' && safeFileName(ref) && ref !== 'database.dump' && names.has(ref),
      'Snapshot is missing a database-referenced attachment');
  }
  for (const count of Object.values(manifest.counts)) {
    assert(Number.isSafeInteger(count) && count >= 0, 'Invalid row count in manifest');
  }
  return manifest;
}
async function verify(snapshot) {
  const folder = resolve(snapshot);
  const info = await lstat(folder);
  assert(info.isDirectory() && !info.isSymbolicLink(), 'Snapshot directory must be a real directory');
  const manifest = checkManifest(JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')));
  for (const file of manifest.files) {
    const target = join(folder, ...file.path.split('/'));
    const statInfo = await regularFile(target);
    assert(statInfo.size === file.bytes && await sha256(target) === file.sha256,
      'Snapshot file damaged or changed: ' + file.path);
  }
  return manifest;
}
async function inventory(sourceUploads, destination) {
  const entries = [];
  for (const kind of kinds) {
    const source = join(sourceUploads, kind);
    let found;
    try { found = await lstat(source); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    assert(found.isDirectory() && !found.isSymbolicLink(), 'Uploads kind must be a normal directory: ' + kind);
    const names = await readdir(source);
    if (names.length) await mkdir(join(destination, kind), { mode: 0o700 });
    for (const name of names) {
      const rel = kind + '/' + name;
      assert(safeFileName(rel), 'Unexpected attachment filename; manual inventory needed: ' + rel);
      const original = join(source, name);
      await regularFile(original);
      const dest = join(destination, kind, name);
      await copyFile(original, dest);
      await chmod(dest, 0o600);
      const info = await regularFile(dest);
      entries.push({ path: rel, bytes: info.size, sha256: await sha256(dest) });
    }
  }
  return entries;
}
async function backup(flags) {
  assert(flags['--writes-paused'] === true,
    'Stop API and all writers first, then explicitly pass --writes-paused for a consistent DB + files snapshot');
  const source = safeContainer(flags['--source-container']);
  const uploads = resolve(flags['--uploads'] || join(projectRoot, 'apps/api/uploads'));
  const out = externalPath(flags['--out']);
  assert(dockerQuery(source, 'SELECT current_database()') === 'supply_manager',
    'Source container must use the expected supply_manager database');
  assert(dockerQuery(source, 'SHOW server_version').startsWith('17.'),
    'Expected PostgreSQL 17 on the source container');
  const references = dbReferences(source);
  for (const ref of references) assert(safeFileName(ref) && ref !== 'database.dump', 'Unsafe reference in the database');
  const counts = dbCounts(source);
  await mkdir(out, { recursive: true, mode: 0o700 });
  const outInfo = await lstat(out);
  assert(outInfo.isDirectory() && !outInfo.isSymbolicLink() && (outInfo.mode & 0o077) === 0,
    'Backup root must be a private directory (chmod 700)');
  const id = 'core15-' + new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-') +
    '-' + randomBytes(4).toString('hex');
  const stage = join(out, '.partial-' + id);
  const ready = join(out, id);
  await mkdir(stage, { mode: 0o700 });
  try {
    const dump = join(stage, 'database.dump');
    await dockerStream(source, 'dump', dump);
    const info = await regularFile(dump);
    const files = [{ path: 'database.dump', bytes: info.size, sha256: await sha256(dump) }];
    files.push(...await inventory(uploads, stage));
    files.sort((a, b) => a.path.localeCompare(b.path));
    const actual = new Set(files.map(x => x.path));
    for (const ref of references) assert(actual.has(ref), 'Attachment referenced by DB is missing: ' + ref);
    // Verify that the source did not change while dumping/copying (best effort; writes must remain paused).
    assert(JSON.stringify(dbCounts(source)) === JSON.stringify(counts) &&
      JSON.stringify(dbReferences(source)) === JSON.stringify(references),
      'Source changed during backup; stop writes and retry');
    await dockerStream(source, 'inspect', dump);
    const manifest = {
      format: 'supply-manager-core15-v1', createdAt: new Date().toISOString(),
      database: 'supply_manager', schema: 'public', pgMajor: 17,
      counts, references, files,
      consistency: 'API and all other writers explicitly paused by operator',
    };
    await (await import('node:fs/promises')).writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await verify(stage);
    await rename(stage, ready);
    console.log('BACKUP OK:', ready);
    console.log('Files:', files.length - 1, 'DB rows (key tables):', counts);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
async function restore(flags) {
  const snapshot = externalPath(flags['--snapshot']);
  const targetUploads = externalPath(flags['--target-uploads']);
  const target = safeContainer(flags['--target-container']);
  assert(/^supply-core15-restore(?:-[a-z0-9-]+)?$/.test(target),
    'Restore is allowed only in a dedicated supply-core15-restore* container');
  assert(targetUploads !== snapshot && !within(snapshot, targetUploads) && !within(targetUploads, snapshot),
    'Restore uploads and snapshot must be separate');
  try {
    await lstat(targetUploads);
    throw new Error('Target uploads directory already exists; refusing to overwrite files');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const manifest = await verify(snapshot);
  assert(dockerQuery(target, 'SELECT current_database()') === 'supply_core15_restore',
    'Restore container must use a separate supply_core15_restore database');
  assert(dockerQuery(target, 'SHOW server_version').startsWith('17.'),
    'Restore container must use PostgreSQL 17');
  assert(dockerQuery(target, "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public'") === '0',
    'Target database already has tables; refusing to overwrite');
  // pg_dump -n public emits CREATE SCHEMA public. A new PostgreSQL 17 database
  // already has this empty schema, so remove it WITHOUT CASCADE before restore.
  // This is allowed only after the isolated container/name/database/emptiness guards.
  // Any unexpected object or dependency makes DROP fail rather than deleting data.
  dockerQuery(target, 'DROP SCHEMA public');
  await mkdir(dirname(targetUploads), { recursive: true });
  const stage = targetUploads + '.partial-' + randomBytes(4).toString('hex');
  await mkdir(stage, { mode: 0o700 });
  try {
    for (const kind of kinds) await mkdir(join(stage, kind), { mode: 0o700 });
    for (const file of manifest.files.filter(row => row.path !== 'database.dump')) {
      const from = join(snapshot, ...file.path.split('/'));
      const to = join(stage, ...file.path.split('/'));
      await copyFile(from, to);
      await chmod(to, 0o600);
      assert(await sha256(to) === file.sha256, 'Restore copy damaged: ' + file.path);
    }
    await dockerStream(target, 'restore', join(snapshot, 'database.dump'));
    assert(JSON.stringify(dbCounts(target)) === JSON.stringify(manifest.counts),
      'Restored DB record counts do not match backup');
    assert(JSON.stringify(dbReferences(target)) === JSON.stringify(manifest.references),
      'Restored attachment references differ from backup');
    await rename(stage, targetUploads);
    console.log('RESTORE OK into ISOLATED database supply_core15_restore and directory:', targetUploads);
    console.log('Next: start a separate API pointing to 127.0.0.1:55443, verify authenticated downloads');
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
export { options, safeFileName, checkManifest, within };
async function main() {
  const { verb, values } = options(process.argv.slice(2));
  if (verb === 'backup') return backup(values);
  if (verb === 'restore') return restore(values);
  assert(values['--snapshot'], 'Missing --snapshot');
  const manifest = await verify(externalPath(values['--snapshot']));
  console.log('VERIFY OK:', manifest.files.length - 1, 'attachments,', manifest.createdAt);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('CORE-15 snapshot:', error.message); process.exitCode = 1; });
}
