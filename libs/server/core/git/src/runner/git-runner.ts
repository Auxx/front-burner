import { Injectable } from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
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

export interface GitRunOptions {
  cwd?: string;
  /** Added to the environment built from scratch. */
  env?: Record<string, string>;
  timeoutMs: number;
  /** Per stream; anything past it is read and dropped. Default 1 MiB. */
  maxOutputBytes?: number;
  stdin?: string;
}

export interface GitResult {
  /** `null` when git was killed or could not be started. */
  exitCode: number | null;
  stdout: string;
  /** With credentials removed from URLs (NF-10.5). */
  stderr: string;
  timedOut: boolean;
}

/** Collects a stream up to a number of bytes, and keeps draining it past them so the child never blocks. */
function collect(stream: Readable | null, maxBytes: number): () => string {
  const chunks: Buffer[] = [];
  let size = 0;
  stream?.on('data', (chunk: Buffer) => {
    if (size < maxBytes) {
      const kept = chunk.subarray(0, maxBytes - size);
      chunks.push(kept);
      size += kept.length;
    }
  });
  return () => Buffer.concat(chunks).toString('utf8');
}

/** Runs `git` with a clean environment and the hardening of A-5.1. Features use `GitEngine`, never this. */
@Injectable()
export class GitRunner {
  private readonly running = new Map<ChildProcess, Promise<unknown>>();

  async run(args: string[], options: GitRunOptions): Promise<GitResult> {
    const home = await mkdtemp(join(tmpdir(), 'fb-home-'));
    try {
      return await this.spawn(args, options, home);
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
    const env: Record<string, string> = {
      PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C'
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
    if (options.stdin !== undefined) {
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(options.stdin);
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child);
    }, options.timeoutMs);

    const done = new Promise<GitResult>(resolve => {
      let spawnError: Error | undefined;
      child.once('error', error => {
        spawnError = error;
      });
      child.once('close', code => {
        clearTimeout(timer);
        this.running.delete(child);
        resolve({
          exitCode: spawnError ? null : code,
          stdout: stdout(),
          stderr: redactCredentials(spawnError ? spawnError.message : stderr()),
          timedOut
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
