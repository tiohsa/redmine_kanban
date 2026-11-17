import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadFeatureMap,
  runVerification,
  type VerificationReport,
} from '../../verification/driver-cli';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const featureMapPath = path.join(repoRoot, 'verification/feature-map.json');
const cliPath = path.join(repoRoot, 'verification/driver-cli.ts');
const tsxBin = path.join(repoRoot, 'node_modules/.bin/tsx');

describe('verification/feature-map.json', () => {
  it('registers reference-example with navigation, selectors, entry points, invariants, and budgets', () => {
    const map = loadFeatureMap(featureMapPath);
    expect(map.defaults.performanceBudgets.maxFrameTimeMs).toBe(16);

    const ref = map.features.find((f) => f.id === 'reference-example');
    expect(ref).toBeDefined();
    expect(ref?.navigation.path).toBe('/reference-example');
    expect(ref?.navigation.shortcuts).toContain('Alt+R');
    expect(ref?.selectors.attributes.dataFeature).toBe('reference-example');
    expect(ref?.selectors.attributes.dataActions).toEqual(
      expect.arrayContaining(['input-title', 'create-item', 'refresh-items'])
    );
    expect(ref?.entryPoints.frontend).toContain('layers/frontend/');
    expect(ref?.entryPoints.backend).toContain('layers/backend/');
    expect(ref?.invariants.length).toBeGreaterThan(0);
    expect(ref?.performanceBudgets?.maxFrameTimeMs).toBe(16);
  });
});

describe('verification/driver-cli.ts', () => {
  it('executes all feature-map.json scenarios and outputs structured JSON with telemetry', async () => {
    const report = await runVerification({ rootDir: repoRoot });

    expect(report.schemaVersion).toBe('1.0.0');
    expect(report.passed).toBe(true);
    expect(report.summary.totalFeatures).toBeGreaterThanOrEqual(1);
    expect(report.summary.passedFeatures).toBe(report.summary.totalFeatures);
    expect(report.summary.failedFeatures).toBe(0);

    const refResult = report.results.find((r) => r.featureId === 'reference-example');
    expect(refResult).toBeDefined();
    expect(refResult?.passed).toBe(true);
    expect(refResult?.telemetry.latencyMs).toBeGreaterThanOrEqual(0);
    expect(refResult?.telemetry.frameTimeMs).toBeGreaterThanOrEqual(0);
    expect(refResult?.telemetry.heapUsedMb).toBeGreaterThan(0);
    expect(refResult?.telemetry.memoryRssMb).toBeGreaterThan(0);
    expect(refResult?.budgetChecks).toEqual({
      frameBudgetPassed: true,
      latencyBudgetPassed: true,
      memoryBudgetPassed: true,
    });
    expect(refResult?.logs.length).toBeGreaterThan(0);
    expect(refResult?.traces.length).toBeGreaterThan(0);
    expect(refResult?.snapshots.length).toBeGreaterThan(0);
  });

  it('fails verification when performance budgets are exceeded', async () => {
    const report = await runVerification({
      rootDir: repoRoot,
      budgetOverride: {
        maxFrameTimeMs: -1,
        maxLatencyMs: -1,
      },
    });

    expect(report.passed).toBe(false);
    expect(report.summary.failedFeatures).toBe(1);
    expect(report.results[0]?.budgetChecks.frameBudgetPassed).toBe(false);
    expect(report.results[0]?.budgetChecks.latencyBudgetPassed).toBe(false);
  });

  it('fails verification when a scenario step invariant fails', async () => {
    const report = await runVerification({
      rootDir: repoRoot,
      stepEvaluator: async () => ({
        ok: false,
        status: 500,
        detail: 'Simulated invariant failure',
      }),
    });

    expect(report.passed).toBe(false);
    expect(report.results[0]?.passed).toBe(false);
    expect(report.results[0]?.invariantChecks.every((c) => c.passed === false)).toBe(true);
  });

  it('exits 0 on success and 1 on budget failure via CLI', () => {
    const stdout = execFileSync(tsxBin, [cliPath, 'run'], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    const parsed = JSON.parse(stdout) as VerificationReport;
    expect(parsed.passed).toBe(true);
    expect(parsed.results.length).toBeGreaterThanOrEqual(1);

    let failedExitCode = 0;
    try {
      execFileSync(tsxBin, [cliPath, 'run', '--max-latency-ms', '-1'], {
        cwd: repoRoot,
        encoding: 'utf-8',
      });
    } catch (error: unknown) {
      const err = error as { status?: number; stdout?: string };
      failedExitCode = err.status ?? 0;
      const failReport = JSON.parse(err.stdout ?? '{}') as VerificationReport;
      expect(failReport.passed).toBe(false);
    }
    expect(failedExitCode).toBe(1);
  });
});
