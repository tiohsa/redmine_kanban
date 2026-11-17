export const SUPPRESSION_PATTERN =
  /\b(eslint-disable(?:-next-line|-line)?|eslint-enable)\b|@(ts-ignore|ts-expect-error|ts-nocheck)\b/;

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ban lint and type suppression directives in product code',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;

    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          const match = SUPPRESSION_PATTERN.exec(comment.value);
          if (match) {
            context.report({
              loc: comment.loc,
              message: `Lint/type suppression directive "${match[0]}" is banned in product code. Fix the underlying violation or use an approved @framework-core primitive instead.`,
            });
          }
        }
      },
    };
  },
};
