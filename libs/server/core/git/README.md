# server-core-git

The git engine (A-5): runs `git` with a clean environment and hardening, passes
credentials through a per-command broker, and sends every connection through the
egress proxy.

## Running unit tests

Run `nx test server-core-git` to execute the unit tests via
[Vitest](https://vitest.dev/).
