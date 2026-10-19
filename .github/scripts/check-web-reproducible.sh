#!/usr/bin/env bash
# Check that apps/web builds byte-identically twice: once in one directory and
# once in a different, deeper directory with a different time zone, locale and
# umask. Never touches the working tree: both builds run in copies under a temp dir.
#
#   .github/scripts/check-web-reproducible.sh [repo-root]
#
# Needs `npm ci` already run in packages/match and apps/web (apps/web's build reads
# packages/match/node_modules for nostr-tools and @noble/*).
# Exit 0 when dist/ and dist-artifact/ match file for file; 1 otherwise, with a diff.
set -euo pipefail

root="$(cd "${1:-$(git rev-parse --show-toplevel)}" && pwd)"
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/web-repro.XXXXXX")"
trap 'rm -rf "$work"' EXIT

copy_tree() { # dest
  mkdir -p "$1/apps"
  cp -a "$root/packages" "$1/packages"
  cp -a "$root/apps/web" "$1/apps/web"
  rm -rf "$1/apps/web/dist" "$1/apps/web/dist-artifact"
}

manifest() { # dir -> "sha256  path" lines, sorted by path, bytes only
  (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum)
}

a="$work/a/repo"
b="$work/b/some/other/deeper/checkout path"
copy_tree "$a"
copy_tree "$b"

echo "::group::build A ($a)"
(cd "$a/apps/web" && TZ=UTC LC_ALL=C.UTF-8 npm run -s build)
echo "::endgroup::"
echo "::group::build B ($b, TZ=Pacific/Kiritimati, umask 077)"
(cd "$b/apps/web" && umask 077 && TZ=Pacific/Kiritimati LC_ALL=C npm run -s build)
echo "::endgroup::"

status=0
for out in dist dist-artifact; do
  manifest "$a/apps/web/$out" > "$work/$out.a.sha256"
  manifest "$b/apps/web/$out" > "$work/$out.b.sha256"
  if cmp -s "$work/$out.a.sha256" "$work/$out.b.sha256"; then
    echo "apps/web/$out: reproducible ($(wc -l < "$work/$out.a.sha256") files)"
  else
    echo "::error title=Non-reproducible web build::apps/web/$out differs between two clean builds"
    diff -u "$work/$out.a.sha256" "$work/$out.b.sha256" || true
    diff -r "$a/apps/web/$out" "$b/apps/web/$out" | head -50 || true
    status=1
  fi
done

# Leave the manifest where CI can upload it and print it to the job summary.
out_manifest="${REPRO_MANIFEST:-$root/web-dist.sha256}"
cp "$work/dist.a.sha256" "$out_manifest"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Web build reproducibility"
    if [[ $status -eq 0 ]]; then echo "Two clean builds produced byte-identical \`dist/\` and \`dist-artifact/\`."; else echo "**Builds differ.** See the job log."; fi
    echo
    echo '<details><summary>dist/ SHA-256 manifest</summary>'
    echo
    echo '```'
    cat "$work/dist.a.sha256"
    echo '```'
    echo '</details>'
  } >> "$GITHUB_STEP_SUMMARY"
fi
exit $status
