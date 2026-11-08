// Curated stylelint config for the css-audit skill. It deliberately skips
// formatting/stylistic rules (that is Prettier's job) and focuses on:
//   error   = correctness: invalid or ignored CSS, typos, dead declarations
//   warning = maintainability: specificity wars, !important, prefixes, legacy hacks
// Projects can pass --config <file> to use their own config instead.
import postcssScss from 'postcss-scss';

const warn = (value = true, extra = {}) => [value, { severity: 'warning', ...extra }];

export default {
  rules: {
    // --- correctness (errors)
    'annotation-no-unknown': true,
    'at-rule-no-unknown': [true, { ignoreAtRules: ['tailwind', 'apply', 'layer', 'config', 'theme', 'utility', 'variant', 'custom-variant', 'source', 'plugin', 'use', 'forward', 'include', 'mixin', 'extend', 'if', 'else', 'each', 'for', 'function', 'return', 'content'] }],
    'block-no-empty': true,
    'color-no-invalid-hex': true,
    'custom-property-no-missing-var-function': true,
    'declaration-block-no-duplicate-custom-properties': true,
    'declaration-block-no-duplicate-properties': [true, { ignore: ['consecutive-duplicates-with-different-syntaxes'] }],
    'declaration-block-no-shorthand-property-overrides': true,
    'declaration-property-value-no-unknown': true,
    'font-family-no-duplicate-names': true,
    'font-family-no-missing-generic-family-keyword': true,
    'function-calc-no-unspaced-operator': true,
    'keyframe-block-no-duplicate-selectors': true,
    'keyframe-declaration-no-important': true,
    'media-feature-name-no-unknown': true,
    'media-query-no-invalid': true,
    'named-grid-areas-no-invalid': true,
    'no-duplicate-at-import-rules': true,
    'no-invalid-double-slash-comments': true,
    'no-invalid-position-at-import-rule': true,
    'no-irregular-whitespace': true,
    'no-unknown-animations': true,
    'property-no-unknown': true,
    'selector-anb-no-unmatchable': true,
    'selector-pseudo-class-no-unknown': true,
    'selector-pseudo-element-no-unknown': true,
    'selector-type-no-unknown': [true, { ignore: ['custom-elements'] }],
    'string-no-newline': true,
    'unit-no-unknown': true,

    // --- maintainability (warnings)
    'declaration-no-important': warn(),
    'selector-max-id': warn(0),
    'selector-max-specificity': warn('0,3,0'),
    'selector-max-compound-selectors': warn(3),
    'max-nesting-depth': warn(3, { ignore: ['pseudo-classes'] }),
    'selector-no-qualifying-type': warn(true, { ignore: ['attribute'] }),
    'no-descending-specificity': warn(),
    'no-duplicate-selectors': warn(),
    'declaration-block-no-redundant-longhand-properties': warn(),
    'shorthand-property-no-redundant-values': warn(),
    'property-no-vendor-prefix': warn(),
    'value-no-vendor-prefix': warn(),
    'selector-no-vendor-prefix': warn(),
    'at-rule-no-vendor-prefix': warn(),
    'media-feature-name-no-vendor-prefix': warn(),
    'property-no-deprecated': warn(),
    'declaration-property-value-keyword-no-deprecated': warn(),
    'comment-no-empty': warn(),
  },
  overrides: [
    {
      files: ['**/*.scss'],
      customSyntax: postcssScss,
      rules: {
        'at-rule-no-unknown': null,
        'function-no-unknown': null,
        'declaration-property-value-no-unknown': null,
        'media-query-no-invalid': null,
      },
    },
  ],
};
