export type WorkingCopyChangeState = 'modified' | 'added' | 'deleted';

export interface WorkingCopyChange {
  path: string;
  state: WorkingCopyChangeState;
}

export interface WorkingCopyStatus {
  /** `null` on a detached `HEAD`. */
  branch: string | null;
  /** With no commit yet, `branch` is `main`, whatever `HEAD` names (GA-42). */
  noCommits: boolean;
  /**
   * For example `origin/main`; `null` for an unpublished branch, and for one
   * whose upstream does not exist on the remote as of the last fetch.
   */
  upstream: string | null;
  /** Commits to push, as of the last fetch. */
  ahead: number;
  /** Commits to pull, as of the last fetch. */
  behind: number;
  /** Sorted by path, comparing code units, so that the order is the same on every device. */
  changes: WorkingCopyChange[];
}

/** Spaces before the path of a `1` record: `1 XY sub mH mI mW hH hI <path>`. */
const ORDINARY_FIELDS = 8;

/** Spaces before the path of a `u` record: `u XY sub m1 m2 m3 mW h1 h2 h3 <path>`. */
const UNMERGED_FIELDS = 10;

/** What git reports for a `HEAD` that is on no branch. */
const NO_BRANCH = new Set([ '(detached)', '(unknown)' ]);

function pathAfter(record: string, fields: number): string {
  let index = -1;
  for (let field = 0; field < fields; field++) {
    index = record.indexOf(' ', index + 1);
  }
  return record.slice(index + 1);
}

function stateOf(xy: string): WorkingCopyChangeState {
  if (xy.includes('A')) {
    return 'added';
  }
  return xy.includes('D') ? 'deleted' : 'modified';
}

/**
 * Reads `git status --porcelain=v2 --branch -z`. Every record ends with a NUL
 * and paths are not quoted. Renames are off, so there are no `2` records, and
 * ignored files are off, so there are no `!` records (GA-11).
 */
export function parseStatus(stdout: string): WorkingCopyStatus {
  let head: string | undefined;
  let noCommits = false;
  let upstream: string | null = null;
  let counted = false;
  let ahead = 0;
  let behind = 0;
  const changes = new Map<string, WorkingCopyChangeState>();
  const add = (path: string, state: WorkingCopyChangeState) => {
    // `git rm --cached` gives a deleted and an untracked record: the file differs from the commit and is on disk.
    changes.set(path, changes.has(path) ? 'modified' : state);
  };

  for (const record of stdout.split('\0')) {
    if (record.startsWith('# branch.oid ')) {
      noCommits = record === '# branch.oid (initial)';
    } else if (record.startsWith('# branch.head ')) {
      head = record.slice('# branch.head '.length);
    } else if (record.startsWith('# branch.upstream ')) {
      upstream = record.slice('# branch.upstream '.length);
    } else if (record.startsWith('# branch.ab ')) {
      // Absent when the upstream is gone; `+? -?` when git could not count.
      counted = true;
      const counts = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      ahead = Number(counts?.[1] ?? 0);
      behind = Number(counts?.[2] ?? 0);
    } else if (record.startsWith('1 ')) {
      add(pathAfter(record, ORDINARY_FIELDS), stateOf(record.slice(2, 4)));
    } else if (record.startsWith('u ')) {
      add(pathAfter(record, UNMERGED_FIELDS), 'modified');
    } else if (record.startsWith('? ') && !record.endsWith('/')) {
      // With --untracked-files=all, only a nested repository is still a folder: committing it would make a gitlink.
      add(record.slice(2), 'added');
    }
  }

  const branch = head === undefined || NO_BRANCH.has(head) ? null : head;
  // A detached HEAD can report the upstream of the branch it left, and an unborn one the upstream of what HEAD names.
  const current = branch !== null && !noCommits;
  return {
    branch: noCommits ? 'main' : branch,
    noCommits,
    // A gone upstream, such as `origin/main` before the first push to an empty remote, is not published (GA-7).
    upstream: current && counted ? upstream : null,
    ahead: current ? ahead : 0,
    behind: current ? behind : 0,
    changes: [ ...changes ]
      .map(([ path, state ]) => ({ path, state }))
      .sort((a, b) => (a.path < b.path ? -1 : 1))
  };
}
