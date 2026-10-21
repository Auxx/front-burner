Next requirements files to write, as these requirements leave them to separate files:
- Admin-assisted adding, plus the user's confirmation flow.
- The repository management page.
- Saved credentials and known-hosts management.
- Push and remotes, including adding credentials to a public repository and asking for a passphrase on other pages.
- Commit author name and email.
- HTML in Markdown preview: the whitelist of safe HTML tags and attributes that the live preview renders; every other tag, including scripts, is stripped.
- Live preview: how image paths are resolved, including site-absolute paths such as `/images/cover.png` that blog engines map to a folder inside the repository, and how the web client loads repository images given that the auth token is sent in a header.
