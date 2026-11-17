import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const depcruiseBin = path.join(repoRoot, 'node_modules', '.bin', 'depcruise');
const configPath = path.join(repoRoot, '.dependency-cruiser.cjs');

const tempDirs: string[] = [];

function createFixture(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'depcruise-guardrail-'));
  tempDirs.push(dir);

  const allFiles: Record<string, string> = {
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
      },
    }),
    ...files,
  };

  for (const [relPath, content] of Object.entries(allFiles)) {
    const absPath = path.join(dir, relPath);
    mkdirSync(path.dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, 'utf8');
  }

  return dir;
}

function runDepcruise(cwd: string, extraArgs: string[] = []) {
  const targets = ['layers', 'packages', 'contracts'].filter((d) =>
    existsSync(path.join(cwd, d)),
  );
  return spawnSync(
    depcruiseBin,
    ['--config', configPath, '--no-cache', ...extraArgs, ...targets],
    {
      cwd,
      encoding: 'utf8',
    },
  );
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('dependency-cruiser static guardrails', () => {
  it('rejects direct imports from layers/frontend to layers/backend with exit code 1', () => {
    const dir = createFixture({
      'contracts/index.ts': 'export const CONTRACT = true;\n',
      'packages/framework-core/index.ts': 'export const CORE = true;\n',
      'layers/backend/features/alpha/index.ts': 'export const backendFn = () => 1;\n',
      'layers/frontend/features/alpha/index.ts':
        "import { backendFn } from '../../../backend/features/alpha/index';\nexport const ui = backendFn();\n",
    });

    const res = runDepcruise(dir);
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toContain('no-frontend-to-backend');
  });

  it('rejects direct imports from layers/backend to layers/frontend with exit code 1', () => {
    const dir = createFixture({
      'contracts/index.ts': 'export const CONTRACT = true;\n',
      'packages/framework-core/index.ts': 'export const CORE = true;\n',
      'layers/frontend/features/alpha/index.ts': 'export const ui = 1;\n',
      'layers/backend/features/alpha/index.ts':
        "import { ui } from '../../../frontend/features/alpha/index';\nexport const server = ui;\n",
    });

    const res = runDepcruise(dir);
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toContain('no-backend-to-frontend');
  });

  it('rejects cross-feature imports targeting features/<other>/internal/ with exit code 1', () => {
    const dir = createFixture({
      'contracts/index.ts': 'export const CONTRACT = true;\n',
      'packages/framework-core/index.ts': 'export const CORE = true;\n',
      'layers/frontend/features/beta/internal/secret.ts': 'export const secret = 42;\n',
      'layers/frontend/features/alpha/index.ts':
        "import { secret } from '../beta/internal/secret';\nexport const leaked = secret;\n",
    });

    const res = runDepcruise(dir);
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toContain('no-cross-feature-internal-imports');
  });

  it('rejects packages/framework-core importing from layers/ with exit code 1', () => {
    const dir = createFixture({
      'contracts/index.ts': 'export const CONTRACT = true;\n',
      'layers/frontend/features/alpha/index.ts': 'export const alpha = 1;\n',
      'packages/framework-core/index.ts':
        "import { alpha } from '../../layers/frontend/features/alpha/index';\nexport const bad = alpha;\n",
    });

    const res = runDepcruise(dir);
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toContain('no-framework-core-to-layers');
  });

  it('passes with exit code 0 when layers communicate via contracts/ and features use public index.ts', () => {
    const dir = createFixture({
      'contracts/index.ts': 'export interface Item { id: string; }\n',
      'packages/framework-core/index.ts': 'export const safeRun = () => true;\n',
      'layers/frontend/features/beta/index.ts': 'export const betaPublic = 1;\n',
      'layers/frontend/features/alpha/internal/helper.ts': 'export const helper = 2;\n',
      'layers/frontend/features/alpha/index.ts': [
        "import type { Item } from '../../../../contracts/index';",
        "import { safeRun } from '../../../../packages/framework-core/index';",
        "import { betaPublic } from '../beta/index';",
        "import { helper } from './internal/helper';",
        'export const alpha = { safeRun, betaPublic, helper };',
        'export type AlphaItem = Item;',
      ].join('\n'),
      'layers/backend/features/alpha/index.ts': [
        "import type { Item } from '../../../../contracts/index';",
        "import { safeRun } from '../../../../packages/framework-core/index';",
        'export const backendAlpha = { safeRun };',
        'export type BackendItem = Item;',
      ].join('\n'),
    });

    const res = runDepcruise(dir);
    expect(res.status).toBe(0);
  });

  it('supports ratchet/baseline mode: ignores recorded baseline violations but fails on new ones', () => {
    const dir = createFixture({
      'contracts/index.ts': 'export const CONTRACT = true;\n',
      'packages/framework-core/index.ts': 'export const CORE = true;\n',
      'layers/backend/features/alpha/index.ts': 'export const backendFn = () => 1;\n',
      'layers/frontend/features/alpha/index.ts':
        "import { backendFn } from '../../../backend/features/alpha/index';\nexport const ui = backendFn();\n",
    });

    const baselinePath = path.join(dir, '.dependency-cruiser-known-violations.json');
    const genBaseline = runDepcruise(dir, ['--output-type', 'baseline', '--output-to', baselinePath]);
    expect(genBaseline.status).toBe(0);

    const passWithBaseline = runDepcruise(dir, ['--ignore-known', baselinePath]);
    expect(passWithBaseline.status).toBe(0);

    writeFileSync(
      path.join(dir, 'packages/framework-core/index.ts'),
      "import { backendFn } from '../../layers/backend/features/alpha/index';\nexport const bad = backendFn;\n",
      'utf8',
    );

    const failOnNewViolation = runDepcruise(dir, ['--ignore-known', baselinePath]);
    expect(failOnNewViolation.status).toBe(1);
    expect(failOnNewViolation.stdout + failOnNewViolation.stderr).toContain('no-framework-core-to-layers');
  });
});
