const DEFAULT_REPLACEMENTS = {
  useEffect: {
    primitive: '@framework-core/react (useManagedEffect)',
    reason: 'Raw React useEffect is banned in product code.',
  },
  useLayoutEffect: {
    primitive: '@framework-core/react (useManagedEffect)',
    reason: 'Raw React useLayoutEffect is banned in product code.',
  },
  setTimeout: {
    primitive: '@framework-core/timers (scheduleOnce)',
    reason: 'Imperative timer setTimeout is banned in product code.',
  },
  setInterval: {
    primitive: '@framework-core/timers (scheduleInterval)',
    reason: 'Imperative timer setInterval is banned in product code.',
  },
  clearTimeout: {
    primitive: '@framework-core/timers (scheduleOnce)',
    reason: 'Imperative timer clearTimeout is banned in product code.',
  },
  clearInterval: {
    primitive: '@framework-core/timers (scheduleInterval)',
    reason: 'Imperative timer clearInterval is banned in product code.',
  },
  rawSql: {
    primitive: '@framework-core/data (defineQuery, executeQuery)',
    reason: 'Raw SQL / unsafe query execution is banned in product code.',
  },
  unsafeEval: {
    primitive: '@framework-core (approved safe runtime primitive)',
    reason: 'Dynamic code evaluation is banned in product code.',
  },
  dangerouslySetInnerHTML: {
    primitive: '@framework-core/react (SafeHtml)',
    reason: 'Raw dangerouslySetInnerHTML is banned in product code.',
  },
};

const TIMER_APIS = new Set(['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval']);
const REACT_EFFECT_APIS = new Set(['useEffect', 'useLayoutEffect']);
const RAW_SQL_METHODS = new Set(['raw', '$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe', 'queryRaw', 'executeRaw']);
const TIMER_HOSTS = new Set(['globalThis', 'window', 'global', 'self']);

function formatMessage(key, customReplacements) {
  const entry = (customReplacements && customReplacements[key]) || DEFAULT_REPLACEMENTS[key];
  return `${entry.reason} Use ${entry.primitive} instead.`;
}

function getMemberPropertyName(node) {
  if (!node || node.type !== 'MemberExpression' || node.computed) {
    return null;
  }
  return node.property && node.property.type === 'Identifier' ? node.property.name : null;
}

function getMemberObjectName(node) {
  if (!node || node.type !== 'MemberExpression') {
    return null;
  }
  return node.object && node.object.type === 'Identifier' ? node.object.name : null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ban nuanced/low-level APIs in product code and direct agents to @framework-core primitives',
    },
    schema: [
      {
        type: 'object',
        properties: {
          replacements: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: {
                primitive: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['primitive', 'reason'],
            },
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const customReplacements = options.replacements || null;

    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'react') {
          return;
        }
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported &&
            specifier.imported.type === 'Identifier' &&
            REACT_EFFECT_APIS.has(specifier.imported.name)
          ) {
            context.report({
              node: specifier,
              message: formatMessage(specifier.imported.name, customReplacements),
            });
          }
        }
      },

      CallExpression(node) {
        const { callee } = node;

        if (callee.type === 'Identifier') {
          if (REACT_EFFECT_APIS.has(callee.name) || TIMER_APIS.has(callee.name)) {
            context.report({
              node,
              message: formatMessage(callee.name, customReplacements),
            });
            return;
          }
          if (callee.name === 'eval') {
            context.report({
              node,
              message: formatMessage('unsafeEval', customReplacements),
            });
            return;
          }
          if (RAW_SQL_METHODS.has(callee.name)) {
            context.report({
              node,
              message: formatMessage('rawSql', customReplacements),
            });
            return;
          }
        }

        if (callee.type === 'MemberExpression') {
          const propName = getMemberPropertyName(callee);
          const objName = getMemberObjectName(callee);

          if (objName === 'React' && propName && REACT_EFFECT_APIS.has(propName)) {
            context.report({
              node,
              message: formatMessage(propName, customReplacements),
            });
            return;
          }

          if (objName && TIMER_HOSTS.has(objName) && propName && TIMER_APIS.has(propName)) {
            context.report({
              node,
              message: formatMessage(propName, customReplacements),
            });
            return;
          }

          if (propName && RAW_SQL_METHODS.has(propName)) {
            context.report({
              node,
              message: formatMessage('rawSql', customReplacements),
            });
          }
        }
      },

      TaggedTemplateExpression(node) {
        const { tag } = node;
        if (tag.type === 'Identifier' && tag.name === 'sql') {
          context.report({
            node,
            message: formatMessage('rawSql', customReplacements),
          });
          return;
        }
        if (tag.type === 'MemberExpression') {
          const propName = getMemberPropertyName(tag);
          if (propName && RAW_SQL_METHODS.has(propName)) {
            context.report({
              node,
              message: formatMessage('rawSql', customReplacements),
            });
          }
        }
      },

      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Function') {
          context.report({
            node,
            message: formatMessage('unsafeEval', customReplacements),
          });
        }
      },

      JSXAttribute(node) {
        if (node.name && node.name.type === 'JSXIdentifier' && node.name.name === 'dangerouslySetInnerHTML') {
          context.report({
            node,
            message: formatMessage('dangerouslySetInnerHTML', customReplacements),
          });
        }
      },
    };
  },
};
