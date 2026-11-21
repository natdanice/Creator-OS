#!/usr/bin/env bash
# Builds the Dockerfile and pushes the image to Docker Hub as 3dsinteractive/creator-os:latest.
#
#   ./docker-build.sh              build, then push
#   ./docker-build.sh --no-push    build only (to try it locally first)
#
# Settings (optional environment variables):
#   IMAGE=3dsinteractive/creator-os:latest   where to push
#   PLATFORM=linux/amd64                 CPU the image is built for (what most servers run). On an Apple Silicon Mac
#                                        this builds under emulation, which is slower. Use PLATFORM=linux/arm64 for
#                                        ARM servers, or PLATFORM= (empty) to build for this computer only.
#
# You must be logged in to Docker Hub with push access to the repository: run `docker login` once first.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="${IMAGE:-3dsinteractive/creator-os:latest}"
PLATFORM="${PLATFORM-linux/amd64}"
PUSH=1

for arg in "$@"; do
  case "$arg" in
    --no-push) PUSH=0 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try ./docker-build.sh --help)" >&2; exit 2 ;;
  esac
done

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "Docker is not installed (or not on PATH). Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker Desktop and try again."
[ -f Dockerfile ] || die "No Dockerfile in $(pwd)."

PLATFORM_ARGS=()
[ -n "$PLATFORM" ] && PLATFORM_ARGS=(--platform "$PLATFORM")

echo "==> Building $IMAGE${PLATFORM:+ for $PLATFORM}"
docker build ${PLATFORM_ARGS[@]+"${PLATFORM_ARGS[@]}"} -t "$IMAGE" .

if [ "$PUSH" = 0 ]; then
  echo "==> Built $IMAGE (not pushed: --no-push)"
  exit 0
fi

echo "==> Pushing $IMAGE"
if ! docker push "$IMAGE"; then
  die "Push failed. If it says 'denied' or 'unauthorized', run 'docker login' with an account that can push to ${IMAGE%%:*}."
fi
echo "==> Pushed $IMAGE"
