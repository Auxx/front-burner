import { Injectable } from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { assertWorkingCopyFound } from '../engine/git-errors';
import { redactCredentials } from './redact';

/** Passed as `-c` on every call (A-5.1, NF-11.6, NF-11.7). */
const HARDENING = [
  '-c',
  'protocol.allow=never',
  '-c',
  'protocol.https.allow=always',
  '-c',
  'protocol.ssh.allow=always',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.autocrlf=false',
  '-c',
  'submodule.recurse=false',
  '-c',
  'credential.helper='
];

/** How an operator with a private certificate authority points git at it (AR-43). */
const PASSED_THROUGH = [ 'GIT_SSL_CAINFO', 'SSL_CERT_FILE', 'SSL_CERT_DIR' ];

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

/** `git rev-parse --git-dir` reads only `.git`; a check that runs out of time finds no damage. */
const CHECK_TIMEOUT_MS = 10_000;

export interface GitRunOptions {
  cwd?: string;
  /** Added to the environment built from scratch. */
  env?: Record<string, string>;
  timeoutMs: number;
  /** Per stream; anything past it is read and dropped. Default 1 MiB. */
  maxOutputBytes?: number;
  stdin?: string;
  /** Kills git and its children when aborted, such as when its job is cancelled; git is not started once it is. */
  signal?: AbortSignal;
  /**
   * Called with stderr as git writes it, decoded as UTF-8, such as for a
   * clone's progress. Credentials are not removed from it: read it, never
   * keep or show it (NF-10.5). The result's `stderr` is collected as before.
   */
  onStderr?: (text: string) => void;
}

export interface GitResult {
  /** `null` when git was killed or could not be started. */
  exitCode: number | null;
  stdout: string;
  /** The raw stdout bytes, for re-decoding with a fatal text decoder. */
  stdoutRaw: Buffer;
  /** How many bytes git wrote to stdout, including any past `maxOutputBytes`. */
  stdoutBytes: number;
  /** With credentials removed from URLs (NF-10.5). */
  stderr: string;
  timedOut: boolean;
  /** Killed, or never started, because `signal` was aborted. */
  aborted: boolean;
}

interface Collected {
  text(): string;
  raw(): Buffer;
  /** Every byte the stream gave, kept or dropped. */
  bytes(): number;
}

/** Collects a stream up to a number of bytes, and keeps draining it past them so the child never blocks. */
function collect(stream: Readable | null, maxBytes: number): Collected {
  const chunks: Buffer[] = [];
  let size = 0;
  let total = 0;
  let rawValue: Buffer | undefined;
  stream?.on('data', (chunk: Buffer) => {
    total += chunk.length;
    if (size < maxBytes) {
      const kept = chunk.subarray(0, maxBytes - size);
      chunks.push(kept);
      size += kept.length;
    }
  });
  return {
    text: () => (rawValue ??= Buffer.concat(chunks)).toString('utf8'),
    raw: () => rawValue ??= Buffer.concat(chunks),
    bytes: () => total
  };
}

/** Runs `git` with a clean environment and the hardening of A-5.1. Features use `GitEngine`, never this. */
@Injectable()
export class GitRunner {
  private readonly running = new Map<ChildProcess, Promise<unknown>>();

  /**
   * A failed git gives its result, except in a `cwd` that is gone or holds no
   * repository: that is checked only after a failure, so a command that works
   * pays nothing.
   *
   * @throws GitOperationError `working-copy-missing` (RM-6).
   */
  async run(args: string[], options: GitRunOptions): Promise<GitResult> {
    const home = await mkdtemp(join(tmpdir(), 'fb-home-'));
    try {
      const result = await this.spawn(args, options, home);
      const { cwd } = options;
      // A killed git says nothing about the working copy.
      if (cwd !== undefined && result.exitCode !== 0 && !result.aborted) {
        await assertWorkingCopyFound(
          cwd,
          result,
          () => this.spawn([ 'rev-parse', '--git-dir' ], { cwd, timeoutMs: CHECK_TIMEOUT_MS }, home)
        );
      }
      return result;
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }

  /** Kills every running git and its children, and waits for them to end (A-1.14). */
  async killAll(): Promise<void> {
    for (const child of this.running.keys()) {
      killGroup(child);
    }
    await Promise.all(this.running.values());
  }

  private spawn(args: string[], options: GitRunOptions, home: string): Promise<GitResult> {
    const { signal } = options;
    if (signal?.aborted) {
      return Promise.resolve({
        exitCode: null,
        stdout: '',
        stdoutRaw: Buffer.alloc(0),
        stdoutBytes: 0,
        stderr: '',
        timedOut: false,
        aborted: true
      });
    }
    const env: Record<string, string> = {
      PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
      // A working copy without `.git` is not a repository: git never looks for one in the folders above it.
      ...(options.cwd === undefined ? {} : { GIT_CEILING_DIRECTORIES: dirname(resolve(options.cwd)) })
    };
    for (const name of PASSED_THROUGH) {
      const value = process.env[name];
      if (value) {
        env[name] = value;
      }
    }
    Object.assign(env, options.env);

    // detached: git gets its own process group, so a timeout kills its children too.
    const child = spawn('git', [ ...HARDENING, ...args ], {
      cwd: options.cwd,
      env,
      detached: true,
      stdio: [ options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe' ]
    });
    const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const stdout = collect(child.stdout, maxBytes);
    const stderr = collect(child.stderr, maxBytes);
    const onStderr = options.onStderr;
    if (onStderr !== undefined) {
      // A decoder keeps a character split between chunks whole.
      const decoder = new StringDecoder('utf8');
      child.stderr?.on('data', (chunk: Buffer) => onStderr(decoder.write(chunk)));
    }
    if (options.stdin !== undefined) {
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(options.stdin);
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child);
    }, options.timeoutMs);
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      killGroup(child);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const done = new Promise<GitResult>(resolve => {
      let spawnError: Error | undefined;
      child.once('error', error => {
        spawnError = error;
      });
      child.once('close', code => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.running.delete(child);
        resolve({
          exitCode: spawnError ? null : code,
          stdout: stdout.text(),
          stdoutRaw: stdout.raw(),
          stdoutBytes: stdout.bytes(),
          stderr: redactCredentials(spawnError ? spawnError.message : stderr.text()),
          timedOut,
          aborted
        });
      });
    });
    this.running.set(child, done);
    return done;
  }
}

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // The group has already ended.
  }
}
