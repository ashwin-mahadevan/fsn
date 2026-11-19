#!/usr/bin/env bash
# Runs every check this repo has: builds the packages, lints, checks and builds
# the docs, and packages the SvelteKit and Next.js examples end to end with the
# local CLI and adapters.
#
# Run it from a checkout whose tools are installed (`mise install`). It does
# its own `pnpm install`s. The checks run one at a time, because several of
# them clean folders that others use. A failed check doesn't stop the ones
# after it: the end lists every check as passed or failed, and the exit status
# is non-zero if any failed.

set -u
cd "$(dirname "$0")" || exit 1

results=()
failed=0

# check <folder> <command...>: runs the command in the folder and records
# whether it passed.
check() {
	local dir=$1
	shift
	printf '\n==> %s: %s\n' "$dir" "$*"
	if (cd "$dir" && "$@"); then
		results+=("passed  $dir: $*")
	else
		results+=("FAILED  $dir: $*")
		failed=1
	fi
}

# The packaged app's main.js must import the adapter's output. Electron keeps
# an app's files in `resources/app` on Linux and Windows, and inside the .app
# bundle on macOS (`Contents/Resources/app`), so look for main.js under `dist`
# rather than at one platform's path.
main-js-imports-adapter() {
	local found=0 file
	while IFS= read -r file; do
		found=1
		grep -F 'import("./app/native/.next/fsn/index.mjs")' "$file" || {
			echo "$file doesn't import the adapter's output"
			return 1
		}
	done < <(find dist -ipath '*/resources/app/main.js')
	if [ "$found" = 0 ]; then
		echo "no packaged main.js under $PWD/dist"
		return 1
	fi
}

for package in cli adapter-sveltekit adapter-nextjs; do
	check "packages/$package" pnpm install --frozen-lockfile
	check "packages/$package" pnpm build
done

check docs pnpm install --frozen-lockfile
check docs pnpm lint
check docs pnpm check
check docs pnpm build

# The examples don't commit lockfiles.
for example in sveltekit nextjs; do
	check "examples/$example" pnpm install --no-frozen-lockfile
	check "examples/$example" pnpm build
done

check examples/nextjs main-js-imports-adapter

printf '\nChecks:\n'
printf '%s\n' "${results[@]}"
exit "$failed"
