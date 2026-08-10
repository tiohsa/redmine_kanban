#!/usr/bin/env bash
set -euo pipefail

unset TMPDIR TEMP TMP

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PLUGIN_ROOT"

exec npx --prefix e2e playwright test -c e2e/playwright.config.js e2e/tests/kanban-large-snapshot.spec.js "$@"
