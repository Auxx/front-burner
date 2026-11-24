import BetterSqlite3 from 'better-sqlite3';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { cpus, platform, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createSseParser, jobProblem, parseServerTiming, retryAfterMs } from './perf-stats.mjs';
import { WORKSPACE_ROOT } from './workspace.mjs';

export const DEFAULT_WORK = 'tmp/ai-tools/perf-api';
export const PASSWORD_VARIABLE = 'PERF_PASSWORD';
/** The certificate of the git test servers, which the instance's git must trust (`GIT_SSL_CAINFO`). */
export const TEST_CERTIFICATE = join(WORKSPACE_ROOT, 'libs/server/core/security/src/testing/fixtures/test.crt');
const TEST_KEY = join(WORKSPACE_ROOT, 'libs/server/core/security/src/testing/fixtures/test.key');
/** The seeded users of `scale`, `perf-user-01@example.invalid` and on; `run --users` logs in as them. */
export const scaleUserEmail = n => `perf-user-${String(n).padStart(2, '0')}@example.invalid`;
const FOLDER_ENTRIES = 1000;
const BIG_FILE_BYTES = 100 * 1024;
const CLONE_WAIT_MS = 60 * 60 * 1000;
const JOB_WAIT_MS = 10 * 60 * 1000;
/** Failed connections in a row after which the push channel gives up. */
const EVENT_FAILURES = 5;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** git on this host, with no user or system configuration, trusting the test certificate. */
function gitEnv() {
  return {
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    HOME: tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_SSL_CAINFO: TEST_CERTIFICATE,
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Elsewhere',
    GIT_AUTHOR_EMAIL: 'elsewhere@example.invalid',
    GIT_COMMITTER_NAME: 'Elsewhere',
    GIT_COMMITTER_EMAIL: 'elsewhere@example.invalid'
  };
}

export function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    env: gitEnv(),
    encoding: 'utf8',
    stdio: [ 'ignore', 'pipe', 'pipe' ],
    maxBuffer: 64 * 1024 ** 2
  }).trim();
}

/**
 * Runs git without blocking, so that sessions measured at once (`--users`)
 * see their events on time; resolves with how long it took, in milliseconds.
 */
export function timedGit(cwd, ...args) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn('git', args, { cwd, env: gitEnv(), stdio: [ 'ignore', 'ignore', 'pipe' ] });
    let stderr = '';
    child.stderr.on('data', chunk => (stderr += chunk));
    child.on('error', reject);
    child.on(
      'close',
      code =>
        code === 0 ? resolve(performance.now() - started) : reject(new Error(`git ${args[0]} failed: ${stderr.trim()}`))
    );
  });
}

/** The host's CPUs and memory, printed with every result (the reference host is 2 vCPU and 4 GB). */
export function hostSummary() {
  const cpuList = cpus();
  return {
    cpus: cpuList.length,
    cpuModel: cpuList[0]?.model.trim() ?? 'unknown',
    memoryGb: Math.round(totalmem() / 1024 ** 3 * 10) / 10,
    platform: platform(),
    git: execFileSync('git', [ '--version' ], { encoding: 'utf8' }).trim()
  };
}

// ---------------------------------------------------------------------------
// The git server: bare repositories of the work folder over HTTPS.

/** Runs `git http-backend` as a CGI script for one request. */
function serveGit(request, response, projectRoot, pathInfo) {
  const url = new URL(request.url ?? '/', 'https://localhost');
  const env = {
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    HOME: tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_PROJECT_ROOT: projectRoot,
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: pathInfo,
    REQUEST_METHOD: request.method ?? 'GET',
    QUERY_STRING: url.search.slice(1),
    CONTENT_TYPE: request.headers['content-type'] ?? '',
    REMOTE_ADDR: request.socket.remoteAddress ?? '',
    REMOTE_USER: 'git'
  };
  for (
    const [ header, variable ] of [ [ 'content-encoding', 'HTTP_CONTENT_ENCODING' ], [
      'git-protocol',
      'HTTP_GIT_PROTOCOL'
    ] ]
  ) {
    if (typeof request.headers[header] === 'string') {
      env[variable] = request.headers[header];
    }
  }
  const child = spawn('git', [ '-c', 'http.receivepack=true', 'http-backend' ], {
    env,
    stdio: [ 'pipe', 'pipe', 'ignore' ]
  });
  request.pipe(child.stdin);
  child.stdin.on('error', () => undefined);
  let head = Buffer.alloc(0);
  let headersSent = false;
  child.stdout.on('data', chunk => {
    if (headersSent) {
      response.write(chunk);
      return;
    }
    head = Buffer.concat([ head, chunk ]);
    const end = head.indexOf('\r\n\r\n');
    if (end < 0) {
      return;
    }
    headersSent = true;
    let status = 200;
    for (const line of head.subarray(0, end).toString('latin1').split('\r\n')) {
      const colon = line.indexOf(':');
      const [ name, value ] = [ line.slice(0, colon), line.slice(colon + 1).trim() ];
      if (name.toLowerCase() === 'status') {
        status = parseInt(value, 10);
      } else {
        response.setHeader(name, value);
      }
    }
    response.writeHead(status);
    response.write(head.subarray(end + 4));
  });
  child.on('close', () => {
    if (!headersSent) {
      response.writeHead(500);
    }
    response.end();
  });
}

/**
 * Serves the bare repositories `<name>.git` of `remotesDir` over HTTPS with
 * the test certificate, pushes included. Only names that exist there when
 * asked for are served; anything else is 404.
 */
export async function startGitServer(remotesDir, { host = '127.0.0.1', port = 0 } = {}) {
  const server = createServer(
    { key: readFileSync(TEST_KEY), cert: readFileSync(TEST_CERTIFICATE) },
    (request, response) => {
      const path = new URL(request.url ?? '/', 'https://localhost').pathname;
      const match = /^\/([\w-]+\.git)(\/.*)$/.exec(path);
      if (!match || !readdirSync(remotesDir).includes(match[1])) {
        response.writeHead(404);
        response.end('Not Found');
        return;
      }
      serveGit(request, response, remotesDir, `/${match[1]}${match[2]}`);
    }
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const urlHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return {
    url: `https://${urlHost}:${address.port}`,
    close: () =>
      new Promise(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}

// ---------------------------------------------------------------------------
// Fixtures.

/** About `bytes` of Markdown: headings, paragraphs and lists, the same every time. */
export function markdownOf(bytes, title = 'Big file') {
  const parts = [ `# ${title}\n\n` ];
  let length = parts[0].length;
  for (let section = 1; length < bytes; section++) {
    const text = `## Section ${section}\n\nThis paragraph of section ${section} stands in for prose. `
      + 'It has a [link](https://example.com), some *emphasis*, `code` and **bold** text, and wraps on to a '
      + 'second line so that the editor has work to do.\n\n- one item\n- another item\n\n';
    parts.push(text);
    length += text.length;
  }
  return parts.join('').slice(0, bytes - 1) + '\n';
}

/**
 * The remote `<name>.git` under `work/remotes`: a folder `many/` of 1,000
 * small Markdown files, a 100 KB `big.md`, `saved.md` for saves, `pulled.md`
 * and `pushed.md`. Also two clones on this host: `elsewhere`, which pushes the
 * commits that the instance then pulls, and `baseline`, which times plain git.
 */
export function createRemote(work, name) {
  const remotesDir = join(work, 'remotes');
  const bare = join(remotesDir, `${name}.git`);
  if (existsSync(bare)) {
    throw new Error(`${bare} exists already: pick another --name, or delete it.`);
  }
  mkdirSync(remotesDir, { recursive: true });
  const seed = join(work, 'clones', name, 'seed');
  mkdirSync(join(seed, 'many'), { recursive: true });
  git(remotesDir, 'init', '-q', '--bare', '-b', 'main', bare);
  git(seed, 'init', '-q', '-b', 'main');
  for (let i = 1; i <= FOLDER_ENTRIES; i++) {
    const n = String(i).padStart(4, '0');
    writeFileSync(join(seed, 'many', `note-${n}.md`), `# Note ${n}\n\nA short note.\n`);
  }
  writeFileSync(join(seed, 'big.md'), markdownOf(BIG_FILE_BYTES));
  writeFileSync(join(seed, 'saved.md'), markdownOf(BIG_FILE_BYTES, 'Saved'));
  writeFileSync(join(seed, 'pulled.md'), '# Pulled\n');
  writeFileSync(join(seed, 'pushed.md'), '# Pushed\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'Fixtures for perf-api');
  git(seed, 'push', '-q', bare, 'main');
  return { bare, clones: join(work, 'clones', name) };
}

/** A bare copy of a generated repository (`gen-large-repo.mjs`) as the remote `<name>.git`. */
export function createLargeRemote(work, name, source) {
  const bare = join(work, 'remotes', `${name}.git`);
  if (existsSync(bare)) {
    throw new Error(`${bare} exists already: pick another --name, or delete it.`);
  }
  if (!existsSync(join(source, '.git'))) {
    throw new Error(`${source} is not a git repository: run gen-large-repo.mjs generate first.`);
  }
  mkdirSync(join(work, 'remotes'), { recursive: true });
  git(work, 'clone', '-q', '--bare', source, bare);
  git(bare, 'branch', '-M', git(bare, 'symbolic-ref', '--short', 'HEAD'), 'main');
  git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  return bare;
}

// ---------------------------------------------------------------------------
// The API.

/** One login to the instance: its calls, its push channel and its token refreshes. */
export class Session {
  constructor(url, email, password) {
    this.url = url.replace(/\/$/, '');
    this.email = email;
    this.password = password;
    /** `{ done, fail }` of each job waited for, by job ID. */
    this.waiters = new Map();
    this.finished = new Map();
    this.closed = false;
    this.streamUp = false;
    /** The push channel's connections so far. */
    this.generation = 0;
  }

  async login() {
    const { response } = await this.send('POST', '/auth/login', {
      email: this.email,
      password: this.password,
      refreshTokenDelivery: 'body'
    }, { auth: false });
    if (response.status !== 200) {
      throw new Error(`Login as ${this.email} failed: ${response.status} ${await response.text()}`);
    }
    this.keep(await response.json());
  }

  keep(tokens) {
    this.authToken = tokens.authToken;
    this.refreshToken = tokens.refreshToken;
    this.expiresAt = Date.parse(tokens.authTokenExpiresAt);
  }

  async refresh() {
    const { response } = await this.send('POST', '/auth/session/refresh', { refreshToken: this.refreshToken }, {
      auth: false
    });
    if (response.status !== 200) {
      throw new Error(`Refreshing the session of ${this.email} failed: ${response.status}`);
    }
    this.keep(await response.json());
  }

  /**
   * Refreshes the auth token when it is about to expire, or when `force`.
   * Callers at once share one refresh: a refresh token is used only once, and
   * using it again revokes the session.
   */
  async fresh(force = false) {
    if (force || Date.now() > this.expiresAt - 60_000) {
      this.refreshing ??= this.refresh().finally(() => (this.refreshing = undefined));
      await this.refreshing;
    }
  }

  /**
   * Sends one request, waiting out 429s as told (NF-11.4), so that a limit
   * never ends a run: `{ response, sentAt }`, where `sentAt` is when the
   * request that got through was sent, the waits left out.
   */
  async send(method, path, body, { auth = true } = {}) {
    for (;;) {
      const sentAt = performance.now();
      const response = await fetch(`${this.url}/api/v1${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(auth ? { authorization: `Bearer ${this.authToken}` } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      if (response.status !== 429) {
        return { response, sentAt };
      }
      await response.body?.cancel();
      await sleep(retryAfterMs(response.headers.get('retry-after')));
    }
  }

  /**
   * Calls the API: `{ status, body, serverMs, sentAt }`, where `serverMs` is
   * the response's `Server-Timing`. Refreshes the auth token when it is about
   * to expire. Throws when the status is not `expect`.
   */
  async call(method, path, body, expect = 200) {
    await this.fresh();
    const { response, sentAt } = await this.send(method, path, body);
    const text = await response.text();
    if (response.status !== expect) {
      throw new Error(`${method} ${path}: expected ${expect}, got ${response.status} ${text.slice(0, 300)}`);
    }
    return {
      status: response.status,
      body: text === '' ? undefined : JSON.parse(text),
      serverMs: parseServerTiming(response.headers.get('server-timing')),
      sentAt
    };
  }

  /**
   * Keeps the push channel open, reconnecting when the server ends it (it
   * does when the auth token expires, A-3.10); `job.finished` events end the
   * matching `timedJob`. Fails the session after {@link EVENT_FAILURES}
   * connections in a row that fail.
   */
  async openEvents() {
    let failures = 0;
    let forceRefresh = false;
    while (!this.closed) {
      this.abort = new AbortController();
      try {
        await this.fresh(forceRefresh);
        forceRefresh = false;
        const response = await fetch(`${this.url}/api/v1/events`, {
          headers: { authorization: `Bearer ${this.authToken}` },
          signal: this.abort.signal
        });
        const type = response.headers.get('content-type') ?? '';
        if (response.status === 429) {
          await response.body?.cancel();
          await sleep(retryAfterMs(response.headers.get('retry-after')));
          continue;
        }
        if (!response.ok || !type.startsWith('text/event-stream')) {
          await response.body?.cancel();
          forceRefresh = response.status === 401;
          throw new Error(`it answered ${response.status} (${type || 'no content type'})`);
        }
        failures = 0;
        this.generation++;
        this.streamUp = true;
        this.onReady?.();
        const parse = createSseParser(({ event, data }) => {
          if (event === 'job.finished') {
            const { jobId } = JSON.parse(data);
            const at = performance.now();
            this.finished.set(jobId, at);
            this.waiters.get(jobId)?.done(at);
          }
        });
        const decoder = new TextDecoder();
        for await (const chunk of response.body) {
          parse(decoder.decode(chunk, { stream: true }));
        }
      } catch (error) {
        if (this.closed) {
          return;
        }
        if (++failures >= EVENT_FAILURES) {
          this.fail(new Error(`The push channel of ${this.email} failed ${failures} times in a row: ${error.message}`));
          return;
        }
        process.stderr.write(`push channel of ${this.email}: ${error.message}; reconnecting\n`);
      } finally {
        this.streamUp = false;
      }
      await sleep(200 * Math.max(1, failures));
    }
  }

  /** Ends the jobs waited for, and the wait for the push channel, with `error`. */
  fail(error) {
    this.failure ??= error;
    this.onFail?.(error);
    for (const { fail } of this.waiters.values()) {
      fail(error);
    }
  }

  /** Opens the push channel; resolves once it is open, rejects when it cannot be. */
  startEvents() {
    const ready = new Promise((resolve, reject) => {
      this.onReady = resolve;
      this.onFail = reject;
    });
    this.eventsDone = this.openEvents().catch(error => this.fail(error));
    return ready;
  }

  close() {
    this.closed = true;
    this.abort?.abort();
  }

  /**
   * Starts a git job with `POST path` and resolves with the milliseconds from
   * sending the request that got through to its `job.finished` event (NF-2.6).
   * Throws unless the job succeeded (see `jobProblem`). While the push channel
   * stays up, the event is the only signal. Once it has been down, the event
   * may be lost, so the job's state is polled every 2 seconds; a job found
   * finished that way resolves undefined, because when it finished is known
   * only to within 2 seconds, and its sample is dropped.
   */
  async timedJob(repositoryId, path) {
    if (this.failure) {
      throw this.failure;
    }
    const generation = this.generation;
    const upAtStart = this.streamUp;
    const jobPath = jobId => `/repositories/${repositoryId}/git/jobs/${jobId}`;
    const { body, sentAt } = await this.call('POST', `/repositories/${repositoryId}${path}`, undefined, 202);
    const { jobId } = body;
    const finished = await new Promise((resolve, reject) => {
      if (this.finished.has(jobId)) {
        resolve(this.finished.get(jobId));
        return;
      }
      const deadline = Date.now() + JOB_WAIT_MS;
      const end = () => {
        clearInterval(poll);
        this.waiters.delete(jobId);
      };
      const poll = setInterval(async () => {
        try {
          if (Date.now() > deadline) {
            throw new Error(`job ${jobId} did not finish in ${JOB_WAIT_MS / 60_000} minutes`);
          }
          if (upAtStart && this.streamUp && this.generation === generation) {
            return;
          }
          const state = (await this.call('GET', jobPath(jobId))).body;
          if (state.status !== 'queued' && state.status !== 'running') {
            end();
            resolve(undefined);
          }
        } catch (error) {
          end();
          reject(error);
        }
      }, 2000);
      this.waiters.set(jobId, {
        done: at => {
          end();
          resolve(at);
        },
        fail: error => {
          end();
          reject(error);
        }
      });
    });
    const problem = jobProblem(path, (await this.call('GET', jobPath(jobId))).body);
    if (problem !== undefined) {
      throw new Error(problem);
    }
    if (finished === undefined) {
      process.stderr.write(
        `${this.email}: job ${jobId} was found finished by polling while the push channel was down; dropped\n`
      );
      return undefined;
    }
    return finished - sentAt;
  }

  /** The names of this user's repositories, lower case. */
  async repositoryNames() {
    return new Set((await this.call('GET', '/repositories')).body.repositories.map(r => r.name.toLowerCase()));
  }

  /** Adds a public repository and waits for its clone to be ready; returns its ID. */
  async addRepository(name, remoteUrl) {
    const { body } = await this.call(
      'POST',
      '/repositories',
      { remoteUrl, name, credentials: { mode: 'none' }, cloneMode: 'full', gitLevel: 'advanced' },
      201
    );
    const deadline = Date.now() + CLONE_WAIT_MS;
    for (;;) {
      const repository = (await this.call('GET', `/repositories/${body.id}`)).body;
      if (repository.status === 'ready') {
        return body.id;
      }
      if (repository.status === 'error') {
        throw new Error(
          `The clone of ${name} failed (${JSON.stringify(repository.error)}). If its detail names the `
            + `certificate, start the instance with GIT_SSL_CAINFO=${TEST_CERTIFICATE}.`
        );
      }
      if (Date.now() > deadline) {
        throw new Error(`The clone of ${name} took over an hour.`);
      }
      await sleep(1000);
    }
  }

  /** Sets and confirms a commit author, as the first commit needs (CA-9). */
  async confirmCommitAuthor() {
    const { body } = await this.call('GET', '/preferences/commit-author');
    if (!body.confirmed) {
      await this.call('PUT', '/preferences/commit-author', {
        name: body.author.name || 'Perf',
        email: body.author.email || this.email
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The measures.

/**
 * A pause before an operation of one of the users of `--users` (NF-1.2):
 * between half and one and a half times `thinkMs`, evenly, so that the users
 * drift apart as people do. No pause when `thinkMs` is 0.
 */
export function thinkPause(thinkMs, random = Math.random) {
  return thinkMs <= 0 ? 0 : thinkMs * (0.5 + random());
}

/**
 * Runs `measure` `warmup` times unrecorded, then `runs` times, and returns
 * the durations it resolves with; a run that resolves undefined (a dropped
 * sample) is left out. With `thinkMs`, each run waits {@link thinkPause} first;
 * the wait is not part of what `measure` times.
 */
async function repeatRuns(runs, warmup, measure, thinkMs = 0) {
  const pause = () => sleep(thinkPause(thinkMs));
  for (let i = 0; i < warmup; i++) {
    await pause();
    await measure(-1 - i);
  }
  const values = [];
  for (let i = 0; i < runs; i++) {
    await pause();
    const value = await measure(i);
    if (value !== undefined) {
      values.push(value);
    }
  }
  return values;
}

function serverMs(result) {
  if (result.serverMs === undefined) {
    throw new Error(
      'The instance sent no Server-Timing header: start it with FRONT_BURNER_SERVER_TIMING=true (plan 150).'
    );
  }
  return result.serverMs;
}

/** The operations of `measureBasics`, in the order it times them; `--measures` picks some. */
export const BASIC_MEASURES = [ 'folder', 'file', 'save', 'push', 'pull' ];

/**
 * The measures named in `--measures`, a comma-separated list of
 * {@link BASIC_MEASURES}, as a set; all of them when `text` is undefined.
 */
export function parseMeasures(text) {
  if (text === undefined) {
    return new Set(BASIC_MEASURES);
  }
  const names = text.split(',').map(name => name.trim()).filter(name => name !== '');
  const unknown = names.filter(name => !BASIC_MEASURES.includes(name));
  if (names.length === 0 || unknown.length > 0) {
    throw new Error(`--measures takes a list of ${BASIC_MEASURES.join(', ')}: ${text}`);
  }
  return new Set(names);
}

/**
 * NF-2.1 to NF-2.3 and NF-2.6 in one repository: `samples` and `baselines`
 * collect the durations by operation. `context.measures`, a set of
 * {@link BASIC_MEASURES} (default all), says which run; `context.thinkMs`
 * the user's mean pause before each run (default none).
 */
export async function measureBasics(context, { samples, baselines }) {
  const { session, id, clones, runs, warmup, log, measures = new Set(BASIC_MEASURES), thinkMs = 0 } = context;
  const repeat = (count, warm, measure) => repeatRuns(count, warm, measure, thinkMs);
  const add = (key, value, into = samples) => (into[key] ??= []).push(value);
  const encode = encodeURIComponent;

  if (measures.has('folder')) {
    log('folder');
    for (
      const v of await repeat(
        runs,
        warmup,
        async () => serverMs(await session.call('GET', `/repositories/${id}/folder?path=many`))
      )
    ) {
      add('folder', v);
    }
  }
  if (measures.has('file')) {
    log('file');
    for (
      const v of await repeat(
        runs,
        warmup,
        async () => serverMs(await session.call('GET', `/repositories/${id}/file?path=${encode('big.md')}`))
      )
    ) {
      add('file', v);
    }
  }
  if (measures.has('save')) {
    log('save');
    const saved = markdownOf(BIG_FILE_BYTES, 'Saved');
    for (
      const v of await repeat(runs, warmup, async run =>
        serverMs(
          await session.call('PUT', `/repositories/${id}/file`, {
            path: 'saved.md',
            content: `${saved}\nSave ${run} at ${Date.now()}\n`,
            lineEnding: 'lf',
            bom: false
          })
        ))
    ) {
      add('save', v);
    }
    // A pull refuses uncommitted changes.
    await session.call('POST', `/repositories/${id}/git/commits`, { message: 'Saves', paths: [ 'saved.md' ] }, 201);
  }
  if (!measures.has('push') && !measures.has('pull')) {
    return;
  }

  // NF-2.6: the job against the same operation with plain git, against the same remote.
  const elsewhere = join(clones, 'elsewhere');
  const baseline = join(clones, 'baseline');
  const remoteUrl = context.remoteUrl;
  if (!existsSync(elsewhere)) {
    await timedGit(clones, 'clone', '-q', remoteUrl, elsewhere);
  }
  if (!existsSync(baseline)) {
    await timedGit(clones, 'clone', '-q', remoteUrl, baseline);
  }
  const pushFromElsewhere = async run => {
    await timedGit(elsewhere, 'pull', '-q', '--no-rebase', '--no-edit');
    writeFileSync(join(elsewhere, 'pulled.md'), `# Pulled\n\nRun ${run} at ${Date.now()}\n`);
    await timedGit(elsewhere, 'commit', '-q', '-am', `Elsewhere ${run}`);
    await timedGit(elsewhere, 'push', '-q');
  };

  if (measures.has('push')) {
    log('push');
    for (
      const v of await repeat(runs, warmup, async run => {
        await session.call('PUT', `/repositories/${id}/file`, {
          path: 'pushed.md',
          content: `# Pushed\n\nRun ${run} at ${Date.now()}\n`,
          lineEnding: 'lf',
          bom: false
        });
        await session.call(
          'POST',
          `/repositories/${id}/git/commits`,
          { message: `Push ${run}`, paths: [ 'pushed.md' ] },
          201
        );
        return session.timedJob(id, '/git/push');
      })
    ) {
      add('push', v);
    }
    for (
      const v of await repeat(runs, warmup, async run => {
        await timedGit(baseline, 'pull', '-q', '--no-rebase', '--no-edit');
        writeFileSync(join(baseline, 'baseline.md'), `# Baseline\n\nRun ${run} at ${Date.now()}\n`);
        await timedGit(baseline, 'add', 'baseline.md');
        await timedGit(baseline, 'commit', '-q', '-m', `Baseline ${run}`);
        return timedGit(baseline, 'push', '-q');
      })
    ) {
      add('push', v, baselines);
    }
  }

  if (measures.has('pull')) {
    log('pull');
    for (
      const v of await repeat(runs, warmup, async run => {
        await pushFromElsewhere(run);
        return session.timedJob(id, '/git/pull');
      })
    ) {
      add('pull', v);
    }
    for (
      const v of await repeat(runs, warmup, async run => {
        await pushFromElsewhere(`baseline ${run}`);
        return timedGit(baseline, 'pull', '-q', '--no-rebase', '--no-edit');
      })
    ) {
      add('pull', v, baselines);
    }
  }
}

/** Drops the page cache, so that the next status reads from disk (`--cold`; Linux, as root). */
export function dropCaches() {
  execFileSync('sync');
  writeFileSync('/proc/sys/vm/drop_caches', '3\n');
}

/** NF-2.8 in the large repository: status and commit, warm and, with `cold`, after dropping the page cache. */
export async function measureLarge(context, { samples }) {
  const { session, id, runs, warmup, cold, coldRuns, log } = context;
  const repeat = repeatRuns;
  const add = (key, value) => (samples[key] ??= []).push(value);
  const status = async () => serverMs(await session.call('GET', `/repositories/${id}/git/status`));
  let changes = 0;
  // A file of its own at the root, which the generated repository does not have.
  await session.call('POST', `/repositories/${id}/entries`, { folder: '', name: 'perf-commit.md', kind: 'file' }, 201);
  const commit = async () => {
    changes++;
    await session.call('PUT', `/repositories/${id}/file`, {
      path: 'perf-commit.md',
      content: `# Commit ${changes}\n\nAt ${Date.now()}\n`,
      lineEnding: 'lf',
      bom: false
    });
    return serverMs(
      await session.call('POST', `/repositories/${id}/git/commits`, {
        message: `Commit ${changes}`,
        paths: [ 'perf-commit.md' ]
      }, 201)
    );
  };

  if (cold) {
    log('status, cold');
    for (const v of await repeat(coldRuns, 0, async () => (dropCaches(), status()))) {
      add('status-cold', v);
    }
    log('commit, cold');
    // The save before the commit warms only its own file; the commit's index and tree reads start cold.
    for (const v of await repeat(coldRuns, 0, async () => (dropCaches(), commit()))) {
      add('commit-cold', v);
    }
  }
  log('status, warm');
  for (const v of await repeat(runs, warmup, status)) {
    add('status-warm', v);
  }
  log('commit, warm');
  for (const v of await repeat(runs, warmup, commit)) {
    add('commit-warm', v);
  }
  // NF-1.4: a push at this size works. No warm-up: the first push, which
  // sends every commit above, is the one most worth recording.
  log('push');
  for (
    const v of await repeat(Math.min(runs, 10), 0, async () => (await commit(), session.timedJob(id, '/git/push')))
  ) {
    add('push-large', v);
  }
}

// ---------------------------------------------------------------------------
// Scale: users and working copies in a stopped instance's data directory.

/**
 * Fills a stopped instance's data directory with `users` password users,
 * each with the first administrator's password, and `repositories` ready
 * repositories for every user, administrator included, each with a small
 * working copy (NF-1.1, NF-1.3). Refuses a data directory whose instance seems
 * to be running, or that holds any user besides the first administrator.
 */
export function fillDataDir(
  dataDir,
  { users = 49, repositories = 50, reposRoot = dataDir, log = () => undefined } = {}
) {
  const databaseFile = join(dataDir, 'db', 'front-burner.sqlite');
  if (!existsSync(databaseFile)) {
    throw new Error(`No database at ${databaseFile}: start the instance once and onboard the administrator.`);
  }
  if (existsSync(`${databaseFile}-shm`) || existsSync(`${databaseFile}-wal`)) {
    throw new Error('The database is open (its -shm or -wal file exists): stop the instance first.');
  }
  const sqlite = new BetterSqlite3(databaseFile);
  try {
    const { count } = sqlite.prepare('SELECT count(*) AS count FROM users').get();
    if (count !== 1) {
      throw new Error(
        `The instance has ${count} users; scale fills only one that holds the first administrator alone.`
      );
    }
    const admin = sqlite.prepare('SELECT id, password_hash FROM users ORDER BY id LIMIT 1').get();
    const template = createTemplateWorkingCopy(join(dataDir, 'tmp', 'perf-template'));
    const now = Date.now();
    const insertUser = sqlite.prepare(
      `INSERT INTO users (email, display_name, role, login_method, password_hash, created_at)
       VALUES (?, ?, 'user', 'password', ?, ?)`
    );
    const insertPreferences = sqlite.prepare(
      `INSERT INTO user_preferences (user_id, commit_author_name, commit_author_email, commit_author_confirmed)
       VALUES (?, ?, ?, 1)`
    );
    const insertRepository = sqlite.prepare(
      `INSERT INTO repositories
         (user_id, name, remote_url, clone_mode, branch, git_level, status, error_code, error_detail,
          error_request_id, created_at, last_accessed_at)
       VALUES (?, ?, ?, 'full', NULL, 'advanced', 'ready', NULL, NULL, NULL, ?, ?)`
    );
    const rows = sqlite.transaction(() => {
      const userIds = [ admin.id ];
      for (let n = 1; n <= users; n++) {
        const email = scaleUserEmail(n);
        const id = Number(insertUser.run(email, `Perf user ${n}`, admin.password_hash, now).lastInsertRowid);
        insertPreferences.run(id, `Perf user ${n}`, email);
        userIds.push(id);
      }
      const created = [];
      for (const userId of userIds) {
        for (let r = 1; r <= repositories; r++) {
          const name = `scale-${String(r).padStart(2, '0')}`;
          const id = Number(
            insertRepository.run(userId, name, SCALE_REMOTE, now - r * 60_000, now - r * 60_000).lastInsertRowid
          );
          created.push({ userId, id });
        }
      }
      return created;
    })();
    rows.forEach(({ userId, id }, index) => {
      cpSync(template, join(reposRoot, 'repos', String(userId), String(id)), { recursive: true });
      if ((index + 1) % 250 === 0) {
        log(`${index + 1} working copies`);
      }
    });
    rmSync(join(dataDir, 'tmp', 'perf-template'), { recursive: true, force: true });
    return { users: users + 1, workingCopies: rows.length };
  } finally {
    sqlite.close();
  }
}

/** The remote of every seeded repository: never reachable, so no background fetch reaches the network. */
const SCALE_REMOTE = 'https://git.example.invalid/perf/scale.git';

/** A small working copy, cloned from a local bare repository, whose origin is {@link SCALE_REMOTE}. */
function createTemplateWorkingCopy(dir) {
  rmSync(dir, { recursive: true, force: true });
  const seed = join(dir, 'seed');
  const bare = join(dir, 'scale.git');
  const copy = join(dir, 'copy');
  mkdirSync(join(seed, 'docs'), { recursive: true });
  git(dir, 'init', '-q', '--bare', '-b', 'main', bare);
  git(seed, 'init', '-q', '-b', 'main');
  writeFileSync(join(seed, 'README.md'), '# Scale\n\nA small repository for NF-1.3.\n');
  for (let i = 1; i <= 20; i++) {
    writeFileSync(join(seed, 'docs', `page-${i}.md`), markdownOf(2000, `Page ${i}`));
  }
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'Scale fixture');
  git(seed, 'push', '-q', bare, 'main');
  git(dir, 'clone', '-q', '--no-local', bare, copy);
  git(copy, 'remote', 'set-url', 'origin', SCALE_REMOTE);
  return copy;
}

/** Polls `/api/health/ready` until it answers 200; resolves with the seconds since `since`. */
export async function waitUntilReady(url, { since = performance.now(), timeoutMs = 600_000, intervalMs = 100 } = {}) {
  const deadline = since + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${url.replace(/\/$/, '')}/api/health/ready`);
      await response.body?.cancel();
      if (response.status === 200) {
        return (performance.now() - since) / 1000;
      }
    } catch {
      // Not listening yet.
    }
    if (performance.now() > deadline) {
      throw new Error(`Not ready after ${timeoutMs / 1000} seconds.`);
    }
    await sleep(intervalMs);
  }
}
