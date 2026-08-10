#!/usr/bin/env bash
set -euo pipefail

REDMINE_ROOT="${REDMINE_ROOT:-/usr/src/redmine}"
cd "$REDMINE_ROOT"

exec bundle exec rails test plugins/redmine_kanban/test "$@"
