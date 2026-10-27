const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { chmodSync, readdirSync } = require('fs');
const { join } = require('path');

const GIT_HELPERS = join(__dirname, '../../dist/apps/server/git-helpers');

/** Asset copies drop the execute bit, and git runs the helpers directly (A-5.4). */
class ExecutableGitHelpersPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap('ExecutableGitHelpersPlugin', () => {
      for (const helper of readdirSync(GIT_HELPERS)) {
        chmodSync(join(GIT_HELPERS, helper), 0o755);
      }
    });
  }
}

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/server'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]'
    })
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      // Drizzle reads the migrations from disk at startup (A-4); git runs the
      // helpers, which cannot live in /tmp (A-5.4).
      assets: [
        { input: 'libs/server/core/database/migrations', glob: '**/*', output: 'migrations' },
        { input: 'libs/server/core/git/helpers', glob: '*.cjs', output: 'git-helpers' }
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true
    }),
    new ExecutableGitHelpersPlugin()
  ]
};
