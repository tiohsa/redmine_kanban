#!/usr/bin/env bash
set -euo pipefail

REDMINE_ROOT="${REDMINE_ROOT:-/usr/src/redmine}"
cd "$REDMINE_ROOT"

echo 'Running IssueCreator semantic contract tests:'
echo '  - parent_issue_id rejection (single create and API create)'
echo '  - status fallback rejection (single create and API create)'
echo '  - bulk status rejection rollback'

bundle exec rails test \
  plugins/redmine_kanban/test/unit/issue_creator_test.rb \
  -i '/test_(single_create_rejects_a_parent_that_safe_attributes_discards|single_create_rejects_a_status_that_safe_attributes_falls_back|bulk_status_semantic_failure_rolls_back_all_rows)/' \
  -v

bundle exec rails test \
  plugins/redmine_kanban/test/functional/api_controller_test.rb \
  -i '/test_(create_rejects_a_parent_that_redmine_discards|create_rejects_a_status_that_redmine_falls_back)/' \
  -v
