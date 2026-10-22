Next requirements files to write, as these requirements leave them to separate
files:

- Admin-assisted adding, plus the user's confirmation flow.
- The repository management page.
- Saved credentials and known-hosts management.
- Push and remotes, including adding credentials to a public repository and
  asking for a passphrase on other pages.
- Commit author name and email.
- HTML in Markdown preview: the whitelist of safe HTML tags and attributes that
  the live preview renders; every other tag, including scripts, is stripped.
- Live preview: how image paths are resolved, including site-absolute paths such
  as `/images/cover.png` that blog engines map to a folder inside the
  repository, and how the web client loads repository images given that the auth
  token is sent in a header.

Deployment guide (`docs/wiki/deployment.md`), once the architecture fixes the
details:

- Operator-facing parts of `docs/architecture/non-functional.md`: the data
  volume and optional repositories directory, the container UID, disk sizing,
  backup and restore, upgrades, the encryption key (including rotation and
  recovery from a lost key), `…_FILE` variables, log, metrics and low-space
  settings, and the hardened compose example.

Spikes (`docs/architecture/spikes.md`), each on its own `spike/<name>` branch,
never merged, time-boxed to 1–2 days; findings go back into the architecture
documents:

- Spike 3: Preview under the strict CSP (A-8.11 to A-8.13). Needs nothing
  external; suggested first.
- Spike 4: Git at 100,000 files (A-5.14). Needs a Linux kernel clone on hardware
  close to the reference host.
