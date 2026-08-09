#!/usr/bin/env bash
set -euo pipefail

REDMINE_ROOT="${REDMINE_ROOT:-/usr/src/redmine}"
cd "$REDMINE_ROOT"

exec bundle exec rails test \
  plugins/redmine_kanban/test/unit/board_context_test.rb \
  plugins/redmine_kanban/test/unit/board_membership_resolver_test.rb \
  plugins/redmine_kanban/test/unit/board_data_test.rb \
  plugins/redmine_kanban/test/unit/snapshot_limits_test.rb \
  "$@"
