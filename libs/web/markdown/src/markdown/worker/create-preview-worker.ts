/** The only scripts the preview worker may load: the builder's worker chunks, from this origin (A-8.13). */
const WORKER_SCRIPT = /^\/(?:[\w-]+\/)*worker-[\w-]+\.js$/;

/**
 * Checks the URL of a worker script: Trusted Types make `new Worker` require
 * a `TrustedScriptURL`, and this is the policy behind it. Throws for any other
 * URL.
 */
export function workerScriptUrl(url: string): string {
  const parsed = new URL(url, location.href);
  if (parsed.origin !== location.origin || !WORKER_SCRIPT.test(parsed.pathname) || parsed.search || parsed.hash) {
    throw new TypeError(`Refused to load a worker from ${url}`);
  }
  return parsed.href;
}

/** The part of the Trusted Types API used here, which TypeScript's DOM library does not declare. */
interface ScriptUrlPolicy {
  createScriptURL: (url: string) => unknown;
}
interface TrustedTypesGlobal {
  trustedTypes?: {
    createPolicy: (name: string, rules: { createScriptURL: (url: string) => string; }) => ScriptUrlPolicy;
  };
}

let policy: ScriptUrlPolicy | null | undefined;

function trustedScriptUrl(url: string | URL): string {
  policy ??= (globalThis as TrustedTypesGlobal).trustedTypes?.createPolicy('fb-worker', {
    createScriptURL: workerScriptUrl
  }) ?? null;
  // A `TrustedScriptURL` where the browser has Trusted Types; `Worker` takes both.
  return (policy ? policy.createScriptURL(String(url)) : workerScriptUrl(String(url))) as string;
}

/**
 * Starts the preview worker (A-8.13). The Angular builder bundles a worker
 * only when it is written literally as `new Worker(new URL(…), …)`, so
 * `Worker` here is a subclass that passes the URL through the `fb-worker`
 * policy.
 */
export function createPreviewWorker(): Worker {
  const Worker = class extends globalThis.Worker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(trustedScriptUrl(url), options);
    }
  };
  return new Worker(new URL('./preview.worker', import.meta.url), { type: 'module' });
}
