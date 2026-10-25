import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/vitest.config.*.timestamp*'
    ]
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs'
    ],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'
          ],
          // A-2.4. Every constraint whose source tags match applies,
          // so one import can be refused by its scope or its type.
          depConstraints: [
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: [
                'scope:shared'
              ]
            },
            {
              sourceTag: 'scope:server',
              onlyDependOnLibsWithTags: [
                'scope:server',
                'scope:shared'
              ]
            },
            {
              sourceTag: 'scope:web',
              onlyDependOnLibsWithTags: [
                'scope:web',
                'scope:shared'
              ]
            },
            // scope:tools has no row: its projects are limited by
            // their type tag, and no scope lists scope:tools, so
            // nothing imports them.
            {
              allSourceTags: [
                'scope:server',
                'type:core'
              ],
              notDependOnLibsWithTags: [
                'type:feature'
              ]
            },
            {
              allSourceTags: [
                'scope:web',
                'type:feature'
              ],
              notDependOnLibsWithTags: [
                'type:feature'
              ]
            },
            {
              sourceTag: 'type:domain',
              onlyDependOnLibsWithTags: [
                'type:data-access',
                'type:ui',
                'scope:shared'
              ]
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: [
                'type:util'
              ]
            },
            {
              sourceTag: 'type:contracts',
              onlyDependOnLibsWithTags: [
                'type:contracts',
                'type:util'
              ]
            },
            {
              sourceTag: 'type:util',
              onlyDependOnLibsWithTags: [
                'type:util'
              ]
            }
          ]
        }
      ]
    }
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs'
    ],
    // Override or add rules here
    rules: {}
  }
];
