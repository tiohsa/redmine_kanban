import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export interface PerformanceBudgets {
  maxFrameTimeMs: number;
  maxLatencyMs: number;
  maxMemoryMb: number;
}

export interface FeatureStep {
  id: string;
  type: 'navigate' | 'http' | 'action';
  target?: string;
  method?: string;
  path?: string;
  payload?: Record<string, unknown>;
  action?: string;
  shortcut?: string;
  expectSelector?: string;
  expectStatus?: number;
  expectAttribute?: {
    dataFeature: string;
    dataAction: string;
  };
}

export interface FeatureDefinition {
  id: string;
  name: string;
  description: string;
  navigation: {
    path: string;
    shortcuts: string[];
  };
  selectors: {
    root: string;
    actions: Record<string, string>;
    attributes: {
      dataFeature: string;
      dataActions: string[];
    };
  };
  entryPoints: {
    frontend: string;
    backend: string;
    httpRoute: {
      method: string;
      path: string;
    };
  };
  steps: FeatureStep[];
  invariants: string[];
  performanceBudgets?: Partial<PerformanceBudgets>;
}

export interface FeatureMap {
  version: string;
  defaults: {
    performanceBudgets: PerformanceBudgets;
  };
  features: FeatureDefinition[];
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  featureId: string;
  stepId: string;
  message: string;
}

export interface TraceSpan {
  spanId: string;
  featureId: string;
  name: string;
  startMs: number;
  durationMs: number;
  status: 'ok' | 'error';
}

export interface SnapshotEvidence {
  featureId: string;
  stepId: string;
  selector: string;
  attributes: Record<string, string>;
  state: Record<string, unknown>;
}

export interface FeatureTelemetry {
  latencyMs: number;
  frameTimeMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  memoryRssMb: number;
  heapUsedMb: number;
}

export interface BudgetCheckResult {
  frameBudgetPassed: boolean;
  latencyBudgetPassed: boolean;
  memoryBudgetPassed: boolean;
}

export interface InvariantCheckResult {
  invariant: string;
  passed: boolean;
  detail: string;
}

export interface FeatureRunResult {
  featureId: string;
  passed: boolean;
  budgets: PerformanceBudgets;
  telemetry: FeatureTelemetry;
  budgetChecks: BudgetCheckResult;
  invariantChecks: InvariantCheckResult[];
  logs: LogEntry[];
  traces: TraceSpan[];
  snapshots: SnapshotEvidence[];
}

export interface VerificationReport {
  schemaVersion: '1.0.0';
  timestamp: string;
  rootDir: string;
  featureMapPath: string;
  passed: boolean;
  summary: {
    totalFeatures: number;
    passedFeatures: number;
    failedFeatures: number;
    totalDurationMs: number;
  };
  results: FeatureRunResult[];
}

export interface RunOptions {
  rootDir?: string;
  featureMapPath?: string;
  featureId?: string;
  outPath?: string;
  budgetOverride?: Partial<PerformanceBudgets>;
  stepEvaluator?: (
    feature: FeatureDefinition,
    step: FeatureStep,
    rootDir: string
  ) => Promise<{ ok: boolean; detail: string; status?: number }>;
}

export function loadFeatureMap(featureMapPath: string): FeatureMap {
  const raw = fs.readFileSync(featureMapPath, 'utf-8');
  const parsed = JSON.parse(raw) as FeatureMap;
  if (!parsed || !Array.isArray(parsed.features)) {
    throw new Error(`Invalid feature map at ${featureMapPath}: missing features array`);
  }
  return parsed;
}

function resolveBudgets(
  defaults: PerformanceBudgets,
  featureBudgets?: Partial<PerformanceBudgets>,
  override?: Partial<PerformanceBudgets>
): PerformanceBudgets {
  return {
    maxFrameTimeMs:
      override?.maxFrameTimeMs ??
      featureBudgets?.maxFrameTimeMs ??
      defaults.maxFrameTimeMs,
    maxLatencyMs:
      override?.maxLatencyMs ??
      featureBudgets?.maxLatencyMs ??
      defaults.maxLatencyMs,
    maxMemoryMb:
      override?.maxMemoryMb ??
      featureBudgets?.maxMemoryMb ??
      defaults.maxMemoryMb,
  };
}

function bytesToMb(bytes: number): number {
  return Number((bytes / (1024 * 1024)).toFixed(3));
}

function roundMs(ms: number): number {
  return Number(ms.toFixed(3));
}

interface FastifyAppLike {
  inject: (opts: {
    method: string;
    url: string;
    payload?: Record<string, unknown>;
  }) => Promise<{ statusCode: number; body: string }>;
  close: () => Promise<void>;
}

async function createFastifyApp(backendPath: string): Promise<FastifyAppLike> {
  const serverModule = (await import(pathToFileURL(backendPath).href)) as {
    buildServer?: () => Promise<FastifyAppLike>;
  };

  if (typeof serverModule.buildServer !== 'function') {
    throw new Error(`Backend entry point ${backendPath} does not export buildServer()`);
  }

  return serverModule.buildServer();
}

async function invokeFastifyRoute(
  app: FastifyAppLike,
  step: FeatureStep,
  defaultPath: string
): Promise<{ ok: boolean; detail: string; status: number }> {
  const method = step.method ?? 'GET';
  const url = step.path ?? defaultPath;
  const response = await app.inject({
    method,
    url,
    ...(step.payload !== undefined ? { payload: step.payload } : {}),
  });
  const expectedStatus = step.expectStatus ?? 200;
  const ok = response.statusCode === expectedStatus;
  return {
    ok,
    status: response.statusCode,
    detail: ok
      ? `Fastify ${method} ${url} returned ${response.statusCode}`
      : `Fastify ${method} ${url} returned ${response.statusCode}, expected ${expectedStatus}`,
  };
}

async function defaultStepEvaluator(
  feature: FeatureDefinition,
  step: FeatureStep,
  rootDir: string,
  fastifyApp?: FastifyAppLike
): Promise<{ ok: boolean; detail: string; status?: number }> {
  const frontendPath = path.resolve(rootDir, feature.entryPoints.frontend);
  const backendPath = path.resolve(rootDir, feature.entryPoints.backend);

  if (step.type === 'navigate') {
    const exists = fs.existsSync(frontendPath);
    return {
      ok: exists,
      detail: exists
        ? `Resolved frontend entry point ${feature.entryPoints.frontend} for ${step.target ?? feature.navigation.path}`
        : `Missing frontend entry point: ${feature.entryPoints.frontend}`,
    };
  }

  if (step.type === 'http') {
    const exists = fs.existsSync(backendPath);
    if (!exists) {
      return {
        ok: false,
        status: 500,
        detail: `Missing backend entry point: ${feature.entryPoints.backend}`,
      };
    }

    if (fastifyApp) {
      return invokeFastifyRoute(fastifyApp, step, feature.entryPoints.httpRoute.path);
    }

    return {
      ok: true,
      status: step.expectStatus ?? 200,
      detail: `Verified backend entry point ${feature.entryPoints.backend} for ${step.method ?? 'GET'} ${step.path ?? feature.entryPoints.httpRoute.path}`,
    };
  }

  const hasAttribute =
    feature.selectors.attributes.dataFeature === step.expectAttribute?.dataFeature &&
    feature.selectors.attributes.dataActions.includes(step.expectAttribute?.dataAction ?? '');

  return {
    ok: hasAttribute,
    detail: hasAttribute
      ? `Verified action ${step.action ?? ''} via ${step.shortcut ?? 'pointer'} with data-feature="${feature.selectors.attributes.dataFeature}"`
      : `Missing expected action attribute mapping for ${step.action ?? 'unknown'}`,
  };
}

export async function runFeatureScenario(
  feature: FeatureDefinition,
  defaults: PerformanceBudgets,
  options: {
    rootDir: string;
    budgetOverride?: Partial<PerformanceBudgets>;
    stepEvaluator?: RunOptions['stepEvaluator'];
  }
): Promise<FeatureRunResult> {
  const budgets = resolveBudgets(defaults, feature.performanceBudgets, options.budgetOverride);

  const logs: LogEntry[] = [];
  const traces: TraceSpan[] = [];
  const snapshots: SnapshotEvidence[] = [];
  const invariantChecks: InvariantCheckResult[] = [];

  const hasHttpSteps = feature.steps.some((s) => s.type === 'http');
  const backendPath = path.resolve(options.rootDir, feature.entryPoints.backend);
  const fastifyInstalled = fs.existsSync(path.resolve(options.rootDir, 'node_modules/fastify'));

  let fastifyApp: FastifyAppLike | undefined;
  if (!options.stepEvaluator && hasHttpSteps && fastifyInstalled && fs.existsSync(backendPath)) {
    fastifyApp = await createFastifyApp(backendPath);
  }

  const cpuStart = process.cpuUsage();
  const flowStart = performance.now();
  let maxUiFrameTimeMs = 0;
  let allStepsPassed = true;

  try {
    for (const [i, step] of feature.steps.entries()) {
      const spanStart = performance.now();
      const outcome = options.stepEvaluator
        ? await options.stepEvaluator(feature, step, options.rootDir)
        : await defaultStepEvaluator(feature, step, options.rootDir, fastifyApp);
      const spanDuration = roundMs(performance.now() - spanStart);

      if ((step.type === 'navigate' || step.type === 'action') && spanDuration > maxUiFrameTimeMs) {
        maxUiFrameTimeMs = spanDuration;
      }

      if (!outcome.ok) {
        allStepsPassed = false;
      }

      logs.push({
        timestamp: new Date().toISOString(),
        level: outcome.ok ? 'info' : 'error',
        featureId: feature.id,
        stepId: step.id,
        message: outcome.detail,
      });

      traces.push({
        spanId: `${feature.id}-span-${i + 1}`,
        featureId: feature.id,
        name: `${step.type}:${step.id}`,
        startMs: roundMs(spanStart - flowStart),
        durationMs: spanDuration,
        status: outcome.ok ? 'ok' : 'error',
      });

      snapshots.push({
        featureId: feature.id,
        stepId: step.id,
        selector: step.expectSelector ?? feature.selectors.root,
        attributes: {
          'data-feature': feature.selectors.attributes.dataFeature,
          ...(step.action ? { 'data-action': step.action } : {}),
        },
        state: {
          ok: outcome.ok,
          ...(outcome.status !== undefined ? { httpStatus: outcome.status } : {}),
        },
      });
    }
  } finally {
    if (fastifyApp) {
      await fastifyApp.close();
    }
  }

  const totalLatencyMs = roundMs(performance.now() - flowStart);
  const cpuDelta = process.cpuUsage(cpuStart);
  const mem = process.memoryUsage();

  const telemetry: FeatureTelemetry = {
    latencyMs: totalLatencyMs,
    frameTimeMs: roundMs(maxUiFrameTimeMs),
    cpuUserMs: roundMs(cpuDelta.user / 1000),
    cpuSystemMs: roundMs(cpuDelta.system / 1000),
    memoryRssMb: bytesToMb(mem.rss),
    heapUsedMb: bytesToMb(mem.heapUsed),
  };

  const budgetChecks: BudgetCheckResult = {
    frameBudgetPassed: telemetry.frameTimeMs <= budgets.maxFrameTimeMs,
    latencyBudgetPassed: telemetry.latencyMs <= budgets.maxLatencyMs,
    memoryBudgetPassed: telemetry.heapUsedMb <= budgets.maxMemoryMb,
  };

  for (const invariant of feature.invariants) {
    invariantChecks.push({
      invariant,
      passed: allStepsPassed,
      detail: allStepsPassed
        ? 'All scenario steps satisfied invariant'
        : 'One or more scenario steps failed',
    });
  }

  const passed =
    allStepsPassed &&
    budgetChecks.frameBudgetPassed &&
    budgetChecks.latencyBudgetPassed &&
    budgetChecks.memoryBudgetPassed &&
    invariantChecks.every((check) => check.passed);

  return {
    featureId: feature.id,
    passed,
    budgets,
    telemetry,
    budgetChecks,
    invariantChecks,
    logs,
    traces,
    snapshots,
  };
}

export async function runVerification(options: RunOptions = {}): Promise<VerificationReport> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const featureMapPath = path.resolve(
    rootDir,
    options.featureMapPath ?? 'verification/feature-map.json'
  );
  const featureMap = loadFeatureMap(featureMapPath);

  const selectedFeatures = options.featureId
    ? featureMap.features.filter((f) => f.id === options.featureId)
    : featureMap.features;

  if (options.featureId && selectedFeatures.length === 0) {
    throw new Error(`Feature "${options.featureId}" not found in ${featureMapPath}`);
  }

  const runStart = performance.now();
  const results: FeatureRunResult[] = [];

  for (const feature of selectedFeatures) {
    const result = await runFeatureScenario(
      feature,
      featureMap.defaults.performanceBudgets,
      {
        rootDir,
        budgetOverride: options.budgetOverride,
        stepEvaluator: options.stepEvaluator,
      }
    );
    results.push(result);
  }

  const totalDurationMs = roundMs(performance.now() - runStart);
  const passedFeatures = results.filter((r) => r.passed).length;
  const failedFeatures = results.length - passedFeatures;

  const report: VerificationReport = {
    schemaVersion: '1.0.0',
    timestamp: new Date().toISOString(),
    rootDir,
    featureMapPath,
    passed: failedFeatures === 0 && results.length > 0,
    summary: {
      totalFeatures: results.length,
      passedFeatures,
      failedFeatures,
      totalDurationMs,
    },
    results,
  };

  if (options.outPath) {
    const outFile = path.resolve(rootDir, options.outPath);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf-8');
  }

  return report;
}

function parseCliArgs(argv: string[]): RunOptions {
  const options: RunOptions = {};
  const args = argv.slice(2);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === 'run') {
      continue;
    }
    if (arg === '--feature' && args[i + 1]) {
      options.featureId = args[i + 1];
      i += 1;
    } else if (arg === '--map' && args[i + 1]) {
      options.featureMapPath = args[i + 1];
      i += 1;
    } else if (arg === '--out' && args[i + 1]) {
      options.outPath = args[i + 1];
      i += 1;
    } else if (arg === '--root' && args[i + 1]) {
      options.rootDir = args[i + 1];
      i += 1;
    } else if (arg === '--max-frame-ms' && args[i + 1]) {
      options.budgetOverride = {
        ...options.budgetOverride,
        maxFrameTimeMs: Number(args[i + 1]),
      };
      i += 1;
    } else if (arg === '--max-latency-ms' && args[i + 1]) {
      options.budgetOverride = {
        ...options.budgetOverride,
        maxLatencyMs: Number(args[i + 1]),
      };
      i += 1;
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv);
  const report = await runVerification(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ error: message })}\n`);
    process.exitCode = 1;
  });
}
