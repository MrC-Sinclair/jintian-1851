/** @type {import('stylelint').Config} */
export default {
  extends: [
    'stylelint-config-standard',
    'stylelint-config-recommended-vue',
    'stylelint-config-recess-order'
  ],
  rules: {
    'unit-no-unknown': [true, { ignoreUnits: ['rpx', 'upx'] }],
    'declaration-property-value-no-unknown': null,
    'selector-pseudo-element-no-unknown': null,
    'color-function-notation': null,
    'alpha-value-notation': null,
    'property-no-vendor-prefix': null,
    'value-no-vendor-prefix': null,
    'selector-max-id': null,
    'declaration-no-important': null,
    'no-descending-specificity': null,
    'comment-empty-line-before': null,
    'declaration-block-no-redundant-longhand-properties': null,
    'declaration-property-value-disallowed-list': null,
    'color-function-alias-notation': null,
    'property-no-unknown': [true, { ignoreProperties: ['word-wrap'] }],
    'property-no-deprecated': null,
    'no-empty-source': null,
    'declaration-block-no-duplicate-properties': true,
    'declaration-block-no-duplicate-custom-properties': true,
    'no-invalid-position-at-import-rule': true,
    'no-duplicate-selectors': true,
    'font-family-no-missing-generic-family-keyword': true
  },
  overrides: [
    {
      files: ['**/*.vue'],
      customSyntax: 'postcss-html'
    }
  ]
}
