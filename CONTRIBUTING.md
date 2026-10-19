# Contributing

Thanks for helping. This project (working name Meme Video; code name Match Feed) is
published by The Multiverse School. Start with [`README.md`](README.md) for the layout
and how to run each part, and [`docs/DESIGN.md`](docs/DESIGN.md) and
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for why things are the way they are.

**Security or privacy bugs:** don't open an issue. Follow [`SECURITY.md`](SECURITY.md).

## Developer Certificate of Origin (DCO)

We use the [Developer Certificate of Origin 1.1](https://developercertificate.org/)
instead of a CLA, so nobody, including us, can relicense your work as closed source
later (see `docs/OSS_STACK.md`, "Suggested license"). Every commit must be signed off:

```sh
git commit -s -m "core: cap explore slots per page"
```

That adds a line with your real name (or the name you're known by) and an email you
control, matching the commit author:

```
Signed-off-by: Ada Lovelace <ada@example.org>
```

By adding it you certify the DCO:

> Developer Certificate of Origin
> Version 1.1
>
> Copyright (C) 2004, 2006 The Linux Foundation and its contributors.
>
> Everyone is permitted to copy and distribute verbatim copies of this
> license document, but changing it is not allowed.
>
> Developer's Certificate of Origin 1.1
>
> By making a contribution to this project, I certify that:
>
> (a) The contribution was created in whole or in part by me and I
>     have the right to submit it under the open source license
>     indicated in the file; or
>
> (b) The contribution is based upon previous work that, to the best
>     of my knowledge, is covered under an appropriate open source
>     license and I have the right under that license to submit that
>     work with modifications, whether created in whole or in part
>     by me, under the same open source license (unless I am
>     permitted to submit under a different license), as indicated
>     in the file; or
>
> (c) The contribution was provided directly to me by some other
>     person who certified (a), (b) or (c) and I have not modified
>     it.
>
> (d) I understand and agree that this project and the contribution
>     are public and that a record of the contribution (including all
>     personal information I submit with it, including my sign-off) is
>     maintained indefinitely and may be redistributed consistent with
>     this project or the open source license(s) involved.

CI checks the sign-off on every commit in a pull request (`DCO sign-off` job in
`.github/workflows/ci.yml`). Forgot it?

```sh
git commit --amend -s --no-edit             # last commit
git rebase --signoff origin/main             # every commit on your branch
git push --force-with-lease
```

Code written with an AI assistant is fine. You are still the one certifying the DCO,
so review it as your own, and note the assistance in the commit message (for example
a `Co-Authored-By:` trailer).

## Licenses

`packages/core`, `packages/match`, `packages/bridge` and `apps/web` are Apache-2.0; the
self-hosted fonts are OFL-1.1. Contributions are accepted under the license of the
directory they land in. Don't copy code from AGPL, GPL or source-available projects
into these packages (see `docs/OSS_STACK.md`, "License compatibility").

## Pull requests

- Keep each PR to one topic, and describe what changed and why.
- Run the checks for what you touched. CI runs the same ones:

  | Part | Commands |
  |---|---|
  | `packages/core` | `npm test` |
  | `packages/match`, `packages/bridge` | `npm ci && npm test && npm run typecheck` |
  | `apps/web` | `(cd ../../packages/match && npm ci)`, then `npm ci && npm test && npm run typecheck && npm run build` |
  | `sim/` | `python3 -m unittest discover -s sim/tests -t .` (from the repo root) |
  | `infra/relay/` | see `infra/relay/README.md`, "Testing" |

- The web build must stay **reproducible**: two clean builds give byte-identical
  `dist/`. Check with `.github/scripts/check-web-reproducible.sh`. Don't embed
  timestamps, random IDs, absolute paths or the machine's environment in build output.
- Tests stay offline. Never point tests or development at public relays or instances
  you don't run.
- Update the docs (`README.md`, `docs/`, package READMEs) when behaviour changes, and
  the threat model when a mitigation's status changes.

## Dependencies

The supply chain is part of the threat model (T13, T24):

- Pin exact versions (`save-exact=true`) and commit the lockfile.
- Packages that set `ignore-scripts=true` in their `.npmrc` keep it, and CI installs them
  with `--ignore-scripts`. If a new dependency needs an install script, say why in the PR.
- Prefer no dependency over a small one. For each new one, give its license, maintainer
  activity and audit status in the PR, and add it to `docs/OSS_STACK.md` if it matters.
- GitHub Actions are pinned by full commit SHA with the version in a comment; container
  images by digest. Dependabot proposes updates after a 14-day cooldown; review the
  upstream changes before you merge.
- Workflows get least-privilege `permissions:`; only deploy jobs see secrets, through
  protected environments.

## Conduct

Be kind, assume good faith, and keep criticism about the work. Maintainers may remove
comments or contributions, or block contributors, that harass or demean others.
