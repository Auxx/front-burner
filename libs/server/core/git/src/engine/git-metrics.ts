import { METRICS_PREFIX, METRICS_REGISTRY } from '@front-burner/server-core-observability';
import { Inject, Injectable } from '@nestjs/common';
import { Histogram, Registry } from 'prom-client';

export const GIT_OPERATION_DURATION = `${METRICS_PREFIX}git_operation_duration_seconds`;

/**
 * The git operations that are timed, by the name of the engine's method: the
 * only values of the `operation` label. A pull is a `fetch` and a `merge`.
 */
export const GIT_OPERATIONS = [
  'access-check',
  'clone',
  'fetch',
  'push',
  'status',
  'diff',
  'commit',
  'discard',
  'incoming',
  'unsaved-work',
  'merge',
  'merge-abort',
  'merge-commit',
  'resolve',
  'switch-branch',
  'create-branch',
  'list-branches'
] as const;

export type GitOperation = typeof GIT_OPERATIONS[number];

/**
 * `front_burner_git_operation_duration_seconds{operation}` (NF-10.11): every
 * call of a timed engine method, whether it works, fails or runs out of time
 * (NF-11.8). No label names a user, a repository or a path.
 */
@Injectable()
export class GitMetrics {
  /** Records into a registry nobody reads: for an engine built by hand, such as in a test. */
  static readonly NONE = new GitMetrics(new Registry());

  private readonly duration: Histogram<'operation'>;

  constructor(@Inject(METRICS_REGISTRY) registry: Registry) {
    this.duration = new Histogram({
      name: GIT_OPERATION_DURATION,
      help: 'Duration in seconds of git operations, by operation, whether they worked or not.',
      labelNames: [ 'operation' ] as const,
      buckets: [ 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300, 900 ],
      registers: [ registry ]
    });
  }

  /** Runs the operation and records how long it took, also when it throws. */
  async time<T>(operation: GitOperation, run: () => Promise<T>): Promise<T> {
    const end = this.duration.startTimer({ operation });
    try {
      return await run();
    } finally {
      end();
    }
  }
}

type AsyncMethodOf<T> = { [K in keyof T]: T[K] extends (...args: never[]) => Promise<unknown> ? K : never; }[keyof T];

/**
 * Times every call of the class's methods, each as its operation, with the
 * instance's `metrics`, a {@link GitMetrics}. Called once after the class,
 * rather than as a method decorator, whose parameter type metadata would
 * reference type-only imports.
 */
export function timeOperations<T extends object>(
  type: { prototype: T; },
  operations: Partial<Record<AsyncMethodOf<T>, GitOperation>>
): void {
  for (const [ method, operation ] of Object.entries(operations) as [ keyof T & string, GitOperation ][]) {
    const original = type.prototype[method] as (...args: unknown[]) => Promise<unknown>;
    const timed = function(this: { metrics: GitMetrics; }, ...args: unknown[]): Promise<unknown> {
      return this.metrics.time(operation, () => original.apply(this, args));
    };
    Object.defineProperty(type.prototype, method, { value: timed, writable: true, configurable: true });
  }
}
