#!/usr/bin/env bash
set -euo pipefail

unset TMPDIR TEMP TMP
export REDMINE_KANBAN_NATIVE_PROJECT="${REDMINE_KANBAN_NATIVE_PROJECT:-kanban-native}"

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PLUGIN_ROOT"

exec npx --prefix e2e playwright test -c e2e/playwright.config.js e2e/tests/kanban-native-mutation.spec.js "$@"
