#!/usr/bin/env node
import { createProjectGraphAsync } from '@nx/devkit';
import { main, print } from '../lib/cli.mjs';
import { findConfigProblems } from '../lib/vitest-configs.mjs';

main({
  name: 'vitest-configs',
  summary: 'Checks that the unit tests of every Nx project build on vitest.shared.mts.',
  commands: {
    check: {
      usage: '[--json]',
      summary: 'Lists test targets whose Vitest config does not use the shared settings; exits with 1 if there is any.',
      options: { json: { type: 'boolean' } },
      async run(options) {
        const graph = await createProjectGraphAsync({ exitOnError: true });
        const projects = Object.values(graph.nodes).map(node => ({
          name: node.name,
          root: node.data.root,
          targets: node.data.targets
        }));
        const tested = projects.filter(project => project.targets?.test).length;
        const problems = findConfigProblems(projects);
        print(options.json, { projects: tested, problems }, () =>
          problems.length
            ? [
              ...problems.map(({ project, problem }) => `${project}: ${problem}`),
              '',
              `${problems.length} problems in ${tested} projects with a test target.`
            ].join('\n')
            : `All ${tested} projects with a test target use vitest.shared.mts.`);
        return problems.length ? 1 : 0;
      }
    }
  }
});
