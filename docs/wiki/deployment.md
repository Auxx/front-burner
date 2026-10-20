# Deploying Front Burner

This guide is for operators: the people who install, configure, upgrade and
back up a Front Burner instance.

Front Burner runs as a single rootless Docker container. The container serves
both the web client and the API from the same address.

## Before you start

You need:

- a host that can run Docker containers;
- a domain name for the instance, for example `notes.example.com`;
- an **HTTPS** certificate for that domain (see [HTTPS is required](#https-is-required));
- optionally, an OpenID Connect (OIDC) provider, if your users will sign in
  with it;
- optionally, an outgoing mail (SMTP) server. Without it, Front Burner cannot
  send invitations or password reset codes. You configure it later, in the
  system settings.

## HTTPS is required

Front Burner must be reached over **HTTPS**. Plain HTTP is supported only on
`localhost`, for trying Front Burner out on your own computer.

### Why

When a user logs in, Front Burner keeps them logged in with a _refresh token_.
For security, the web client stores it in a browser cookie that is marked
`Secure`. Browsers only send `Secure` cookies over HTTPS, and do not even
store them when the page is opened over plain HTTP.

### What happens over plain HTTP

If you open Front Burner over plain HTTP from any address other than
`localhost`, for example `http://192.168.1.10` on your home network:

- users can still log in;
- but they are **not kept logged in**. As soon as their short-lived login
  expires (15 minutes by default), they are sent back to the login page and
  must log in again;
- the login page shows a warning that the instance is not served over HTTPS.

This is not a bug, and there is no setting to turn it off. Serve the instance
over HTTPS instead.

### How to set up HTTPS

The usual way is to put a reverse proxy in front of the container. The reverse
proxy handles HTTPS and forwards requests to Front Burner. Common choices are
[Caddy](https://caddyserver.com/) (which gets certificates from Let's Encrypt
automatically), [Traefik](https://traefik.io/) and
[nginx](https://nginx.org/).

When you configure the reverse proxy:

- serve the web client and the API from **the same address**. Do not split
  them across different domains or ports, or login will not work;
- forward the original `Host` header, and the `X-Forwarded-For` and
  `X-Forwarded-Proto` headers, so that Front Burner knows the real address of
  each user and that the request came in over HTTPS;
- redirect plain HTTP to HTTPS.

If you only use Front Burner on your home network and cannot get a public
certificate, you can use a certificate from your own certificate authority,
as long as every device that opens Front Burner trusts it.

## Environment variables

You configure the container with environment variables.

### Required

| Variable                  | Meaning                                                                                                      |
|---------------------------|--------------------------------------------------------------------------------------------------------------|
| `FRONT_BURNER_JWT_SECRET` | Secret used to sign login tokens. At least 32 characters. Generate a long random value and keep it private. |

Front Burner does not start if `FRONT_BURNER_JWT_SECRET` is missing or too
short. The container log says which variable is wrong.

If you change `FRONT_BURNER_JWT_SECRET`, users stay logged in: their clients
get new tokens automatically.

### Login and sessions

| Variable                             | Default | Meaning                                                                   |
|--------------------------------------|---------|---------------------------------------------------------------------------|
| `FRONT_BURNER_AUTH_TOKEN_TTL`        | `15m`   | How long a login token is valid before the client renews it.              |
| `FRONT_BURNER_REFRESH_TOKEN_TTL`     | `30d`   | How long a user stays logged in before they must log in again.            |
| `FRONT_BURNER_LOGIN_AUDIT_RETENTION` | `90d`   | How long records of login attempts are kept.                              |

Durations are a number followed by a unit: `s` (seconds), `m` (minutes), `h`
(hours) or `d` (days). For example `15m`, `12h` or `30d`.

### First administrator

When an instance starts with no users, someone has to create the first
administrator. You can do this in the browser or with environment variables.

**In the browser.** Set a setup token, then open the instance. Only someone
who knows the token can create the first administrator.

| Variable                   | Meaning                                                                 |
|----------------------------|-------------------------------------------------------------------------|
| `FRONT_BURNER_SETUP_TOKEN` | A secret of at least 16 characters, entered on the onboarding page.     |

Once the first administrator exists, the setup token is ignored and you can
remove the variable.

**With environment variables (OIDC only).** Set all the required variables
below. The onboarding page is never shown. The first person to log in through
OIDC with the email in `FRONT_BURNER_ADMIN_EMAIL` becomes the administrator.

| Variable                                   | Required | Meaning                                                               |
|--------------------------------------------|----------|-----------------------------------------------------------------------|
| `FRONT_BURNER_OIDC_ISSUER`                 | Yes      | Issuer URL of the OIDC provider (HTTPS).                              |
| `FRONT_BURNER_OIDC_CLIENT_ID`              | Yes      | Client ID.                                                            |
| `FRONT_BURNER_OIDC_CLIENT_SECRET`          | Yes      | Client secret.                                                        |
| `FRONT_BURNER_OIDC_SCOPES`                 | No       | Scopes. Default `openid email profile`.                               |
| `FRONT_BURNER_OIDC_REQUIRE_VERIFIED_EMAIL` | No       | `true` or `false`. Accept only emails the provider says are verified. Default `true`. |
| `FRONT_BURNER_ADMIN_EMAIL`                 | Yes      | Email of the first administrator.                                     |

If only some of the required OIDC variables are set, Front Burner does not
start, and the container log says which ones are missing.

While these variables are set, they are the only source of the OIDC settings,
and the system settings show them read-only.

## Troubleshooting

**Users are logged out every 15 minutes.**
The instance is probably opened over plain HTTP. See
[HTTPS is required](#https-is-required).

**Login fails with "OIDC login failed".**
Users always see the same message, so that it does not reveal anything about
their account. The container log, and the login audit log in the database,
contain the detailed reason, such as a wrong client secret or a redirect URI
that is not registered with the provider.

**Too many login attempts are refused, or everyone seems to come from the
same address.**
Front Burner limits login attempts per address. Check that your reverse proxy
forwards the `X-Forwarded-For` header.
