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
health check that Docker runs every 10 seconds.

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

- the **JWT secret**, which signs login tokens;
- the **encryption key**, which encrypts the passwords, tokens and keys that
  Front Burner stores;
- the **setup token**, which only the person creating the first administrator
  knows (see [First start](#first-start)).

The compose example reads them from files, as Docker secrets, so that they do
not appear in the compose file or in `docker inspect`. Create them next to the
compose file:

```sh
mkdir -p secrets
openssl rand -hex 32 > secrets/jwt-secret
openssl rand -hex 32 > secrets/encryption-key
openssl rand -hex 16 > secrets/setup-token
sudo chown 1000:1000 secrets/*
sudo chmod 400 secrets/*
```

Docker mounts each file into the container as it is, so it must be readable by
UID 1000, which the last two commands make sure of.

**Back up `secrets/encryption-key` now, and keep the copy apart from your
backups of the data.** Without it, Front Burner cannot read the secrets it
stored. See [Required](#required) for what happens when it is lost.

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
`localhost`, for trying Front Burner out on your own computer.

### Why

When a user logs in, Front Burner keeps them logged in with a _refresh token_.
For security, the web client stores it in a browser cookie that is marked
`Secure`. Browsers only send `Secure` cookies over HTTPS, and do not even store
them when the page is opened over plain HTTP.

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
`healthy` once it is ready; until then the port refuses connections. If it shows
`restarting` or `unhealthy`, read the log, which says what is wrong:

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

You configure the container with environment variables.

### Required

| Variable                      | Meaning                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `FRONT_BURNER_JWT_SECRET`     | Secret used to sign login tokens. At least 32 characters. Generate a long random value and keep it private.                  |
| `FRONT_BURNER_ENCRYPTION_KEY` | Key that encrypts the passwords, tokens and keys Front Burner stores. At least 32 characters, different from the JWT secret. |

Each of them can also be read from a file: set `FRONT_BURNER_JWT_SECRET_FILE` or
`FRONT_BURNER_ENCRYPTION_KEY_FILE` to its path, for Docker and Podman secrets.

Front Burner does not start if either of them is missing or too short, or if
they are equal. The container log says which variable is wrong.

If you change `FRONT_BURNER_JWT_SECRET`, users stay logged in: their clients get
new tokens automatically.

Back up `FRONT_BURNER_ENCRYPTION_KEY` separately from the data volume. Front
Burner does not start with a different key, because it could not read the
secrets it stored. If the key is lost, start once with
`FRONT_BURNER_ENCRYPTION_KEY_RESET=confirm` and the new key: Front Burner
deletes every stored secret, and users and administrators enter them again. Then
remove `FRONT_BURNER_ENCRYPTION_KEY_RESET`.

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

Durations are a number followed by a unit: `s` (seconds), `m` (minutes), `h`
(hours) or `d` (days). For example `15m`, `12h` or `30d`.

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
| `FRONT_BURNER_OIDC_CLIENT_SECRET`          | Yes      | Client secret.                                                                        |
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
  stored secret (see [Required](#required)).
- **An image for `arm64`.**

If you forget the administrator's password, set a new one with the
`reset-password` command, with the instance stopped. It asks for the new
password twice and logs out every session of that user:

```sh
docker compose stop front-burner
docker compose run --rm front-burner node main.js reset-password <email>
docker compose start front-burner
```

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
read every file again. If your orchestrator checks that the instance is alive,
give it a generous start period, so that it doesn't restart the instance partway
through.

**A repository shows "Working copy is missing or damaged" after a failed pull.**
Front Burner could not undo a merge that failed, and has blocked the repository
to protect it. The container log gives the reason, such as a full disk. Fix the
cause and restart the instance: it tries again on every start, and the
repository comes back by itself when that works.

**Users are logged out every 15 minutes.** The instance is probably opened over
plain HTTP. See [HTTPS is required](#https-is-required).

**Login fails with "OIDC login failed".** Users always see the same message, so
that it does not reveal anything about their account. The container log, and the
login audit log in the database, contain the detailed reason, such as a wrong
client secret or a redirect URI that is not registered with the provider.

**Too many login attempts are refused, or everyone seems to come from the same
address.** Front Burner limits login attempts per address. Check that your
reverse proxy forwards the `X-Forwarded-For` header.
