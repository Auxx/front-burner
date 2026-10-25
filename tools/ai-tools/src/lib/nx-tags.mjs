/** The scope tags of A-2.4 and A-2.5; every project has exactly one. */
export const SCOPE_TAGS = Object.freeze([ 'scope:server', 'scope:web', 'scope:shared', 'scope:tools' ]);

/** The type tags of A-2.4; every project has exactly one. */
export const TYPE_TAGS = Object.freeze([
  'type:app',
  'type:feature',
  'type:core',
  'type:domain',
  'type:data-access',
  'type:ui',
  'type:contracts',
  'type:util'
]);

const KINDS = [ [ 'scope', SCOPE_TAGS ], [ 'type', TYPE_TAGS ] ];

function problemsOf(tags) {
  const problems = [];
  for (const [ kind, known ] of KINDS) {
    const ofKind = tags.filter(tag => tag.startsWith(`${kind}:`));
    for (const tag of ofKind.filter(tag => !known.includes(tag))) {
      problems.push(`unknown tag ${tag}`);
    }
    const valid = ofKind.filter(tag => known.includes(tag));
    if (!valid.length) {
      problems.push(`no ${kind}: tag`);
    } else if (valid.length > 1) {
      problems.push(`more than one ${kind}: tag (${valid.join(', ')})`);
    }
  }
  return problems;
}

/**
 * The tag problems of Nx projects, sorted by project name: every project needs
 * exactly one known `scope:` tag and one known `type:` tag (A-2.4). Nx itself
 * cannot require tags, and an untagged project escapes every boundary rule.
 * Tags with other prefixes are ignored.
 */
export function findTagProblems(projects) {
  return [ ...projects ]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(({ name, tags }) => problemsOf(tags ?? []).map(problem => ({ project: name, problem })));
}
