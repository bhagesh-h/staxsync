#!/usr/bin/env bash
# StaxSync: every development and test command runs in Docker. Nothing is installed on the host.
#
#   ./dev.sh dev         start the website at http://localhost:5173 (papers from ./test)
#   ./dev.sh test        unit tests (Vitest)
#   ./dev.sh typecheck   TypeScript check
#   ./dev.sh build       production build into apps/web/dist
#   ./dev.sh e2e [args]  browser tests (Playwright: Chromium, Firefox, WebKit)
#   ./dev.sh check       typecheck + unit tests + build + browser tests
#   ./dev.sh lock        regenerate apps/web/package-lock.json after editing package.json
#   ./dev.sh shell       a shell inside the dev container
set -euo pipefail
cd "$(dirname "$0")"

IMAGE=staxsync-dev
BASE=mcr.microsoft.com/playwright:v1.65.1-noble
TTY=()
if [ -t 0 ] && [ -t 1 ]; then TTY=(-it); fi

build_image() {
  # Quiet when cached; on failure, rebuild verbosely so the error is visible.
  docker build -q -t "$IMAGE" . >/dev/null 2>&1 || docker build -t "$IMAGE" .
}

run() {
  docker run --rm "${TTY[@]}" --init --ipc=host \
    --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$PWD":/work/repo -w /work/repo/apps/web \
    "$@"
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  dev)
    build_image
    run -p 5173:5173 "$IMAGE" npm run dev
    ;;
  test | typecheck | build | e2e | check)
    build_image
    run "$IMAGE" npm run "$cmd" -- "$@"
    ;;
  lock)
    docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
      -v "$PWD/apps/web":/w -w /w "$BASE" \
      npm install --package-lock-only --ignore-scripts --no-audit --no-fund
    ;;
  shell)
    build_image
    run -it "$IMAGE" bash
    ;;
  *)
    sed -n '2,13p' "$0"
    ;;
esac
