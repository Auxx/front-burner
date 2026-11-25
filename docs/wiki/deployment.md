# Deploying Front Burner

This guide is for operators: the people who install, configure, upgrade and back
up a Front Burner instance.

Front Burner runs as a single rootless Docker container. The container serves
both the web client and the API from the same address.

Installing takes these steps, each a section below:

1. [Check what you need](#before-you-start).
2. [Get the image](#the-image) and [verify it](#verifying-the-image).
3. [Prepare the volumes](#volumes-and-the-uid) and [the secrets](#secrets).
4. [Write the compose file](#compose-example) and
   [put HTTPS in front of it](#https-is-required).
5. [Start the instance and create the first administrator](#first-start).

Once it runs, [size its disk](#sizing-the-disk),
[back it up](#backup-and-restore) and [upgrade it](#upgrading) as the later
sections describe, and [watch it](#monitoring) through its log, health checks
and metrics. [Recovery](#recovery) says what to do when the encryption key or
the administrator's password is lost, and [Troubleshooting](#troubleshooting)
lists the usual problems.

## Before you start

You need:

- a Linux host for `linux/amd64` with Docker Engine and Docker Compose v2. The
  guide assumes Docker's usual daemon, which runs as root; under a rootless
  daemon or Podman, UID 1000 in the container is another UID on the host, and
  the `chown 1000:1000` commands below must use that UID instead;
- a domain name for the instance, for example `notes.example.com`;
- an **HTTPS** certificate for that domain, or a reverse proxy that gets one for
  you, such as Caddy (see [HTTPS is required](#https-is-required));
- `openssl`, to generate the secrets;
- optionally, an OpenID Connect (OIDC) provider, if your users will sign in with
  it;
- optionally,
  [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) and the
  [GitHub CLI](https://cli.github.com/), to verify the image.

You do not need a mail server: this release of Front Burner sends no email (see
[What this release does not have](#what-this-release-does-not-have)).

## The image

Front Burner is published as one image on the GitHub Container Registry:

```text
ghcr.io/<owner>/front-burner:<version>
```

`<owner>` is the GitHub account that publishes Front Burner, in lower case, and
`<version>` is a release, such as `1.0.0`; the
[releases](https://github.com/<owner>/front-burner/releases) list them. Each
release is also tagged with its `<major>.<minor>` line, such as `1.0`, and the
newest stable release with `latest`. Those tags move when a newer release comes
out, so use the exact version: the instance is then upgraded only when you
change it.

The image is for `linux/amd64` only. It runs as the non-root user with UID and
GID **1000**, keeps all its data in `/data`, listens on port `8080`, and has a
health check that Docker runs every 10 seconds. It brings its own init process
(`tini`), so `docker run --init` and Compose's `init: true` are not needed.

## Verifying the image

Every release image is signed with [cosign](https://docs.sigstore.dev/) by Front
Burner's release workflow on GitHub Actions, with no long-lived key, and comes
with build provenance and an SBOM (a CycloneDX list of everything in the image,
also attached to the GitHub release). Before you run a new version, check that
the image is the one the release workflow built:

```sh
cosign verify ghcr.io/<owner>/front-burner:<version> \
  --certificate-identity-regexp '(?i)^https://github\.com/<owner>/front-burner/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

gh attestation verify oci://ghcr.io/<owner>/front-burner:<version> \
  --repo <owner>/front-burner
```

The first command checks the signature, the second the build provenance. Each
ends with an error if the check fails; do not run the image then.

`cosign verify` prints the image's digest (`sha256:…`). To be sure that the
image you run is the one you verified, add it to the image in the compose file:
`ghcr.io/<owner>/front-burner:<version>@sha256:<digest>`.

## Volumes and the UID

Front Burner keeps everything in the `/data` volume: the database, the working
copies, database snapshots and its temporary files. The rest of the container is
read-only (see [Compose example](#compose-example)), so nothing else survives
when the container is re-created.

The container runs as UID and GID **1000**, which you cannot change. Front
Burner must be able to write to `/data`:

- **A named volume**, as in the compose example, needs nothing: Docker gives a
  new named volume to UID 1000 on first use.
- **A folder of the host** (a bind mount) must belong to UID 1000 before the
  first start:

  ```sh
  sudo mkdir -p <host-folder>
  sudo chown 1000:1000 <host-folder>
  ```

  and in the compose file, `<host-folder>:/data` replaces `data:/data`.

A folder that belongs to another user, often `root`, is the most common reason
for a first start to fail. Front Burner then exits at once, and Docker starts it
again and again: `docker compose ps` shows it as `restarting`. The container log
(`docker compose logs front-burner`) names the folder and the UID it needs, for
example:

```text
The data directory /data/db is not writable by UID 1000
```

Fix the owner with `sudo chown -R 1000:1000 <host-folder>`; the next restart
then succeeds.

### A separate volume for the repositories

The working copies can live on another volume, for example a larger, slower disk
while the database stays on an SSD. Set `FRONT_BURNER_REPOS_DIR` to the folder
in the container where you mount it, for example `/repositories`. Front Burner
then keeps the working copies, and the temporary and orphaned ones, in that
folder, in `repos/`, `tmp/` and `orphans/`; the database and its snapshots stay
in `/data`.

The folder:

- must exist before the start and belong to UID 1000, as above, so that a volume
  that failed to mount stops the start instead of filling the container;
- must be empty or hold only `repos/`, `tmp/` and `orphans/` (and `lost+found/`
  on a new file system), since Front Burner empties `tmp/` on every start;
- must not be inside `/data`, nor contain it.

The compose example has the lines to uncomment. Front Burner never moves working
copies between the two places: to move existing ones, stop the instance and move
`repos/` yourself. Until you do, Front Burner warns on every start that `/data`
still holds working copies.

## Secrets

Front Burner needs two secrets of its own, and one more for the first start:

- the **JWT secret** (`FRONT_BURNER_JWT_SECRET`), which signs the short-lived
  login tokens that clients send with every request;
- the **encryption key** (`FRONT_BURNER_ENCRYPTION_KEY`), which encrypts the
  passwords, tokens and SSH keys that users save for their remotes, and the OIDC
  client secret when it is set on the onboarding page;
- the **setup token** (`FRONT_BURNER_SETUP_TOKEN`), which only the person
  creating the first administrator knows (see [First start](#first-start)).

Two more are optional: the **metrics token** (see [Metrics](#metrics)) and the
**OIDC client secret**, when OIDC is set up with environment variables (see
[First administrator](#first-administrator)).

The compose example reads them from files, as Docker secrets, so that they do
not appear in the compose file or in `docker inspect`. Every secret can be given
this way, through its `…_FILE` variable (see
[Secrets in files](#secrets-in-files)). Create them next to the compose file:

```sh
mkdir -p secrets
openssl rand -hex 32 > secrets/jwt-secret
openssl rand -hex 32 > secrets/encryption-key
openssl rand -hex 16 > secrets/setup-token
sudo chown 1000:1000 secrets/*
sudo chmod 400 secrets/*
```

Each value is random: 64 characters for the JWT secret and the encryption key,
which must be at least 32 characters long and differ from each other, and 32 for
the setup token, which must be at least 16. Docker mounts each file into the
container as it is, so it must be readable by UID 1000, which the last two
commands make sure of.

### Keeping the encryption key

**Back up `secrets/encryption-key` now, and keep the copy apart from your
backups of the data.**

Front Burner never writes its secrets to the volumes: they come only from the
environment and the secret files. A stolen volume, or a stolen backup of it,
therefore holds the users' saved credentials only in encrypted form. Keep it
that way: store the copy of the key somewhere a thief of your backups would not
also find it, such as a password manager.

The key is also needed to restore a backup (see [Restoring](#restoring)). The
database holds a value encrypted with it, and Front Burner checks that value on
every start: with any other key it does not start. A lost key cannot be
recovered; the only way to start again is to
[delete every stored secret](#a-lost-encryption-key).

### Changing a secret

After you change a secret file, restart the container with `docker compose
restart front-burner`, since Front Burner reads the files only when it starts.

- **The JWT secret** can be changed at any time. Users stay logged in: login
  tokens signed with the old secret are refused, and clients get new ones
  automatically.
- **The encryption key cannot be changed in this release.** Front Burner cannot
  re-encrypt the stored secrets with a new key yet, so a new key means
  [deleting every stored secret](#a-lost-encryption-key). Change it only when
  the old one is lost.
- **The setup token** is ignored once the first administrator exists. You can
  delete `secrets/setup-token` then, together with its lines in `compose.yaml`
  (see [First start](#first-start)); Compose refuses to start a service whose
  secret file is missing.
- **The metrics token** can be changed at any time; give your scraper the new
  one.

## Compose example

Save this file as `compose.yaml`, in the folder that holds `secrets/`. It is
[`compose.example.yaml`](compose.example.yaml) in Front Burner's repository,
which Front Burner's tests start on every change.

```yaml
# Front Burner: the compose example of the deployment guide
# (docs/wiki/deployment.md, "Compose example").
#
# Replace <owner> and <version> in `image` below, create the three secret files
# in ./secrets as the guide's "Secrets" describes, then:
#
#   docker compose up -d
#
# The instance listens on 127.0.0.1:8080 only, for a reverse proxy on the same
# host that serves it over HTTPS (the guide's "How to set up HTTPS").
#
# CI starts this file, with a test image and test secrets, in the container
# suite of server-e2e (container.e2e.spec.ts).

services:
  front-burner:
    image: ghcr.io/<owner>/front-burner:<version>
    restart: unless-stopped
    # Time for running git operations to finish on a stop (Docker's default is 10s).
    stop_grace_period: 30s
    ports:
      - 127.0.0.1:8080:8080
    environment:
      FRONT_BURNER_JWT_SECRET_FILE: /run/secrets/front-burner-jwt-secret
      FRONT_BURNER_ENCRYPTION_KEY_FILE: /run/secrets/front-burner-encryption-key
      # Only for creating the first administrator; ignored once one exists.
      FRONT_BURNER_SETUP_TOKEN_FILE: /run/secrets/front-burner-setup-token
      # With a separate repositories volume (below):
      # FRONT_BURNER_REPOS_DIR: /repositories
    secrets:
      - front-burner-jwt-secret
      - front-burner-encryption-key
      - front-burner-setup-token
    volumes:
      - data:/data
      # Optional: working copies on another disk. The folder must exist and
      # belong to UID 1000 (the guide's "Volumes and the UID").
      # - /srv/front-burner-repositories:/repositories
    # Hardening: Front Burner writes only to /data, the repositories
    # directory and /tmp, and needs no privileges.
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true

secrets:
  front-burner-jwt-secret:
    file: ./secrets/jwt-secret
  front-burner-encryption-key:
    file: ./secrets/encryption-key
  front-burner-setup-token:
    file: ./secrets/setup-token

volumes:
  data:
```

What its settings do:

- **`restart: unless-stopped`** starts the instance again after a crash or a
  reboot of the host, but not after you stop it yourself.
- **`stop_grace_period: 30s`**: on a stop, Front Burner stops starting new git
  operations and gives the running ones up to 25 seconds to finish. Docker's
  default of 10 seconds would cut them short.
- **`ports`** publishes the instance on the host's `127.0.0.1` only, where a
  reverse proxy on the same host reaches it. Do not publish it on all addresses:
  users must reach it over HTTPS. Every program on the host can use this port,
  and Front Burner trusts the forwarded headers it sends there, so on a host
  that other people can log in to, run the reverse proxy in Compose instead and
  delete these lines (see
  [Caddy next to the compose example](#caddy-next-to-the-compose-example)).
- **`read_only`, `tmpfs`, `cap_drop` and `no-new-privileges`** harden the
  container: nothing can change the image's files, and processes in it cannot
  gain privileges. Front Burner needs nothing more. Keep them.

Other settings, such as OIDC, are environment variables, which you add under
`environment` (see [Environment variables](#environment-variables)). A secret
among them, such as `FRONT_BURNER_OIDC_CLIENT_SECRET`, can also be a Docker
secret, through its `…_FILE` variable.

## HTTPS is required

Front Burner must be reached over **HTTPS**. Plain HTTP is supported only on
`localhost`, for trying Front Burner out on your own computer, and not in
Safari: open `http://localhost` in another browser, such as Chrome or Firefox.

### Why

When a user logs in, Front Burner keeps them logged in with a _refresh token_.
For security, the web client stores it in a browser cookie that is marked
`Secure`. Browsers only send `Secure` cookies over HTTPS, and do not even store
them when the page is opened over plain HTTP. Chrome and Firefox make an
exception for `localhost`; Safari does not, so in Safari, `http://localhost`
behaves like any other plain HTTP address below. A login through OIDC uses a
`Secure` cookie too, so over plain HTTP it does not work at all.

### What happens over plain HTTP

If you open Front Burner over plain HTTP from any address other than
`localhost`, for example `http://192.168.1.10` on your home network:

- users can still log in;
- but they are **not kept logged in**. As soon as their short-lived login
  expires (15 minutes by default), they are sent back to the login page and must
  log in again;
- the login page shows a warning that the instance is not served over HTTPS.

This is not a bug, and there is no setting to turn it off. Serve the instance
over HTTPS instead.

### How to set up HTTPS

The usual way is to put a reverse proxy in front of the container. The reverse
proxy handles HTTPS and forwards requests to Front Burner. Common choices are
[Caddy](https://caddyserver.com/) (which gets certificates from Let's Encrypt
automatically), [Traefik](https://traefik.io/) and [nginx](https://nginx.org/).

When you configure the reverse proxy:

- serve the web client and the API from **the same address**. Do not split them
  across different domains or ports, or login will not work;
- forward the original `Host` header, and the `X-Forwarded-For` and
  `X-Forwarded-Proto` headers, so that Front Burner knows the real address of
  each user and that the request came in over HTTPS;
- redirect plain HTTP to HTTPS.

If you only use Front Burner on your home network and cannot get a public
certificate, you can use a certificate from your own certificate authority, as
long as every device that opens Front Burner trusts it.

Front Burner compresses its responses itself, so the reverse proxy does not need
to. Its web client is compressed once, when the image is built, and the API's
answers as they are sent. You do not need Caddy's `encode` or nginx's `gzip`; if
you turn them on anyway, they leave what is already compressed as it is.

### Caddy next to the compose example

Caddy gets and renews a Let's Encrypt certificate by itself, redirects plain
HTTP to HTTPS and forwards the headers above, so it needs only a few lines.
Before you start it, point your domain's DNS record at the host and open ports
80 and 443 to the internet: Let's Encrypt checks them before it issues the
certificate.

Next to `compose.yaml`, create a file named `Caddyfile`, with your domain in
place of `<your-domain>`:

```text
<your-domain> {
	reverse_proxy front-burner:8080
}
```

and a file named `compose.override.yaml`, which Docker Compose reads together
with `compose.yaml`:

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - 80:80
      - 443:443
      - 443:443/udp
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config

volumes:
  caddy-data:
  caddy-config:
```

Caddy reaches Front Burner by its service name, on the network that Docker
Compose creates for them, so **delete the two `ports` lines of the
`front-burner` service** in `compose.yaml`. Front Burner trusts the forwarded
headers of every address on a private network, such as that one, without any
setting; a published port would let any program on the host connect through
Docker's own private address and set those headers itself, for example to get
around the limit on login attempts.

`docker compose up -d` then starts both.

## First start

Start the instance from the folder that holds `compose.yaml`:

```sh
docker compose up -d
docker compose ps
```

The first start takes a few seconds. `docker compose ps` shows the instance as
`starting` until it is ready, and the port refuses connections meanwhile; then
it shows `healthy`. A later start among many working copies can take a minute or
more, as Front Burner checks each one first (with 2,500 of them, 45 to 85
seconds on a small server), and shows `starting` all that time. If it shows
`restarting` or `unhealthy`, or is still `starting` after a few minutes, read
the log, which says what is wrong:

```sh
docker compose logs front-burner
```

Then create the first administrator. Open `https://<your-domain>` in a browser:
Front Burner shows the **Administrator onboarding** page. Enter the setup token,
which you can print with:

```sh
sudo cat secrets/setup-token
```

and the administrator's email address and password. You are then logged in. Once
the administrator exists, the setup token is ignored: you can delete
`secrets/setup-token` and remove its lines from `compose.yaml`.

To sign in through OIDC instead, set it up before the first start, either on the
onboarding page or with environment variables (see
[First administrator](#first-administrator)).

To try Front Burner on the host itself, without HTTPS, open
`http://localhost:8080` there instead.

## Environment variables

You configure the container with environment variables. All of them start with
`FRONT_BURNER_`, and only the two in [Required](#required) must be set.

- **Durations** are a whole number of at least 1 followed by a unit: `s`
  (seconds), `m` (minutes), `h` (hours) or `d` (days). For example `15m`, `12h`
  or `30d`; write `90m` rather than `1.5h`.
- **Sizes** are a whole number of bytes, or a number followed by `KB`, `MB` or
  `GB`, where 1 KB is 1024 bytes. For example `500MB` or `1.5GB`.
- **An empty value** counts as not set, so the default applies.
- **A wrong value** stops the start: the container log lists every variable that
  is wrong and why, without showing secret values.
- **An unknown variable** that starts with `FRONT_BURNER_`, such as a misspelt
  one, is ignored, and the log warns about it.

Front Burner reads the variables, and the files that `…_FILE` variables name,
only when it starts. To change a variable, change the compose file and run
`docker compose up -d` again. To change only the contents of a secret file,
restart the container with `docker compose restart front-burner`: the compose
file has not changed, so `docker compose up -d` would keep the running container
and the old value.

### Required

| Variable                      | Meaning                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `FRONT_BURNER_JWT_SECRET`     | Secret used to sign login tokens. At least 32 characters. Generate a long random value and keep it private.                  |
| `FRONT_BURNER_ENCRYPTION_KEY` | Key that encrypts the passwords, tokens and keys Front Burner stores. At least 32 characters, different from the JWT secret. |

Each of them can also be read from a file (see
[Secrets in files](#secrets-in-files)).

Front Burner does not start if either of them is missing or too short, or if
they are equal. The container log says which variable is wrong.

See [Secrets](#secrets) for how to generate them, why the encryption key is
backed up apart from the data, and what changing each of them does.

| Variable                            | Meaning                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FRONT_BURNER_ENCRYPTION_KEY_RESET` | `confirm` deletes every stored secret on start if the encryption key does not match, so that a new key can be used. Unset by default. See [A lost encryption key](#a-lost-encryption-key). |

### Secrets in files

Every secret can also be read from a file, for Docker and Podman secrets: set
the variable ending in `_FILE` to the file's path, as the
[compose example](#compose-example) does. Front Burner reads the whole file,
without a final line break. Set either the variable or its `_FILE` variable, not
both; if the file cannot be read, Front Burner does not start.

| Variable                               | Holds                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `FRONT_BURNER_JWT_SECRET_FILE`         | `FRONT_BURNER_JWT_SECRET`                                                           |
| `FRONT_BURNER_ENCRYPTION_KEY_FILE`     | `FRONT_BURNER_ENCRYPTION_KEY`                                                       |
| `FRONT_BURNER_SETUP_TOKEN_FILE`        | `FRONT_BURNER_SETUP_TOKEN` (see [First administrator](#first-administrator))        |
| `FRONT_BURNER_OIDC_CLIENT_SECRET_FILE` | `FRONT_BURNER_OIDC_CLIENT_SECRET` (see [First administrator](#first-administrator)) |
| `FRONT_BURNER_METRICS_TOKEN_FILE`      | `FRONT_BURNER_METRICS_TOKEN` (see [Metrics](#metrics))                              |

### Server

| Variable                       | Default                            | Meaning                                                                                                                                                         |
| ------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FRONT_BURNER_PORT`            | `8080`                             | The HTTP port inside the container, from 1 to 65535. If you change it, change the container's side of `ports` in the compose file too.                          |
| `FRONT_BURNER_TRUSTED_PROXIES` | `loopback, linklocal, uniquelocal` | The reverse proxies whose `X-Forwarded-For` and `X-Forwarded-Proto` headers Front Burner trusts: a comma-separated list of IP addresses, CIDR ranges and names. |

Front Burner needs the forwarded headers to know each user's address, for the
login audit log and the limits on login attempts, and to know that a request
came in over HTTPS. The names in the default stand for the addresses of the
container's own host and of private networks (`127.0.0.0/8`, `::1`,
`169.254.0.0/16`, `fe80::/10`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
and `fc00::/7`), which is where a reverse proxy on the same host or in the same
Compose project connects from. If your reverse proxy connects from another
address, add it. If anything else on those networks can reach the container's
port, list only your reverse proxy's address, since a client that the instance
trusts can claim any address and pass for HTTPS.

### Storage

| Variable                 | Default            | Meaning                                                                                                                                         |
| ------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `FRONT_BURNER_DATA_DIR`  | `/data`            | The directory for all stored data. Keep the default in the container: the image, the compose example and this guide assume it.                  |
| `FRONT_BURNER_REPOS_DIR` | the data directory | The directory for the working copies, on another volume. See [A separate volume for the repositories](#a-separate-volume-for-the-repositories). |

### Low disk space

| Variable                          | Default | Meaning                                                                                                                         |
| --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `FRONT_BURNER_LOW_DISK_THRESHOLD` | `2GB`   | A size. When less space than this is free on the data volume or the repositories volume, space is low. `0` turns the check off. |

Front Burner checks free space when it starts and then every minute. While space
is low:

- adding a repository is refused, with "The server is running low on storage.
  Contact your administrator.";
- administrators see a banner, and the log has a warning;
- `/api/health/ready` reports `degraded`;
- saves, commits and synchronisation keep working, since they protect the users'
  work.

### Database snapshots

| Variable                            | Default | Meaning                                                                             |
| ----------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `FRONT_BURNER_DB_SNAPSHOT_INTERVAL` | `1d`    | A duration of at least `1h`. A new snapshot is written once the newest is this old. |
| `FRONT_BURNER_DB_SNAPSHOT_KEEP`     | `7`     | How many snapshots are kept, at least 1. Older ones are deleted.                    |

Front Burner writes a consistent copy of its database to `/data/backups/` while
it runs, so that a backup of the data volume always holds one, even if it
catches the live database mid-write. It checks every hour whether a snapshot is
due.

### Git

| Variable                         | Default | Meaning                                                                                                                                                                       |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FRONT_BURNER_CLONE_TIMEOUT`     | `30m`   | A clone that has not finished in this time is stopped, and the repository shows "Clone timed out".                                                                            |
| `FRONT_BURNER_CLONE_CONCURRENCY` | `2`     | How many clones run at the same time, from 1 to 16. Other clones wait their turn.                                                                                             |
| `FRONT_BURNER_GIT_TIMEOUT`       | `5m`    | Any other git operation, such as a fetch, pull, push or commit, that has not finished in this time is stopped and fails.                                                      |
| `FRONT_BURNER_KEY_UNLOCK_IDLE`   | `1h`    | How long an SSH key unlocked with its passphrase stays unlocked when no git operation uses it. It is also locked again when the user logs out and when Front Burner restarts. |

### SSH host keys

Before Front Burner connects to a remote over SSH, it checks the server's host
key. It knows the host keys of GitHub and Bitbucket Cloud; for any other server,
the user accepts its key when they add the repository.

| Variable                        | Meaning                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `FRONT_BURNER_KNOWN_HOSTS_FILE` | A file in OpenSSH `known_hosts` format whose host keys Front Burner knows instead of the built-in ones. Unset by default. |

Use it, for example, to add the host keys of your own git server, so that users
don't have to accept them. The file **replaces** the built-in host keys, so copy
them into it if you still want them:

```text
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=
github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=
bitbucket.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIazEu89wgQZ4bqs3d63QSMzYVa0MuJ2e2gKTKqu+UUO
bitbucket.org ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBPIQmuzMBuKdWeF4+a2sjSSpBK0iqitSQ+5BM9KhpexuGt20JpTVM7u5BDZngncgrqDMbWdxMWWOGtZ9UgbqgZE=
bitbucket.org ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDQeJzhupRu0u0cdegZIa8e86EG2qOCsIsD1Xw0xSeiPDlCr7kq97NLmMbpKTX6Esc30NuoqEEHCuc7yWtwp8dI76EEEB1VqY9QJq6vk+aySyboD5QF61I/1WeTwu+deCbgKMGbUijeXhtfbxSxm6JwGrXrhBdofTsbKRUsrN1WoNgUa8uqN1Vx6WAJw1JHPhglEGGHea6QICwJOAr/6mrui/oB7pkaWKHj3z7d1IC4KWLtY47elvjbaTlkN04Kc/5LFEirorGYVbt15kAUlqGM65pk6ZBxtaO3+30LVlORZkxOh+LKL/BvbZ/iRNhItLqNyieoQj/uh/7Iv4uyH/cV/0b4WDSd3DptigWq84lJubb9t/DnZlrJazxyDCulTmKdOR7vs9gMTo+uoIrPSb8ScTtvw65+odKAlBj59dhnVp9zd7QUojOpXlL62Aw56U4oO+FALuevvMjiWeavKhJqlR7i5n9srYcrNV7ttmDw7kf/97P5zauIhxcjX+xHv4M=
```

These are the keys that GitHub and Bitbucket publish, at
`https://api.github.com/meta` and `https://bitbucket.org/site/ssh`. Write one
host key per line as `host key-type key`, with `[host]:port` for a port other
than 22. Lines starting with `#` are comments. Hashed host names, as
`ssh-keyscan -H` writes them, are refused: write the host name in plain text.
Mount the file into the container read-only, for example as a Docker secret or a
`volumes` entry, and set the variable to its path inside the container. If the
file cannot be read or has a wrong line, Front Burner does not start, and the
log names the line.

Host keys that users accepted are kept per user, and the file does not change
them.

### Outbound connections

| Variable                              | Default | Meaning                                                                                                    |
| ------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `FRONT_BURNER_BLOCK_PRIVATE_NETWORKS` | `false` | `true` also refuses connections to private networks and to the container itself, for example from remotes. |

Front Burner never connects to link-local addresses, such as a cloud metadata
service, or to reserved ones.

### Login and sessions

| Variable                             | Default | Meaning                                                        |
| ------------------------------------ | ------- | -------------------------------------------------------------- |
| `FRONT_BURNER_AUTH_TOKEN_TTL`        | `15m`   | How long a login token is valid before the client renews it.   |
| `FRONT_BURNER_REFRESH_TOKEN_TTL`     | `30d`   | How long a user stays logged in before they must log in again. |
| `FRONT_BURNER_LOGIN_AUDIT_RETENTION` | `90d`   | How long records of login attempts are kept.                   |

### First administrator

When an instance starts with no users, someone has to create the first
administrator. You can do this in the browser or with environment variables.

**In the browser.** Set a setup token, then open the instance. Only someone who
knows the token can create the first administrator.

| Variable                   | Meaning                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `FRONT_BURNER_SETUP_TOKEN` | A secret of at least 16 characters, entered on the onboarding page. |

Once the first administrator exists, the setup token is ignored and you can
remove the variable.

**With environment variables (OIDC only).** Set all the required variables
below. The onboarding page is never shown. The first person to log in through
OIDC with the email in `FRONT_BURNER_ADMIN_EMAIL` becomes the administrator.

| Variable                                   | Required | Meaning                                                                               |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------------- |
| `FRONT_BURNER_OIDC_ISSUER`                 | Yes      | Issuer URL of the OIDC provider (HTTPS).                                              |
| `FRONT_BURNER_OIDC_CLIENT_ID`              | Yes      | Client ID.                                                                            |
| `FRONT_BURNER_OIDC_CLIENT_SECRET`          | Yes      | Client secret, or `FRONT_BURNER_OIDC_CLIENT_SECRET_FILE` with its path.               |
| `FRONT_BURNER_OIDC_SCOPES`                 | No       | Scopes. Default `openid email profile`.                                               |
| `FRONT_BURNER_OIDC_REQUIRE_VERIFIED_EMAIL` | No       | `true` or `false`. Accept only emails the provider says are verified. Default `true`. |
| `FRONT_BURNER_ADMIN_EMAIL`                 | Yes      | Email of the first administrator.                                                     |

If only some of the required OIDC variables are set, Front Burner does not
start, and the container log says which ones are missing.

While these variables are set, they are the only source of the OIDC settings,
and the system settings show them read-only.

### Limiting OIDC to a Slack workspace

> **Temporary.** Front Burner cannot invite or manage users yet. Until it can, a
> **required claim** lets a limited group, such as the members of one Slack
> workspace, log in through OIDC and get an account on their first login. Later
> versions replace it with proper user management.

When a required claim is set, Front Burner accepts an OIDC login only if the
provider's ID token has that claim with that value. Everyone who passes gets an
ordinary user account on their first login; everyone else sees "OIDC login
failed", and the login audit log records `claim-mismatch`. This also applies to
people who already have an account, and to the first administrator, who sees
that the required claim did not match.

Set it either in the **Required claim name** and **Required claim value** fields
of the onboarding page, or with these variables, which work with either way of
setting up OIDC and win over the fields:

| Variable                                 | Meaning                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `FRONT_BURNER_OIDC_REQUIRED_CLAIM_NAME`  | Name of the claim, or `none` to turn it off. Set both variables, or neither. |
| `FRONT_BURNER_OIDC_REQUIRED_CLAIM_VALUE` | Value the claim must have. Case-sensitive.                                   |

The variables are the only way to change the required claim after onboarding. To
turn it off, including one saved on the onboarding page, set
`FRONT_BURNER_OIDC_REQUIRED_CLAIM_NAME=none` without a value and restart. If you
remove both variables instead, a claim saved on the onboarding page applies
again. While either variable is set, the onboarding page says so instead of
offering the claim fields.

For Slack, create a Slack app with **Sign in with Slack** (OpenID Connect) and
use:

- issuer `https://slack.com`, and the app's client ID and client secret;
- scopes `openid email profile`;
- claim name `https://slack.com/team_id`;
- claim value: the workspace ID, which starts with `T`. It is in the workspace's
  URL when you open Slack in a browser (`https://app.slack.com/client/T…/…`).

### Logging

| Variable                     | Default | Meaning                                                                                                                                      |
| ---------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `FRONT_BURNER_LOG_LEVEL`     | `info`  | `error`, `warn`, `info` or `debug`. Each level also logs the levels before it.                                                               |
| `FRONT_BURNER_LOG_FORMAT`    | `json`  | `json` writes one JSON object per line, for log collectors; `pretty` is readable text, for development.                                      |
| `FRONT_BURNER_SERVER_TIMING` | `false` | `true` adds a `Server-Timing` header with each API request's duration on the server. Only for measuring performance; leave it off otherwise. |

Front Burner logs to the container's output only, which `docker compose logs
front-burner` shows. At `info` and above, the log names users, repositories and
requests by their internal IDs only. Email addresses, repository names and file
paths appear only at `debug`, so turn it on only while you look into a problem.
[The log](#the-log) describes what each line holds.

### Metrics

| Variable                     | Meaning                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `FRONT_BURNER_METRICS_TOKEN` | Turns on Prometheus metrics at `/api/metrics`, for scrapers that send this token. At least 16 characters. Unset by default. |

While it is not set, `/api/metrics` does not exist. When it is set, a scraper
must send `Authorization: Bearer <token>`; other requests get `401`. In
Prometheus, that is the scrape job's `authorization` setting, with the token in
`credentials_file`. Generate the token as the other secrets, for example with
`openssl rand -hex 16`, and give it through `FRONT_BURNER_METRICS_TOKEN_FILE`
(see [Secrets in files](#secrets-in-files)).
[Prometheus metrics](#prometheus-metrics) has a scrape job and lists the
metrics.

## Sizing the disk

Every user has their own working copy of each repository they add, even when
other users added the same remote. Disk use therefore grows with users, not with
remotes: ten users who add the same 2 GB remote use 20 GB.

Give the instance at least:

> **the sum, over every user, of the sizes of their repositories**
>
> \+ **10%** of that, for clones in progress in `tmp/`
>
> \+ **the low-space threshold** (`FRONT_BURNER_LOW_DISK_THRESHOLD`, 2 GB by
> default)
>
> \+ **1 GB** for the database and its snapshots in `backups/`

A repository's size is the size of a full clone, `.git` included; for a
single-branch clone it is smaller. The database itself stays small: it holds
accounts, settings and the login audit log, not the content of files. Each
snapshot is a copy of it, and `backups/` keeps `FRONT_BURNER_DB_SNAPSHOT_KEEP`
daily ones (7 by default) and a pre-upgrade snapshot per version you upgraded
from. 1 GB is plenty with the defaults; if you keep many more snapshots, allow
the database's size for each of them.

For example, five users who each add ten repositories of about 200 MB need 5 ×
10 × 200 MB = 10 GB, plus 1 GB for `tmp/`, 2 GB for the threshold and 1 GB for
the database: 14 GB. Give such an instance a 20 GB volume, so that it can grow.

With a
[separate volume for the repositories](#a-separate-volume-for-the-repositories),
the working copies and `tmp/` go on that volume and the database and snapshots
on `/data`. Front Burner checks the threshold on each volume, so each of them
needs its own share plus the threshold.

When less than the threshold is free, Front Burner refuses new repositories but
keeps saving, committing and synchronising (see
[Low disk space](#low-disk-space)). Add space before it runs out.

## Backup and restore

A full backup has two parts:

- **the volumes**: `/data`, and the repositories volume if you use one;
- **the secrets**, which are outside the volumes: at least
  `secrets/encryption-key`. Without it, Front Burner cannot read the passwords,
  tokens and SSH keys that users saved, and a restored instance does not start
  (see [Keeping the encryption key](#keeping-the-encryption-key)). Keep it apart
  from the backups of the volumes, so that one stolen backup does not hold both.

### What is in `/data`

```text
/data/
  db/front-burner.sqlite   the database (with -wal and -shm files beside it)
  repos/                   the working copies
  backups/                 database snapshots
  orphans/                 working copies without a repository
  tmp/                     clones in progress; emptied on every start
```

With a separate repositories volume, `repos/`, `orphans/` and `tmp/` are on that
volume instead.

`backups/` holds consistent copies of the database, which Front Burner writes
while it runs (see [Database snapshots](#database-snapshots)):

- a **daily snapshot**, such as
  `front-burner-2026-11-17T09-30-15Z-v1.4.2.sqlite`: the time it was written, in
  UTC, and the version that wrote it. By default one is written a day and the
  last seven are kept; `FRONT_BURNER_DB_SNAPSHOT_INTERVAL` and
  `FRONT_BURNER_DB_SNAPSHOT_KEEP` change both.
- a **pre-upgrade snapshot**, such as
  `pre-upgrade-v1.4.2-2026-11-17T09-30-15Z-v1.4.2.sqlite`, written before an
  upgrade changes the database (see [Upgrading](#upgrading)). The newest one for
  each version stays until you delete it.

They are on the same disk as the database, so they protect against a mistake or
a failed upgrade, not against losing the disk. Back up the volume as well.

### What a backup protects

- **The database** holds the accounts, the list of repositories and their
  settings, user preferences, saved credentials (encrypted) and the login audit
  log.
- **The working copies** can always be cloned again from their remotes. What a
  backup of them protects is the work that is not on a remote yet: commits that
  were not pushed and changes that were not committed. Front Burner saves edits
  to the working copy within seconds, so these include the latest edits.

### Backing up

The commands below are for the [compose example](#compose-example), whose
`/data` is a named volume. They run `tar` in a one-off container of the Front
Burner image, as UID 1000, and write the archive to a folder next to
`compose.yaml`. Run them from the folder that holds `compose.yaml`. If `/data`
is a folder of the host, you can archive that folder with the host's tools
instead.

1. Create the folder for the archives, once:

   ```sh
   mkdir -p volume-backups
   sudo chown 1000:1000 volume-backups
   ```

2. For a fully consistent backup, stop the instance first. Users cannot work
   until step 4:

   ```sh
   docker compose stop front-burner
   ```

   You can also skip this step and back up while the instance runs. The copy of
   the live database may then be inconsistent, if Front Burner wrote to it
   during the copy, but the copy always holds the newest snapshot in `backups/`,
   which is consistent: at most a day old with the default
   `FRONT_BURNER_DB_SNAPSHOT_INTERVAL`. A working copy copied while a git
   operation changed it may be damaged too.

3. Archive the volume:

   ```sh
   docker compose run --rm -v "$PWD/volume-backups:/volume-backups" front-burner \
     tar -czf "/volume-backups/front-burner-data-$(date -u +%Y-%m-%dT%H-%M-%SZ).tar.gz" -C /data .
   ```

   With a separate repositories volume, archive it too, with `-C /repositories`
   (the path you mounted it at), another file name, and `--exclude=./lost+found`
   before `-C`: a new file system's `lost+found/` belongs to `root`, and UID
   1000 cannot read it.

   While the instance runs, `tar` may warn that a file changed as it read it
   ("file changed as we read it", status 1), or that one vanished before it read
   it ("No such file or directory" or "File removed before we read it", status
   2), as git and the database remove their lock and journal files. The archive
   is still written; such a file is one of those step 2 describes. Any other
   message, such as "Permission denied" or "No space left on device", means the
   archive is not complete.

4. If you stopped the instance, start it again:

   ```sh
   docker compose start front-burner
   ```

5. Copy the archives in `volume-backups/` to another disk or host, and keep a
   copy of `secrets/` in a separate, safe place.

### Restoring

Restore into the same version of Front Burner that the backup was taken with, or
a newer one. An older version refuses a database from a newer one (see
[Going back after an upgrade](#going-back-after-an-upgrade)).

1. Stop the instance:

   ```sh
   docker compose stop front-burner
   ```

2. **Restore the secrets first**, at least `secrets/encryption-key`, with the
   owner and mode of [Secrets](#secrets). With another key, Front Burner does
   not start, and the log says:

   ```text
   Startup failed at step "encryption-key": FRONT_BURNER_ENCRYPTION_KEY does not match the key this instance's secrets were encrypted with. Use the right key, or start once with FRONT_BURNER_ENCRYPTION_KEY_RESET=confirm to delete every stored secret (NF-8.6).
   ```

   During a restore, do not reset: it deletes every password, token and SSH key
   that users saved. Find the key that belongs to the backup and restore it.

3. Empty the volume and unpack the archive into it:

   ```sh
   docker compose run --rm -v "$PWD/volume-backups:/volume-backups:ro" front-burner \
     sh -c 'find /data -mindepth 1 -maxdepth 1 ! -name lost+found -exec rm -rf {} + \
       && tar -xzf /volume-backups/<archive> -C /data'
   ```

   `<archive>` is the archive's file name. With a separate repositories volume,
   restore it the same way, with `/repositories` in place of `/data`; the
   command leaves its `lost+found/` alone.

4. **Optionally, replace the database with a snapshot.** Do this when the backup
   was taken while the instance ran, or to go back to an earlier day. List the
   snapshots:

   ```sh
   docker compose run --rm front-burner ls -l /data/backups
   ```

   and put the one you choose in place of the database, removing the database's
   `-wal` and `-shm` files, which belong to the old database:

   ```sh
   docker compose run --rm front-burner sh -c \
     'rm -f /data/db/front-burner.sqlite-wal /data/db/front-burner.sqlite-shm \
      && cp /data/backups/<snapshot> /data/db/front-burner.sqlite'
   ```

   Every change to the database since that snapshot is lost: accounts,
   repositories added or removed, preferences, saved credentials.

5. Start the instance:

   ```sh
   docker compose start front-burner
   docker compose ps
   ```

   The first start after a restore can take minutes with large repositories,
   since git reads every file again before the port opens (see
   [Troubleshooting](#troubleshooting)).

On start, Front Burner compares the database with the working copies:

- **A repository whose working copy is missing or damaged** shows "Working copy
  is missing or damaged" on the repository management page. Its user chooses
  **Clone again** there. This happens to repositories removed after the snapshot
  you restored, and to working copies a running backup caught mid-change.
- **A working copy without a repository** is moved to `orphans/`, never deleted,
  since it may hold unpushed work. This happens when the database is older than
  the working copies, for example after restoring a snapshot: repositories added
  after the snapshot are not in it. The log says, for each one:

  ```text
  Working copy of repository 12 (user 3) has no repository; moved to orphans/3-12-2026-11-16T10-00-00Z
  ```

  The folder is a whole git repository, named after the user and repository IDs
  and the time it was moved.

To recover the work in an orphaned working copy, copy it out of the volume:

```sh
docker compose cp front-burner:/data/orphans/<folder> ./<folder>
```

There, `git status` and `git log` show what was not pushed. The user adds the
repository again in Front Burner; you push the commits from the copy, or give
the user the files to put back. Then delete the folder from `orphans/`, which
Front Burner never empties:

```sh
docker compose exec front-burner rm -rf /data/orphans/<folder>
```

## Upgrading

Front Burner follows semantic versioning. Any 1.x release upgrades directly to
any later 1.x release. A new major version may need the last release of the
previous major version first; its release notes say so.

On start, a new version updates the database if it needs to. Before the first
change, it writes a **pre-upgrade snapshot** of the database, named after the
old version, to `backups/`. If an update fails, it is undone, the instance
stops, and the log says why: the database is as it was, and the old version
still starts.

There is no upgrade without downtime: the instance is unavailable while it
restarts, usually for seconds. Running git operations get time to finish (see
`stop_grace_period` in the [compose example](#compose-example)), and edits that
were not saved yet stay in the users' browsers until it is back. A browser tab
left open across the upgrade asks its user to reload.

To upgrade:

1. Read the release notes of every version between yours and the new one, on the
   [releases](https://github.com/<owner>/front-burner/releases) page.
2. [Verify the new image](#verifying-the-image).
3. Optionally, [back up](#backing-up). The pre-upgrade snapshot covers the
   database, but it is on the same disk.
4. In `compose.yaml`, change `<version>` in `image` to the new version. If the
   image ends with `@sha256:<digest>`, replace the digest with the one `cosign
   verify` printed for the new image, or remove it: Docker uses the digest and
   ignores the tag, so the old digest would start the old version again. Then
   pull the image and restart the instance with it:

   ```sh
   docker compose pull front-burner
   docker compose up -d
   ```

5. Check that it is `healthy` and runs the new version, and see whether the
   database was updated:

   ```sh
   docker compose ps
   docker compose exec front-burner ls -l /data/backups
   ```

   If it was, `backups/` holds a new `pre-upgrade-v<old version>-….sqlite`
   snapshot, and at the default log level the log names it:

   ```text
   Upgrading the database from 1.4.2 to 1.5.0; snapshot backups/pre-upgrade-v1.4.2-2026-11-17T09-30-15Z-v1.4.2.sqlite
   ```

   If the instance does not become `healthy`, read the log. If an update of the
   database failed, put the old version back in `compose.yaml` and run `docker
   compose up -d` again.

Delete pre-upgrade snapshots of versions you will not go back to; Front Burner
keeps them until you do.

### Going back after an upgrade

Front Burner cannot run on a database that a newer version has updated. An older
version refuses to start, and the log says:

```text
Database is from version 1.5.0; restore the pre-upgrade snapshot to go back
```

To go back to the version you upgraded from:

1. Stop the instance:

   ```sh
   docker compose stop front-burner
   ```

2. If the upgrade wrote no pre-upgrade snapshot, the database's schema was not
   changed and the old version starts on it: skip to step 4. Otherwise find the
   snapshot, `pre-upgrade-v<old version>-….sqlite`, written at the time of the
   upgrade:

   ```sh
   docker compose run --rm front-burner ls -l /data/backups
   ```

3. Put it in place of the database:

   ```sh
   docker compose run --rm front-burner sh -c \
     'rm -f /data/db/front-burner.sqlite-wal /data/db/front-burner.sqlite-shm \
      && cp /data/backups/<snapshot> /data/db/front-burner.sqlite'
   ```

   Every change to the database since the upgrade is lost, as in a restore.

4. In `compose.yaml`, put back the old version, with its digest if you pin one,
   and start it:

   ```sh
   docker compose up -d
   ```

Working copies do not depend on the version, so they stay as they are. Those of
repositories added since the upgrade move to `orphans/`, and repositories
removed since then show "Working copy is missing or damaged", as after a
[restore](#restoring).

## Monitoring

Front Burner tells you how it is doing in three ways: its log, two health
endpoints and, if you turn them on, Prometheus metrics.

### The log

Front Burner writes its log to the container's output only; there are no log
files on the volumes. Read it with:

```sh
docker compose logs front-burner
docker compose logs -f --since 10m front-burner
```

The second command shows the last ten minutes and then follows new lines. Docker
keeps the log until the container is re-created, and by default lets it grow
without limit. To cap it, add these lines to the `front-burner` service in
`compose.yaml`:

```yaml
logging:
  options:
    max-size: 10m
    max-file: '5'
```

Each line is one JSON object, for example:

```json
{"level":"warn","time":"2026-11-20T00:32:29.302Z","pid":1,"hostname":"3f2c9a7d1b04","module":"DiskMonitor","freeBytes":{"data":1610612736},"thresholdBytes":2147483648,"message":"The server is running low on storage: new clones are refused"}
```

| Field       | What it holds                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `time`      | When, in UTC.                                                                                                         |
| `level`     | `error`, `warn`, `info` or `debug`; `fatal` when the start fails, just before the container stops.                    |
| `message`   | What happened.                                                                                                        |
| `module`    | The part of Front Burner that wrote the line, such as `DiskMonitor`.                                                  |
| `requestId` | The request the line belongs to (see [Finding a user's error](#finding-a-users-error)).                               |
| `err`       | For an error: its type, message and stack.                                                                            |
| others      | Details of the event, such as `jobId`, `userId`, `type` (of a job) or `errorCode`. Users and jobs appear by their ID. |

Every request to the instance gets one `info` line when it ends:
`"message":"request completed"`, or `"request errored"` when the request failed,
as with a status of 500 or more. It has the request's method and address under
`req`, its status under `res.statusCode` and, for most API requests, its whole
path under `path`.

The log never contains passwords, tokens, keys or the content of files. At the
default level, `info`, it names users, repositories and jobs only by their
internal IDs. Addresses lose their query, which can hold a file's path or a
one-time code, and are cut down to the part that holds no file names, such as
`/api/v1/repositories/…` or `/repositories/…`: `path` is the whole path only for
API requests that reached one of Front Burner's routes (not, for example, those
refused for a missing login), since those hold only fixed words and IDs, such as
`/api/v1/repositories/12/files/file`. Email addresses, repository names and file
paths appear only at `debug` (see [Logging](#logging)); turn it on while you
look into a problem, and off again afterwards.

`FRONT_BURNER_LOG_FORMAT=pretty` prints each entry as readable text instead,
with the time, level and message on the first line and the other fields below
it. Use it when you read the log yourself, not for a log collector.

### Finding a user's error

When something fails, the web client shows the error with a **Reference**, the
first eight characters of the request's ID, for example `Reference: 9d806ef7`.
The repository management page shows the whole ID of a failed clone, as
**Request ID**. The same ID is in the `X-Request-Id` header of every response.

To find the log lines of that request, search for it:

```sh
docker compose logs --no-log-prefix front-burner | grep '"requestId":"9d806ef7'
```

This prints every line of the request: the `request completed` or `request
errored` line with its status, and any error or warning logged while it ran.
Look for a line with `"level":"error"` and its `err`, or a `warn` with an
`errorCode`.

A clone or a pull that failed in the background is a job: its lines carry a
`jobId` instead, and the line `A job failed` gives the job's `type` and
`errorCode`.

### Health checks

| Endpoint            | Answers                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `/api/health/live`  | `{"status":"ok"}` while the process runs.                                                         |
| `/api/health/ready` | `{"status":"ok"}`, `{"status":"degraded"}` or, with status `503`, `{"status":"fail"}`. See below. |

Both need no login and reveal nothing about the instance, so a load balancer or
uptime monitor can call them. The image's health check calls `/api/health/ready`
every 10 seconds, and `docker compose ps` shows its result. While the instance
starts, failed checks don't count for the first 5 minutes, so that a long start
shows as `starting`, not `unhealthy`; Docker Engine 25 or later also checks
every 2 seconds meanwhile, so that `healthy` comes soon after the instance is
ready.

`/api/health/ready` answers only once the start is complete: the database
updated, the working copies checked and interrupted jobs handled. Then it
reports:

- **`ok`**: everything works.
- **`degraded`**: the instance works, but [space is low](#low-disk-space) on the
  data volume or the repositories volume, so new repositories are refused. The
  answer is still `200`, so Docker shows the container as `healthy`; watch for
  `degraded` yourself, or use the `front_burner_disk_free_bytes` metric (see
  [Prometheus metrics](#prometheus-metrics)).
- **`fail`**, with status `503`: the database cannot be read, or `/data` or the
  repositories directory cannot be written to. Docker shows the container as
  `unhealthy` after three failed checks in a row. The log usually says why.

### Prometheus metrics

Once you set `FRONT_BURNER_METRICS_TOKEN` (see [Metrics](#metrics) under
Environment variables), Front Burner serves Prometheus metrics at
`/api/metrics`. A Prometheus scrape job for it, with the token in a file next to
Prometheus's configuration:

```yaml
scrape_configs:
  - job_name: front-burner
    scheme: https
    metrics_path: /api/metrics
    authorization:
      credentials_file: /etc/prometheus/front-burner-metrics-token
    static_configs:
      - targets: ['<your-domain>']
```

Every metric's name starts with `front_burner_`. None of them has a label that
names a user, a repository or a file.

| Metric                                        | Type      | Labels                      | What it measures                                                                                             |
| --------------------------------------------- | --------- | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `front_burner_http_request_duration_seconds`  | histogram | `method`, `route`, `status` | API requests, by route pattern such as `/api/v1/repositories/:id`. `status` is `aborted` if the client left. |
| `front_burner_jobs_queued`                    | gauge     | `type`                      | Jobs waiting to run, by job type.                                                                            |
| `front_burner_job_duration_seconds`           | histogram | `type`, `result`            | Jobs that ran, by type and result: `done`, `failed`, `cancelled` or `retried`.                               |
| `front_burner_job_failures_total`             | counter   | `type`                      | Jobs that ended failed, by type, including jobs a restart interrupted.                                       |
| `front_burner_clones`                         | gauge     | `state`                     | Clones `running`, and clones `waiting` for a free slot (see `FRONT_BURNER_CLONE_CONCURRENCY`).               |
| `front_burner_git_operation_duration_seconds` | histogram | `operation`                 | Git operations, such as `clone`, `fetch`, `push`, `status`, `commit` or `merge`, whether they worked or not. |
| `front_burner_disk_free_bytes`                | gauge     | `volume`                    | Free bytes on the data volume (`data`) and, if it is another file system, the repositories volume (`repos`). |
| `front_burner_active_sessions`                | gauge     | —                           | Logins that have not expired or ended, of every user together.                                               |

The usual Node.js and process metrics follow, with the same prefix, such as
`front_burner_process_resident_memory_bytes` and
`front_burner_nodejs_eventloop_lag_seconds`.

Job types include `repositories.clone`, `sync.fetch`, `sync.pull` and
`sync.push`, which users start, and housekeeping jobs such as
`database.snapshot` and `storage.disk-check`.

Worth an alert:

- `front_burner_disk_free_bytes` below your `FRONT_BURNER_LOW_DISK_THRESHOLD`,
  or better, approaching it;
- `front_burner_job_failures_total` rising for `database.snapshot`: daily
  snapshots are not being written;
- `front_burner_clones{state="waiting"}` staying above zero for long: clones
  queue behind each other.

### Low and full disk

Front Burner checks free space when it starts and then every minute. When less
than `FRONT_BURNER_LOW_DISK_THRESHOLD` (2 GB by default) is free on either
volume, it logs a warning once:

```text
The server is running low on storage: new clones are refused
```

with the free bytes of each volume and the threshold. From then on, until space
is freed, adding a repository is refused, administrators see a banner, and
`/api/health/ready` reports `degraded` (see [Low disk space](#low-disk-space)).
Saves, commits and synchronisation go on. Once enough is free again, it logs:

```text
The server has enough storage again
```

If the disk fills up entirely:

- **A save fails**, and the user's editor shows "Server storage is full — not
  saved". The edits stay in the user's browser, which tries the save again on
  its own, so nothing is lost once space is freed. The file on disk keeps its
  last saved content. The log has a `request errored` line with status `507`.
- **A git operation fails**, such as a clone, pull or commit, and the user sees
  "Server storage is full. Contact your administrator." It is undone as if a
  restart had interrupted it: a clone's partial copy is removed, and a pull that
  was merging goes back to the commit it started from. A background job's `A job
  failed` line has `"errorCode":"storage-full"`.
- **The database** rolls back the change it was writing, so it stays consistent.

To free space, add space to the volume, or delete what you no longer need:
pre-upgrade snapshots of versions you will not go back to, and folders in
`orphans/` (see [Orphaned working copies](#orphaned-working-copies)). Do not
delete anything in `repos/`: those are the users' working copies. Users can also
remove repositories they no longer use.

### Orphaned working copies

A working copy without a repository in the database is moved to `orphans/` when
Front Burner starts, never deleted, since it may hold work that was not pushed.
This happens when the database is older than the working copies, such as after
[restoring](#restoring) a snapshot or
[going back after an upgrade](#going-back-after-an-upgrade). The log has one
warning for each:

```text
Working copy of repository 12 (user 3) has no repository; moved to orphans/3-12-2026-11-16T10-00-00Z
```

Front Burner never empties `orphans/`. List it now and then:

```sh
docker compose exec front-burner ls -l /data/orphans
```

(`/repositories/orphans`, or the path you chose, with a separate repositories
volume.) [Restoring](#restoring) says how to get the work out of a folder and
then delete it.

## Recovery

### A lost encryption key

If the encryption key is lost, or Front Burner is started with another one, it
does not start, and the log says:

```text
Startup failed at step "encryption-key": FRONT_BURNER_ENCRYPTION_KEY does not match the key this instance's secrets were encrypted with. Use the right key, or start once with FRONT_BURNER_ENCRYPTION_KEY_RESET=confirm to delete every stored secret (NF-8.6).
```

First look for the right key: in your copy of `secrets/`, and, if you have just
restored a backup, the key that was in use when that backup was taken. The reset
below cannot be undone.

If the key is really lost, start with a new key and delete every secret that the
old one encrypted:

1. Stop the instance, and replace the key file with a new key:

   ```sh
   docker compose stop front-burner
   sudo rm secrets/encryption-key
   openssl rand -hex 32 | sudo tee secrets/encryption-key > /dev/null
   sudo chown 1000:1000 secrets/encryption-key
   sudo chmod 400 secrets/encryption-key
   ```

2. In `compose.yaml`, add this line under `environment`:

   ```yaml
   FRONT_BURNER_ENCRYPTION_KEY_RESET: confirm
   ```

3. Start the instance:

   ```sh
   docker compose up -d
   docker compose logs front-burner
   ```

   On this start, Front Burner deletes every stored secret and stores a new
   check value for the new key. The log says:

   ```text
   FRONT_BURNER_ENCRYPTION_KEY_RESET: every stored secret was deleted and a new check value stored. Remove the variable.
   ```

4. Remove the line from `compose.yaml` and run `docker compose up -d` again.

5. [Back up the new key](#keeping-the-encryption-key), and
   [back up the data](#backing-up) now. Every backup taken before the reset
   needs the lost key: restoring one later means another reset, which deletes
   the credentials users have entered since.

If you forget step 4, nothing more is deleted: the reset acts only when the key
does not match, and the new key matches. Front Burner instead logs a warning on
every start until you remove the variable:

```text
FRONT_BURNER_ENCRYPTION_KEY_RESET is set but the key matches; nothing was deleted. Remove the variable.
```

What the reset deletes and what it keeps:

- **Kept:** users and their logins, sessions, repositories, working copies with
  their files, unpushed commits and uncommitted changes, user preferences and
  accepted host keys. Nobody is logged out.
- **Deleted:** every password, token and SSH key that users saved for their
  remotes. Each user gives their repositories new credentials: a fetch, pull or
  push says "These saved credentials are no longer available. Add them again.",
  with an **Add credentials** button, and the repository management page offers
  **Change credentials**. A user who used an SSH key adds a new one; for a key
  that Front Burner generates, they add its public key on the git hosting
  provider again. Public repositories need nothing.
- **Deleted:** the OIDC client secret, if OIDC was set up on the onboarding
  page. OIDC login then stops working, and the onboarding page is not shown
  again. Give the OIDC settings as environment variables instead (see
  [First administrator](#first-administrator)), with the same issuer, client ID
  and client secret, and the administrator's email in
  `FRONT_BURNER_ADMIN_EMAIL`. The variables then replace every OIDC setting of
  the onboarding page, so if you changed the scopes or turned off **Require
  verified email** there, set `FRONT_BURNER_OIDC_SCOPES` and
  `FRONT_BURNER_OIDC_REQUIRE_VERIFIED_EMAIL` to match; otherwise their defaults
  apply. A required claim saved there still applies. OIDC settings given as
  environment variables were never stored, so they are not affected.

### A lost password

Front Burner sends no email in this release, so there is no **Forgot password?**
link. If the administrator forgets their password, the operator sets a new one
with the `reset-password` command:

1. Stop the instance:

   ```sh
   docker compose stop front-burner
   ```

2. Run the command in a new container on the same volumes, with the user's
   email:

   ```sh
   docker compose run --rm front-burner node main.js reset-password <email>
   ```

   It asks for the new password twice, without showing it. The password must
   meet the same rules as on the onboarding page; if it doesn't, or the two
   entries differ, the command says why and changes nothing. On success it logs
   one warning, whose message is "Password of user <ID> reset from the command
   line; every session revoked".

3. Start the instance:

   ```sh
   docker compose start front-burner
   ```

The user then logs in with the new password. Every session of that user has
ended, on every device, so a stolen session is no use either.

**Never run the command with `docker exec` or `docker compose exec` in the
running container.** The command cannot tell whether the instance is running. A
running instance remembers the sessions that are in use, and would go on
accepting the ones the command revoked until it restarts.

The command refuses, with one line and no change, when:

- there is no password user with that email: an **OIDC user**, such as an
  administrator who signs in through OIDC, has no password in Front Burner and
  gets back in by resetting their password with the OIDC provider;
- the user is disabled;
- there is no database yet: the instance has never been started;
- the database needs an upgrade: start the new version once, stop it, and run
  the command again;
- the database is from a newer version than the image, as after
  [going back after an upgrade](#going-back-after-an-upgrade) without restoring
  the snapshot: run the command with the image of the version that wrote the
  database.

## What this release does not have

This first release of Front Burner is for one operator, who is also the
instance's only administrator and its main user. These come in later releases:

- **Email.** Front Burner sends none and has no SMTP settings, so there are no
  invitations and no password reset by email; the login page has no **Forgot
  password?** link.
- **User management.** Administrators cannot create, invite or disable users.
  The only way for other people to get an account is OIDC with a
  [required claim](#limiting-oidc-to-a-slack-workspace).
- **The Simple and Guided git control levels.** Every repository uses the
  Advanced level.
- **Pull requests**, and adding repositories on a user's behalf.
- **Uploading files.**
- **Changing a password while logged in.**
- **Rotating the encryption key.** It can only be replaced by deleting every
  stored secret (see [A lost encryption key](#a-lost-encryption-key)).
- **An image for `arm64`.**

If you forget the administrator's password, see
[A lost password](#a-lost-password).

## Troubleshooting

**The container keeps restarting, and the log says "is not writable by UID
1000".** The data volume, or the repositories volume, belongs to another user.
See [Volumes and the UID](#volumes-and-the-uid).

**The log says that `FRONT_BURNER_JWT_SECRET_FILE` or another `…_FILE`
variable's file could not be read.** The secret file does not exist, or UID 1000
cannot read it. See [Secrets](#secrets).

**The instance takes a long time to start, or a health check restarts it.** On
start, Front Burner checks every working copy before it opens its port, so the
port refuses connections meanwhile. This usually takes moments, but it can take
minutes after restoring a backup of large repositories, since git then has to
read every file again. The image's own health check waits 5 minutes before it
counts a failure (see [Health checks](#health-checks)); a start that takes
longer shows as `unhealthy` from about five and a half minutes until it ends.
Docker Compose doesn't act on that, but an orchestrator such as Docker Swarm or
Kubernetes may: if yours checks that the instance is alive, give it a generous
start period, so that it doesn't restart the instance partway through.

**A repository shows "Working copy is missing or damaged" after a failed pull.**
Front Burner could not undo a merge that failed, and has blocked the repository
to protect it. The container log gives the reason, such as a full disk. Fix the
cause and restart the instance: it tries again on every start, and the
repository comes back by itself when that works.

**The container stops at once and keeps restarting, and the log names a
migration or a newer database.** The last line of each start, at level `fatal`,
starts with `Startup failed at step "migrations"`.

- If it goes on with `Database is from version 1.5.0; restore the pre-upgrade
  snapshot to go back` (or `from a newer version`), the image is older than the
  version that last updated the database, as when you put an older version back
  in `compose.yaml`. Start the newer version again, or follow
  [Going back after an upgrade](#going-back-after-an-upgrade).
- Otherwise an update of the database failed. It was undone, so the database is
  as it was, and the version you upgraded from still starts on it: put it back
  in `compose.yaml` and run `docker compose up -d`, then report the message with
  the version numbers. If the update failed while writing the pre-upgrade
  snapshot, the reason is often a full disk.

**Adding a repository fails with "The server is running low on storage. Contact
your administrator."** Less than `FRONT_BURNER_LOW_DISK_THRESHOLD` is free on
the data volume or the repositories volume. Free space or add it (see
[Low and full disk](#low-and-full-disk)); within a minute of that, adding
repositories works again, and the log says "The server has enough storage
again". The threshold keeps space for the work users already have, so lower it
only if you know the volume will not fill up.

**Saves fail with "Server storage is full — not saved".** The disk is full.
Users' edits are kept in their browsers and saved on their own once there is
space. Free space at once (see [Low and full disk](#low-and-full-disk)); git
operations fail meanwhile too.

**A folder appeared in `orphans/`.** Front Burner found a working copy whose
repository is not in the database and moved it there on start, which happens
after restoring a backup or a snapshot, or going back after an upgrade. It may
hold work that was not pushed. See
[Orphaned working copies](#orphaned-working-copies) and [Restoring](#restoring)
for how to recover it.

**Users are logged out every 15 minutes.** The instance is probably opened over
plain HTTP. See [HTTPS is required](#https-is-required).

**Login fails with "OIDC login failed".** Users always see the same message, so
that it does not reveal anything about their account. The container log, and the
login audit log in the database, contain the detailed reason, such as a wrong
client secret or a redirect URI that is not registered with the provider.

**Too many login attempts are refused, or everyone seems to come from the same
address.** Front Burner limits login attempts per address. Check that your
reverse proxy forwards the `X-Forwarded-For` header.
