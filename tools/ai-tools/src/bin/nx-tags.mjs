#!/usr/bin/env node
import { createProjectGraphAsync } from '@nx/devkit';
import { main, print } from '../lib/cli.mjs';
import { findTagProblems } from '../lib/nx-tags.mjs';

main({
  name: 'nx-tags',
  summary: 'Checks that every Nx project has exactly one scope: and one type: tag (A-2.4).',
  commands: {
    check: {
      usage: '[--json]',
      summary: 'Lists projects with a missing, unknown or duplicate scope: or type: tag; exits with 1 if there is any.',
      options: { json: { type: 'boolean' } },
      async run(options) {
        const graph = await createProjectGraphAsync({ exitOnError: true });
        const projects = Object.values(graph.nodes).map(node => ({ name: node.name, tags: node.data.tags ?? [] }));
        const problems = findTagProblems(projects);
        print(options.json, { projects: projects.length, problems }, () =>
          problems.length
            ? [
              ...problems.map(({ project, problem }) => `${project}: ${problem}`),
              '',
              `${problems.length} problems in ${
                new Set(problems.map(p => p.project)).size
              } of ${projects.length} projects.`
            ].join('\n')
            : `All ${projects.length} projects are tagged.`);
        return problems.length ? 1 : 0;
      }
    }
  }
});
