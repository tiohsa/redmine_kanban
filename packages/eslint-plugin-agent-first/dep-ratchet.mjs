import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const mode = process.argv.includes('--update') ? 'update' : 'check';
const rootDir = process.cwd();
const baselineFile = path.join(rootDir, '.dependency-cruiser-known-violations.json');
const targets = ['layers', 'packages', 'contracts'].filter((dir) => existsSync(path.join(rootDir, dir)));

if (targets.length === 0) {
  process.exit(0);
}

const args =
  mode === 'update'
    ? [
        'depcruise',
        '--config',
        '.dependency-cruiser.cjs',
        '--output-type',
        'baseline',
        '--output-to',
        baselineFile,
        ...targets,
      ]
    : [
        'depcruise',
        '--config',
        '.dependency-cruiser.cjs',
        ...(existsSync(baselineFile) ? ['--ignore-known', baselineFile] : []),
        ...targets,
      ];

const result = spawnSync('npx', args, {
  cwd: rootDir,
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
