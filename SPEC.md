# SPEC: Generic Agent-First Application Framework

## 1. Goal
- Establish a stack-agnostic, convention- and static-analysis-driven application architecture where the shortest implementation path for an AI coding agent is automatically the safest, cleanest, and most maintainable path.
- Minimize reliance on prose instructions (`AGENTS.md`) by enforcing execution boundaries, feature colocation, API restrictions, and runtime verification through deterministic CI gates.

## 2. Non-goals / Out-of-scope
- Lock-in to a specific UI framework, programming language, or cloud provider.
- Supporting multiple competing implementation patterns or permissive plugin hooks (each problem domain must expose one canonical path).
- Relying on line-by-line manual human code review as the primary defect-detection mechanism for routine product changes.

## 3. Acceptance Criteria
- [ ] **Happy Path (Execution Layer & Feature Boundary Enforcement):** Dependency graph analysis fails CI (exit code `1`) if separated runtime layers import each other directly outside `contracts/`, or if one feature imports `internal/` modules from another feature.
- [ ] **Happy Path (Nuanced API Isolation & Guided Lints):** Using banned low-level or nuance-heavy APIs (such as raw effect hooks, imperative timers, raw SQL, or unsafe blocks) in product code triggers a static lint error whose message specifies the approved `framework-core` replacement primitive.
- [ ] **Happy Path (Comment & Suppression Ban):** Explanatory code comments and lint/type suppression directives (`eslint-disable`, `@ts-ignore`, etc.) are rejected in product code, while `packages/framework-core/` is explicitly exempted for wrapping low-level APIs.
- [ ] **Happy Path (Feature Map & Single Verification CLI):** Every user-facing feature is registered in `verification/feature-map.json`, and running a single CLI command (`verify run`) launches the target in isolation, drives user flows, captures structured JSON evidence (logs, traces, screenshots), and exits `0` only when all invariants pass.
- [ ] **Security / Anti-Tampering:** Unauthorized modifications by agents to `architecture.config.json`, linter configs, or `verification/` harness files fail CI unless explicitly approved by a human code owner.
- [ ] **Performance Telemetry:** The runtime verification driver records execution latency, CPU/memory metrics, and UI frame budget compliance (e.g., <= 16ms per frame), failing the check on threshold regressions.
- [ ] **Boundary Case (Ratchet Mode & Golden Sample):** Repositories include at least one compliant reference feature (`features/reference-example/`), and legacy repositories support baseline ratcheting that blocks 100% of new violations while permitting incremental cleanup.
- [ ] **Boundary Case (Blind Skill & Verification Evals):** Agent workflows and feature maps can be evaluated inside anonymized directories using an independent judge model to prevent evaluation detection and self-assessment bias.

## 4. Public Contract & Directory Schema

```text
├── packages/
│   └── framework-core/         # Sole location allowed to wrap low-level/nuanced APIs
├── layers/
│   ├── <runtime-a>/            # e.g., frontend / renderer / api-gateway
│   │   ├── entry-points/       # Top-level routes, screens, or command handlers
│   │   └── features/           # One directory per feature (strict colocation)
│   │       ├── reference-example/
│   │       └── <feature-id>/
│   │           ├── index.*     # Sole public interface for cross-feature usage
│   │           └── internal/   # Private implementation details
│   └── <runtime-b>/            # e.g., backend / main-process / worker
├── contracts/                  # Shared schemas, types, and typed IPC/RPC channels
├── verification/
│   ├── feature-map.json        # User-perspective feature, shortcut, and selector map
│   └── driver-cli.*            # Deterministic runtime execution & telemetry CLI
├── architecture.config.json    # Declarative layer, colocation, and banned-API config
└── AGENTS.md                   # Minimal workflow and single-command verification guide
```

## 5. Constraints
- **Determinism Over Prose:** Any review correction repeated two or more times must be promoted from documentation into a static lint rule, type constraint, or safer `framework-core` API.
- **Self-Healing Diagnostics:** Every static check failure must output actionable remediation guidance pointing directly to the supported API or module boundary.
- **Protected Infrastructure:** Deployment manifests, database migrations, and guardrail definitions require human review and are excluded from autonomous auto-merge.

## 6. Required Tests
- **Unit (Static Guardrails):** Verify layer-crossing imports, cross-feature internal imports, banned APIs, comments, and suppression directives fail with exit code `1`, while `packages/framework-core/` passes.
- **Integration / E2E (Verification Driver):** Verify `driver-cli` executes all `feature-map.json` scenarios and outputs valid structured JSON reports with performance telemetry.
- **Regression:** Verify the unified gate command (`verify:all`) passes cleanly on the reference implementation with exit code `0`.
