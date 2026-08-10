#!/usr/bin/env bash
set -euo pipefail

REDMINE_ROOT="${REDMINE_ROOT:-/usr/src/redmine}"
cd "$REDMINE_ROOT"

exec bundle exec rails test \
  plugins/redmine_kanban/test/unit/board_data_test.rb \
  plugins/redmine_kanban/test/unit/snapshot_limits_test.rb \
  plugins/redmine_kanban/test/functional/api_controller_test.rb \
  "$@"
