// Proves that the optional modules are removable (Blueprint A3 / A6 / A12 #5).
// For each scenario it copies src/, deletes the folders, applies the documented removal
// steps mechanically, and type-checks the result:
//   1. delete src/<module>/
//   2. remove `<Module>Module` from AppModule (and its import)
//   3. rbac only: remove the `@Permissions(...)` / `@Roles(...)` decorator lines (one line each) and their imports
// Scenarios: each module alone, then everything together. Steps are in docs/how-to/.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const tmp = '.tmp-rbac-check';

/** folder -> the Nest module class registered in AppModule */
const MODULES = {
  rbac: 'RbacModule',
  mail: 'MailModule',
  storage: 'StorageModule',
  redis: 'RedisModule',
  jobs: 'JobsModule',
};

const scenarios = [
  ...Object.keys(MODULES).map((m) => [m]),
  Object.keys(MODULES),
];
const only = process.argv.slice(2);
const selected = only.length
  ? scenarios.filter((s) => only.includes(s.join('+')))
  : scenarios;

function prepare(removed) {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  cpSync('src', join(tmp, 'src'), { recursive: true });
  for (const name of removed) {
    rmSync(join(tmp, 'src', name), { recursive: true, force: true });
  }
  writeFileSync(
    join(tmp, 'tsconfig.json'),
    JSON.stringify({
      extends: '../tsconfig.json',
      include: ['src/**/*'],
      exclude: ['src/**/*.spec.ts'],
    }),
  );

  const importFromRemoved = new RegExp(
    `^import .*['"](?:\\.{1,2}/)+(?:${removed.join('|')})/`,
  );
  const moduleEntries = new RegExp(
    `^\\s*(?:${removed.map((m) => MODULES[m]).join('|')}),?\\s*$`,
  );
  const changed = [];

  const strip = (path) => {
    const before = readFileSync(path, 'utf8');
    const after = before
      .split('\n')
      .filter(
        (line) =>
          !importFromRemoved.test(line) &&
          !moduleEntries.test(line) &&
          !(
            removed.includes('rbac') &&
            /^\s*@(Permissions|Roles)\(.*\)\s*$/.test(line)
          ),
      )
      .join('\n');
    if (after !== before)
      changed.push(path.replace(`${tmp}\\`, '').replace(`${tmp}/`, ''));
    writeFileSync(path, after);
  };
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) strip(path);
    }
  };
  walk(join(tmp, 'src'));
  return changed;
}

const tsc = require.resolve('typescript/bin/tsc');
let failed = false;

for (const removed of selected) {
  const label = removed.join(' + ');
  const changed = prepare(removed);
  const result = spawnSync(
    process.execPath,
    [tsc, '--noEmit', '-p', join(tmp, 'tsconfig.json')],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    failed = true;
    console.error(`FAIL: does not compile without ${label}`);
  } else {
    console.log(
      `OK: compiles without ${label} (edited: ${changed.join(', ') || 'nothing'})`,
    );
  }
}
rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
