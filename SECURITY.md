# Security policy

This project (name **Multiverse Video**; code name Match Feed) is published by
**Multiverse Games**. It is a privacy tool, so we treat privacy flaws as security
flaws: if something lets a server, relay, peer or observer learn what a user watched,
endorsed or matched with, beyond what [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)
says they can, please report it here.

## Status

Everything here is an early prototype. **Nothing has had an external security review
or audit.** The Match protocol (`packages/match`) and OpenMined PSI are unaudited, and
the Match rumor kinds are provisional. Please don't rely on this software to protect
anyone yet.

| Version | Supported |
|---|---|
| `main` branch | yes |
| The latest web release (tag `web-v*`) | yes |
| Anything older | no: please upgrade first |

## Reporting a vulnerability

**Please don't open a public issue, pull request or discussion for a vulnerability.**

Use either private channel:

1. **GitHub private vulnerability reporting**:
   https://github.com/lizthedotdev/distributed_recommendations/security/advisories/new
   (the repository owner must turn it on: Settings, Code security, "Private vulnerability
   reporting"; see [`docs/DEPLOY.md`](docs/DEPLOY.md)).
2. **Email**: `security@example.org` <!-- PLACEHOLDER: Multiverse Games' security inbox. Keep in sync with infra/web/.well-known/security.txt -->

Please include:

- what is affected (package or app, version or commit, and the deployment URL for the
  web client)
- steps to reproduce, or a proof of concept
- the impact as you see it: which threat in `docs/THREAT_MODEL.md` (T1–T26) it breaks,
  or the new threat it adds
- whether you want public credit, and under what name

If you need encryption, ask in your first message and we'll set up a channel.

## What happens next

| Step | Target |
|---|---|
| We confirm we got your report | within 3 working days |
| First assessment (accepted or not, and severity) | within 10 working days |
| Fix or mitigation released | within 90 days of the report, sooner for critical issues |
| Public advisory | when the fix is released, or at 90 days, whichever comes first, unless we agree otherwise |

We'll keep you posted, credit you in the advisory if you want, and ask before
disclosing anything you didn't already make public. There is no bug bounty.

## Scope

In scope:

- `packages/core`, `packages/match`, `packages/bridge`, `apps/web`, `apps/mobile`, and
  the desktop app once it lands
- the protocol and formats in `docs/PROTOCOL.md` and `docs/MATCH.md`
- the self-hosted relay setup in `infra/relay/` (config, write policy, log policy)
- the release pipeline in `.github/` (anything that could ship a build that does not
  match the source, see T13)

Out of scope (report these upstream):

- PeerTube instances, Nostr relays and IPFS gateways run by others
- bugs in upstream dependencies that don't affect this project's use of them
- limits the threat model already lists as accepted or not yet implemented, unless
  you show them to be worse than documented
- volumetric denial of service, spam and social engineering

## Safe harbor

We won't pursue or support legal action against good-faith research that follows this
policy: test only against your own accounts, keys, local builds and relays (the repo
ships an in-memory relay and `apps/web` has `npm run dev-relay`); don't access other
people's data; don't degrade services; and give us reasonable time to fix before you
disclose.

## Verifying releases

Web releases from `.github/workflows/deploy-web.yml` carry a SLSA build-provenance
attestation signed through Sigstore, and the build is checked to be reproducible:

```sh
gh attestation verify web-dist.tar.gz --repo lizthedotdev/distributed_recommendations
```

The release's IPFS root CID can be recomputed from the same commit (see
[`infra/web/README.md`](infra/web/README.md)).
