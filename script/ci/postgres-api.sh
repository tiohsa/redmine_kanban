#!/usr/bin/env bash
set -euo pipefail

REDMINE_ROOT="${REDMINE_ROOT:-/usr/src/redmine}"
cd "$REDMINE_ROOT"

exec bundle exec rails test \
  plugins/redmine_kanban/test/functional/api_controller_test.rb \
  -i '/(index_returns_a_complete_flat_snapshot_and_tree_relation|primary_at_limit_with_dependency_descendant_returns_structured_overflow|dependency_admission_uses_remaining_plus_one_probe|scope_over_limit_returns_no_partial_entities|status_filter_limits_the_snapshot_entities)/' \
  "$@"
