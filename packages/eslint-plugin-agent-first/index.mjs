import noBannedApis from './rules/no-banned-apis.mjs';
import noProductComments from './rules/no-product-comments.mjs';
import noSuppressionDirectives from './rules/no-suppression-directives.mjs';

const plugin = {
  meta: {
    name: 'eslint-plugin-agent-first',
    version: '1.0.0',
  },
  rules: {
    'no-banned-apis': noBannedApis,
    'no-product-comments': noProductComments,
    'no-suppression-directives': noSuppressionDirectives,
  },
};

export default plugin;
