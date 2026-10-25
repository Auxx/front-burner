import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  {
    files: [
      '**/*.json'
    ],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vitest.config.{js,mjs,ts,mts}',
            // Tests may use packages that `ui` itself does not,
            // such as @angular/forms (A-10.42).
            '{projectRoot}/src/**/*.spec.ts'
          ]
        }
      ]
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser')
    }
  },
  {
    files: [
      '**/*.ts'
    ],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'ui',
          style: 'camelCase'
        }
      ],
      // Simple controls are attribute components on native elements,
      // such as `button[uiActivityBarItem]` (A-10.26).
      '@angular-eslint/component-selector': [
        'error',
        [
          {
            type: 'element',
            prefix: 'ui',
            style: 'kebab-case'
          },
          {
            type: 'attribute',
            prefix: 'ui',
            style: 'camelCase'
          }
        ]
      ]
    }
  },
  {
    files: [
      '**/*.html'
    ],
    // Override or add rules here
    rules: {}
  }
];
