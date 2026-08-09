#!/usr/bin/env bash
set -euo pipefail

# Some local Codex sessions inherit a Windows-mounted temp path that is not
# available to Node. Keep the adjustment local to this child process.
unset TMPDIR TEMP TMP

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PLUGIN_ROOT"

case "${1:-all}" in
  build)
    exec npm --prefix frontend run build
    ;;
  lint)
    exec npm --prefix frontend run lint
    ;;
  typecheck)
    exec npm --prefix frontend run typecheck
    ;;
  test)
    exec npm --prefix frontend run test -- --run
    ;;
  all)
    npm --prefix frontend run typecheck
    npm --prefix frontend run lint
    npm --prefix frontend run test -- --run
    exec npm --prefix frontend run build
    ;;
  *)
    echo "usage: $0 [build|lint|typecheck|test|all]" >&2
    exit 2
    ;;
esac
