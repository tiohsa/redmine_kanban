/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-frontend-to-backend',
      severity: 'error',
      comment:
        'Direct imports from layers/frontend to layers/backend are forbidden. Communicate exclusively through contracts/.',
      from: {
        path: '^layers/frontend/',
      },
      to: {
        path: '^layers/backend/',
      },
    },
    {
      name: 'no-backend-to-frontend',
      severity: 'error',
      comment:
        'Direct imports from layers/backend to layers/frontend are forbidden. Communicate exclusively through contracts/.',
      from: {
        path: '^layers/backend/',
      },
      to: {
        path: '^layers/frontend/',
      },
    },
    {
      name: 'no-cross-feature-internal-imports',
      severity: 'error',
      comment:
        'Cross-feature imports targeting internal/ are forbidden. Import from the feature public index.ts instead.',
      from: {
        path: '^(layers/[^/]+/features/[^/]+)/',
      },
      to: {
        path: '^layers/[^/]+/features/[^/]+/internal/',
        pathNot: '^$1/internal/',
      },
    },
    {
      name: 'no-entrypoint-to-feature-internal',
      severity: 'error',
      comment:
        'Entry points must import features via their public index.ts, never from internal/.',
      from: {
        path: '^layers/[^/]+/entry-points/',
      },
      to: {
        path: '^layers/[^/]+/features/[^/]+/internal/',
      },
    },
    {
      name: 'no-framework-core-to-layers',
      severity: 'error',
      comment:
        'packages/framework-core must remain layer-agnostic and cannot import from layers/.',
      from: {
        path: '^packages/framework-core/',
      },
      to: {
        path: '^layers/',
      },
    },
    {
      name: 'no-contracts-to-layers',
      severity: 'error',
      comment: 'contracts/ must remain independent and cannot import from layers/.',
      from: {
        path: '^contracts/',
      },
      to: {
        path: '^layers/',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: {
      path: '^(app|assets|config|db|docs|e2e|frontend|lib|script|test|test-results|website|verification|node_modules)/',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
