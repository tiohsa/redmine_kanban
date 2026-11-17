import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function createEslint() {
  return new ESLint({
    cwd: repoRoot,
    overrideConfigFile: path.join(repoRoot, 'eslint.config.mjs'),
  });
}

async function lintTextSingle(code: string, relativePath: string) {
  const eslint = createEslint();
  const results = await eslint.lintText(code, {
    filePath: path.join(repoRoot, relativePath),
  });
  const first = results[0];
  if (!first) {
    throw new Error(`Expected ESLint result for ${relativePath}`);
  }
  return first;
}

function runEslintCliStdin(code: string, virtualFilePath: string) {
  const eslintBin = path.join(repoRoot, 'node_modules', '.bin', 'eslint');
  return spawnSync(eslintBin, ['--stdin', '--stdin-filename', virtualFilePath], {
    cwd: repoRoot,
    input: code,
    encoding: 'utf8',
  });
}

describe('ESLint static guardrails', () => {
  it('rejects raw React useEffect and instructs using @framework-core/react useManagedEffect', async () => {
    const result = await lintTextSingle(
      `import { useEffect } from 'react';\nexport function Demo() {\n  useEffect(() => {}, []);\n  return null;\n}\n`,
      'layers/frontend/features/demo/internal/Demo.tsx',
    );
    expect(result.errorCount).toBeGreaterThan(0);
    const messages = result.messages.map((m) => m.message).join('\n');
    expect(messages).toContain('@framework-core/react');
    expect(messages).toContain('useManagedEffect');
  });

  it('rejects imperative timers and instructs using @framework-core/timers primitives', async () => {
    const result = await lintTextSingle(
      `export function runLater(fn: () => void) {\n  setTimeout(fn, 100);\n  setInterval(fn, 1000);\n}\n`,
      'layers/backend/features/demo/internal/timers.ts',
    );
    expect(result.errorCount).toBe(2);
    const messages = result.messages.map((m) => m.message).join('\n');
    expect(messages).toContain('@framework-core/timers');
    expect(messages).toContain('scheduleOnce');
    expect(messages).toContain('scheduleInterval');
  });

  it('rejects raw SQL calls and instructs using @framework-core/data primitives', async () => {
    const result = await lintTextSingle(
      `export function loadUsers(db: { raw: (q: string) => unknown }) {\n  return db.raw('SELECT * FROM users');\n}\n`,
      'layers/backend/features/demo/internal/repo.ts',
    );
    expect(result.errorCount).toBe(1);
    const firstMessage = result.messages[0];
    expect(firstMessage).toBeDefined();
    expect(firstMessage?.message).toContain('@framework-core/data');
    expect(firstMessage?.message).toContain('executeQuery');
  });

  it('rejects explanatory comments in product code (layers/** and contracts/**)', async () => {
    const layerResult = await lintTextSingle(
      `// explanatory comment\nexport const value = 1;\n`,
      'layers/frontend/features/demo/index.ts',
    );
    const contractResult = await lintTextSingle(
      `/* block comment */\nexport interface DemoPayload { id: string; }\n`,
      'contracts/demo.ts',
    );
    expect(layerResult.errorCount).toBeGreaterThan(0);
    expect(contractResult.errorCount).toBeGreaterThan(0);
  });

  it('rejects lint and type suppression directives in product code', async () => {
    const result = await lintTextSingle(
      [
        '// eslint-disable-next-line no-console',
        '/* eslint-disable */',
        '// @ts-ignore',
        '// @ts-expect-error',
        '// @ts-nocheck',
        'export const x = 1;',
      ].join('\n'),
      'layers/backend/features/demo/index.ts',
    );
    expect(result.errorCount).toBeGreaterThanOrEqual(5);
  });

  it('exits with code 1 via ESLint CLI on product code violations', () => {
    const res = runEslintCliStdin(
      `// comment not allowed\nsetTimeout(() => {}, 10);\n`,
      'layers/frontend/features/demo/internal/bad.ts',
    );
    expect(res.status).toBe(1);
  });

  it('explicitly exempts packages/framework-core/** from API, comment, and suppression bans', () => {
    const res = runEslintCliStdin(
      [
        '// Low-level wrapper permitted in framework-core',
        '// @ts-expect-error intentional wrapper test',
        'export function wrapTimer(fn: () => void, ms: number) {',
        '  return setTimeout(fn, ms);',
        '}',
      ].join('\n'),
      'packages/framework-core/timers-wrapper.ts',
    );
    expect(res.status).toBe(0);
  });
});
