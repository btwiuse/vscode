#!/usr/bin/env bash

set -euo pipefail

if [[ "${OSTYPE:-}" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname "$(dirname "$(realpath "$0")")")
else
	ROOT=$(dirname "$(dirname "$(readlink -f "$0")")")
fi

ARCH="x64"
WEB=0
MIN=0
CI=0
TASK=""

print_help() {
	echo "Build VS Code Linux REH variant"
	echo
	echo "Usage:"
	echo "  scripts/build-reh-linux.sh [options]"
	echo
	echo "Options:"
	echo "  --arch <x64|arm64|armhf>  Target architecture (default: x64)"
	echo "  --web                      Build web REH variant"
	echo "  --min                      Build minified variant"
	echo "  --ci                       Build CI variant"
	echo "  --task <gulp-task>         Run an explicit gulp task name"
	echo "  -h, --help                 Show this help"
	echo
	echo "Examples:"
	echo "  scripts/build-reh-linux.sh"
	echo "  scripts/build-reh-linux.sh --arch arm64 --min"
	echo "  scripts/build-reh-linux.sh --web --arch x64 --ci"
	echo "  scripts/build-reh-linux.sh --task vscode-reh-linux-alpine"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--arch)
			ARCH="${2:-}"
			shift 2
			;;
		--web)
			WEB=1
			shift
			;;
		--min)
			MIN=1
			shift
			;;
		--ci)
			CI=1
			shift
			;;
		--task)
			TASK="${2:-}"
			shift 2
			;;
		-h|--help)
			print_help
			exit 0
			;;
		*)
			echo "Unknown argument: $1" >&2
			print_help
			exit 1
			;;
	esac
done

case "$ARCH" in
	x64|arm64|armhf)
		;;
	*)
		echo "Unsupported --arch '$ARCH'. Use x64, arm64, or armhf, or pass --task." >&2
		exit 1
		;;
esac

if [[ -z "$TASK" ]]; then
	PREFIX="vscode-reh-linux"
	if [[ $WEB -eq 1 ]]; then
		PREFIX="vscode-reh-web-linux"
	fi

	TASK="$PREFIX-$ARCH"
	if [[ $MIN -eq 1 ]]; then
		TASK="$TASK-min"
	fi
	if [[ $CI -eq 1 ]]; then
		TASK="$TASK-ci"
	fi
fi

echo "Running gulp task: $TASK"

pushd "$ROOT" >/dev/null
npm run gulp "$TASK"
popd >/dev/null

echo "Linux REH build completed: $TASK"
