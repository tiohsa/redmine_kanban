import { SUPPRESSION_PATTERN } from './no-suppression-directives.mjs';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ban explanatory code comments in product code',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;

    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          if (SUPPRESSION_PATTERN.test(comment.value)) {
            continue;
          }
          context.report({
            loc: comment.loc,
            message:
              'Explanatory code comments are banned in product code. Express intent through clear naming, strict types, and @framework-core primitives instead.',
          });
        }
      },
    };
  },
};
