Next requirements files to write for the MVP (`docs/product/mvp.md`), in the
suggested order of work:

- Git at the Advanced level: status, diff, discard, commit, push, pull (merge),
  branches, fetch notices, and conflict resolution by conflict markers, Use my /
  their version and abort (from D-4, D-5 and D-6).
- Push credentials and asking for a passphrase on other pages, including
  adding credentials to a repository that was added without them.
- The repository management page (minimal: list, retry clone, replace
  credentials, remove).

Requirements files deferred until after the MVP:

- Admin-assisted adding, plus the user's confirmation flow.
- Saved credentials and known-hosts management.
- Changing a repository's remote.
- Live preview: mapping site-absolute image paths such as `/images/cover.png`
  to the folder a blog engine uses (for example Hexo's `source/`), per
  repository. Until then they resolve from the repository root (IM-2).
- User management, invitations and onboarding of invited users, and SMTP in
  system settings.
- The Simple and Guided levels, and pull requests.
- Editor: basic code formatting from the repository's `.editorconfig` (for
  example indent style and size, line endings, final newline and trimming
  trailing spaces), applied while typing and on save. Until then the editor
  changes nothing on its own (ED-9, ED-12).

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

- Check typing in a 1 MB file on a real mid-range phone (NF-2.4): spike 3
  measured 40–56 ms per keystroke in emulation, at the limit (A-8.11).
- Spike 4: Git at 100,000 files (A-5.14). Needs a Linux kernel clone on hardware
  close to the reference host.
