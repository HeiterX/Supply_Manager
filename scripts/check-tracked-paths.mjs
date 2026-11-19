// SM-007: conservative filename-based guard for tracked sensitive artifacts.
// Does NOT scan file contents or Git history. SM-005 covers the manual audit.
import { execFileSync } from 'node:child_process';

const tracked = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const rules = [
  {
    name: 'private environment files',
    match: (path) =>
      /(^|\/)\.env(?:$|\.)/.test(path) &&
      !/(^|\/)\.env\.example$/.test(path),
  },
  {
    name: 'database dumps and local databases',
    match: (path) => /\.(?:sql|dump|sqlite|sqlite3|db|bak)$/i.test(path),
  },
  {
    name: 'uploaded attachments',
    match: (path) =>
      path.startsWith('apps/api/uploads/') &&
      !path.endsWith('/.gitkeep'),
  },
  {
    name: 'local model weights',
    match: (path) => /\.(?:gguf|safetensors|pt|pth)$/i.test(path),
  },
];

let violations = 0;
for (const rule of rules) {
  const count = tracked.filter(rule.match).length;
  if (count) {
    // Never expose sensitive tracked paths in public CI logs.
    console.error('Found ' + count + ' tracked ' + rule.name + ' (SM-005 review).');
    violations += count;
  }
}

if (violations) {
  console.error(
    'Tracked sensitive-looking artifacts detected. Review before removing ' +
      'from tracking; rotate/revoke exposed secrets. CI does not rewrite Git history.',
  );
  process.exitCode = 1;
} else {
  console.log(
    'Checked ' + tracked.length + ' tracked paths: no prohibited filename patterns.',
  );
}
