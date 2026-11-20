#!/usr/bin/env bash
# Releases every package under `packages/` whose version isn't out yet: on npm,
# with a GitHub release tagged `<name>@<version>`. The maintainer's merge queue
# runs it after a merge to master. Don't run it yourself.
#
# It never publishes from this machine. It starts the `publish.yml` workflow on
# GitHub for the commit it's run from (HEAD, which must be on master), waits
# for the run, and prints each `<name>@<version>` it released. npm trusts only
# that workflow to publish, so no npm token is kept anywhere.
#
# When nothing is waiting to be released, it says so and starts nothing. It's
# safe to run again after a failure: it finishes what's missing, including a
# version that reached npm but didn't get its GitHub release.
#
# Needs node and npm (`mise install`), and `gh` signed in with write access to
# the repo.

set -euo pipefail
cd "$(dirname "$0")"

# npm trusts this repo's publish.yml, and no other.
repo=ashwin-mahadevan/fsn
workflow=publish.yml

die() {
	echo "release.sh: $*" >&2
	exit 1
}

errors="$(mktemp)"
trap 'rm -f "$errors"' EXIT

# on_npm <name> <version>: whether npm has that version. Stops the script if
# npm can't say, so that a network failure isn't taken for "not published".
on_npm() {
	local out
	if out="$(npm view "$1@$2" version 2>"$errors")"; then
		[ "$out" = "$2" ]
		return
	fi
	if grep -q E404 "$errors"; then return 1; fi
	die "couldn't ask npm about $1@$2:
$(cat "$errors")"
}

# has_release <tag>: whether the GitHub release exists. Stops the script if
# GitHub can't say.
has_release() {
	local out
	if out="$(gh release view "$1" -R "$repo" --json tagName 2>&1)"; then return 0; fi
	if [ "$out" = "release not found" ]; then return 1; fi
	die "couldn't ask GitHub about the release $1:
$out"
}

# The ids of the workflow's runs for this commit, one to a line.
runs() {
	gh run list -R "$repo" --workflow "$workflow" --event workflow_dispatch --limit 50 \
		--json databaseId,displayTitle \
		--jq ".[] | select(.displayTitle == \"Publish $sha\") | .databaseId"
}

sha="$(git rev-parse HEAD)"

# The versions are read from the files here, and published from the commit on
# GitHub, so the two must be the same.
if [ -n "$(git status --porcelain -- packages)" ]; then
	die "packages/ has uncommitted changes. Run this from a clean checkout of the commit to release."
fi

# What isn't fully released yet, as parallel lists.
names=()
versions=()
for manifest in packages/*/package.json; do
	read -r private name version < <(node -e '
		const manifest = require(process.argv[1]);
		console.log(manifest.private === true, manifest.name, manifest.version);
	' "$PWD/$manifest") || die "couldn't read $manifest."
	# A package marked private isn't ready to be released.
	if [ "$private" = true ]; then continue; fi
	if ! on_npm "$name" "$version"; then
		echo "$name@$version isn't on npm yet."
	elif ! has_release "$name@$version"; then
		echo "$name@$version is on npm, but has no GitHub release yet."
	else
		continue
	fi
	names+=("$name")
	versions+=("$version")
done

if [ "${#names[@]}" = 0 ]; then
	echo "Nothing to release: every package's version is on npm and has its GitHub release."
	exit 0
fi

# The workflow refuses a commit that isn't on master. Check here first, for a
# clearer error and no failed run.
status="$(gh api "repos/$repo/compare/$sha...master" --jq .status 2>&1)" ||
	die "couldn't find $sha on GitHub. Is it pushed?
$status"
case "$status" in
ahead | identical) ;;
*) die "$sha isn't on master, so it can't be released." ;;
esac

before="$(runs)"
started="$(gh workflow run "$workflow" -R "$repo" --ref master -f "sha=$sha" 2>&1)" ||
	die "couldn't start $workflow:
$started"

# Newer versions of gh print the run's link. Otherwise, look for a run for
# this commit that wasn't there before.
run="$(grep -Eo "https://github.com/$repo/actions/runs/[0-9]+" <<<"$started" | head -n 1 | grep -Eo '[0-9]+$' || true)"
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
	if [ -n "$run" ]; then break; fi
	sleep 5
	for id in $(runs); do
		if ! grep -qx "$id" <<<"$before"; then run=$id; fi
	done
done
if [ -z "$run" ]; then
	die "started $workflow for $sha, but couldn't find its run. Look at https://github.com/$repo/actions/workflows/$workflow, and run this again once it's done."
fi
url="https://github.com/$repo/actions/runs/$run"
echo "Started $workflow for $sha: $url"

run_failed=0
gh run watch "$run" -R "$repo" --exit-status --interval 10 >/dev/null 2>&1 || run_failed=1
conclusion="$(gh run view "$run" -R "$repo" --json status,conclusion --jq '"\(.status) \(.conclusion)"' 2>&1)" ||
	die "lost track of the run $url. Run this again once it's done.
$conclusion"
if [ "${conclusion%% *}" != completed ]; then
	die "stopped watching the run $url before it finished ($conclusion). Run this again once it's done."
fi

# Report what is really out, whatever the run said.
incomplete=0
for i in "${!names[@]}"; do
	name=${names[$i]}
	version=${versions[$i]}
	published=0
	# npm can take a moment to list a version that was just published.
	for attempt in 1 2 3 4 5 6; do
		if on_npm "$name" "$version"; then
			published=1
			break
		fi
		if [ "$run_failed" = 1 ] || [ "$attempt" = 6 ]; then break; fi
		sleep 10
	done
	if [ "$published" = 0 ]; then
		echo "Not released: $name@$version isn't on npm."
		incomplete=1
	elif ! has_release "$name@$version"; then
		echo "Half released: $name@$version is on npm, but has no GitHub release. Run this again to finish it."
		incomplete=1
	else
		echo "Released $name@$version"
	fi
done

if [ "$run_failed" = 1 ]; then
	gh run view "$run" -R "$repo" || true
	die "the publish run failed (${conclusion#* }): $url"
fi
if [ "$incomplete" = 1 ]; then
	die "the publish run passed, but not everything is out: $url"
fi
