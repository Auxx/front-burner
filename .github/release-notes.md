<!--
  The template of every release's notes. The release workflow
  (.github/workflows/release.yml) fills in {{VERSION}}, {{IMAGE}}, {{DIGEST}}
  and {{REPOSITORY}} and creates a draft release with it. Complete the
  "Changes" and "Upgrading" sections in the draft before publishing it; remove
  this comment there too.
-->

## Changes

- …

## Upgrading

Any 1.x version upgrades directly to any later 1.x. _(For a new major version:
say here whether the last minor release of the previous major must be installed
first.)_

Database migrations run on the first start of the new version. Before the first
one, Front Burner writes a pre-upgrade snapshot of the database to `backups/` in
the data directory. Downgrades are not supported: to go back, restore that
snapshot and start the previous image; database changes made since the upgrade
are lost.

_(List here anything this release needs from the operator, such as a new
required variable, or write "Nothing else is needed.")_

## Image

```sh
docker pull {{IMAGE}}:{{VERSION}}
# or, pinned to this exact build:
docker pull {{IMAGE}}@{{DIGEST}}
```

The image is for `linux/amd64`.

## Verifying the image

The image is signed with cosign (keyless) by this repository's release workflow,
and comes with build provenance and a CycloneDX SBOM, which is also attached to
this release.

```sh
cosign verify {{IMAGE}}@{{DIGEST}} \
  --certificate-identity-regexp '^https://github\.com/{{REPOSITORY}}/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

gh attestation verify oci://{{IMAGE}}@{{DIGEST}} --repo {{REPOSITORY}}
```
