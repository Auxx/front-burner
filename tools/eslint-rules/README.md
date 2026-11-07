# eslint-rules

The workspace's local ESLint plugin, `front-burner`, which holds the custom lint
rules that no published plugin offers, such as `front-burner/attribute-layout`
for the layout of attributes in Angular templates. It is plain JavaScript with
no build step, and it is not published.

## Opting in

Every Angular project lints its templates with the shared config in
`src/angular-templates.config.mjs`. It turns on the `front-burner` rules and the
chosen `@angular-eslint/template` rules, as errors, for `.html` files and for
the inline templates of `.ts` files. Test hosts (the inline templates of
`*.spec.ts` files and templates under `testing/`) keep only `attribute-layout`
and `prefer-control-flow`.

A project imports it in its `eslint.config.mjs`, with a path relative to the
project, and spreads it after `...baseConfig` and before its own `**/*.html`
block:

```js
import nx from '@nx/eslint-plugin';
import angularTemplates from '../../tools/eslint-rules/src/angular-templates.config.mjs';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  ...angularTemplates,
  {
    files: [ '**/*.html' ],
    rules: {}
  }
];
```

A project that needs a rule the shared config does not turn on imports the
plugin from `src/index.mjs`, registers it under the name `front-burner` and
turns the rule on in its own config.

`attribute-layout` reports, but does not fix, a tag that starts on the first
line of an inline template (`` template: `<a b c>` ``): the columns of that line
in the extracted template are not those of the `.ts` file.
