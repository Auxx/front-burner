import plugin from './index.mjs';

/**
 * The rules for Angular templates, both `.html` files and the inline templates
 * that angular-eslint's processor extracts from `.ts` files. All are errors:
 * the accessibility rules back NF-13 (WCAG 2.2 AA, keyboard alone).
 */
const templateRules = {
  'front-burner/attribute-layout': 'error',
  'front-burner/no-template-calls': [ 'error', { allowedFunctions: [ 't', 'e', 'root' ] } ],
  '@angular-eslint/template/no-any': 'error',
  '@angular-eslint/template/prefer-control-flow': 'error',
  '@angular-eslint/template/banana-in-box': 'error',
  '@angular-eslint/template/eqeqeq': 'error',
  '@angular-eslint/template/prefer-self-closing-tags': 'error',
  '@angular-eslint/template/alt-text': 'error',
  '@angular-eslint/template/elements-content': 'error',
  '@angular-eslint/template/label-has-associated-control': 'error',
  '@angular-eslint/template/click-events-have-key-events': 'error',
  '@angular-eslint/template/interactive-supports-focus': 'error',
  '@angular-eslint/template/role-has-required-aria': 'error',
  '@angular-eslint/template/valid-aria': 'error',
  '@angular-eslint/template/no-autofocus': 'error',
  '@angular-eslint/template/table-scope': 'error',
  '@angular-eslint/template/no-negated-async': 'error',
  '@angular-eslint/template/no-interpolation-in-attributes': 'error'
};

/** The rules that also apply to the test hosts of specs, which are not shipped. */
const specHostRules = [ 'front-burner/attribute-layout', '@angular-eslint/template/prefer-control-flow' ];

/**
 * The shared lint config for Angular templates. An Angular project spreads it
 * after `...baseConfig` and before its own `**\/*.html` block.
 */
export default [
  {
    files: [ '**/*.html' ],
    plugins: { 'front-burner': plugin },
    rules: templateRules
  },
  {
    // Test hosts: the inline templates of specs, which angular-eslint's
    // processor names `<path>/x.spec.ts/inline-template-x.spec.ts-1.component.html`,
    // and templates under `testing/`.
    files: [ '**/*.spec.ts/*.html', '**/testing/**/*.html' ],
    rules: Object.fromEntries(
      Object.keys(templateRules)
        .filter(rule => !specHostRules.includes(rule))
        .map(rule => [ rule, 'off' ])
    )
  }
];
