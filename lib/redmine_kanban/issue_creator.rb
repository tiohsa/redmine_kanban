require_relative 'board_context'

module RedmineKanban
  class IssueCreator
    include ParamNormalizer
    include IssueParentAttributes
    include ServiceResponse

    MAX_BULK_SUBTASKS = 50

    def initialize(project:, user:, board_context: nil, operation_id: nil)
      @project = project
      @user = user
      @board_context = board_context || BoardContext.new(project: project, user: user)
      @operation_id = operation_id
    end

    def create(params:)
      issue, error = persist_issue(params: params)
      return error if error

      mutation = mutation_result_builder.build(
        created_issues: [issue],
        tree_changes: issue.parent_id ? [{ type: 'attach', parent_id: issue.parent_id, child_id: issue.id }] : [],
        invalidations: { column_counts: true }
      )
      return mutation if snapshot_invalidated_result?(mutation)

      mutation.merge(issue: issue_presenter(issue).issue_to_h(issue))
    end

    def create_with_subtasks(parent_params:, subtasks:, idempotency_key:)
      return error_response(I18n.t('redmine_kanban.error_idempotency_key_required'), status: :unprocessable_entity) if idempotency_key.blank?

      normalized_parent = normalize_bulk_parent(parent_params)
      return normalized_parent if normalized_parent.is_a?(Hash) && normalized_parent[:ok] == false

      normalized_subtasks = normalize_bulk_subtasks(subtasks)
      return normalized_subtasks if normalized_subtasks.is_a?(Hash) && normalized_subtasks[:ok] == false

      parent_issue_id = normalized_parent[:parent_issue_id]

      if normalized_subtasks.count { |subtask| subtask[:subject].to_s.strip.present? } > MAX_BULK_SUBTASKS
        message = I18n.t('redmine_kanban.error_bulk_subtask_limit')
        return error_response(message, field_errors: { subtasks: [message] })
      end

      RedmineKanban::BulkIdempotency.with_request(
        user_id: @user.id,
        project_id: @project.id,
        idempotency_key: idempotency_key,
        payload: { parent: normalized_parent, subtasks: normalized_subtasks }
      ) do
        result = nil
        created_issue_ids = []
        parent_issue = nil
        created = []
        Issue.transaction do
          parent_issue, parent_error = if parent_issue_id.present?
            existing_parent_issue(parent_issue_id)
          else
            persist_issue(params: normalized_parent)
          end
          if parent_error
            result = parent_error
            raise ActiveRecord::Rollback
          end

          parent_id = parent_issue.id
          created_issue_ids << parent_id if parent_issue_id.blank?
          normalized_subtasks.each_with_index do |subtask_params, index|
            child, child_error = persist_issue(params: subtask_params.merge(parent_issue_id: parent_id))
            if child_error
              result = child_error.merge(
                row_index: index,
                row_number: index + 1,
                subject: subtask_params[:subject] || subtask_params['subject']
              )
              raise ActiveRecord::Rollback
            end
            created << child
            created_issue_ids << child.id
          end
          result = { ok: true, issue: parent_issue, subtasks: created }
        end
        next result unless result&.dig(:ok)

        created_issues = Issue.where(id: created_issue_ids.compact).to_a
        updated_parent = if parent_issue_id.present?
                           Issue.visible(@user).find_by(id: parent_issue_id)
                         end
        mutation = mutation_result_builder.build(
          issue_updates: [updated_parent].compact,
          created_issues: created_issues,
          tree_changes: created_issues.filter_map do |created_issue|
            next unless created_issue.parent_id

            { type: 'attach', parent_id: created_issue.parent_id, child_id: created_issue.id }
          end,
          invalidations: { column_counts: true }
        )
        next mutation if snapshot_invalidated_result?(mutation)

        mutation.merge(
          issue: issue_presenter(parent_issue).issue_to_h(parent_issue),
          subtasks: created.map { |child| issue_presenter(child).issue_to_h(child) }
        )
      end
    end

    private

    def persist_issue(params:)
      subject = params[:subject].to_s.strip
      return [nil, error_response(nil, field_errors: { subject: [I18n.t('redmine_kanban.error_subject_required')] })] if subject.empty?

      target_project_id = params[:project_id].to_i
      target_project = if target_project_id > 0
                         Project.visible(@user).find_by(id: target_project_id)
                       else
                         @project
                       end
      unless target_project
        return [nil, error_response(I18n.t('redmine_kanban.error_project_unavailable'), field_errors: { project_id: [I18n.t('redmine_kanban.error_project_unavailable_field')] })]
      end

      unless PermissionPolicy.new(user: @user).can_create_issue?(target_project, @project)
        return [nil, error_response(I18n.t('redmine_kanban.error_project_create_forbidden'), status: :forbidden)]
      end

      parent_issue = find_visible_parent_issue(params[:parent_issue_id])
      if params[:parent_issue_id].present? && !parent_issue
        return [nil, error_response(I18n.t('redmine_kanban.error_parent_unavailable'), field_errors: { parent_issue_id: [I18n.t('redmine_kanban.error_parent_unavailable_field')] }, status: :not_found)]
      end

      if parent_issue && parent_issue.project_id != target_project.id
        return [nil, error_response(I18n.t('redmine_kanban.error_parent_project_mismatch'), field_errors: { project_id: [I18n.t('redmine_kanban.error_parent_project_required')] })]
      end

      tracker_id = params[:tracker_id].to_s.strip
      if tracker_id.empty?
        tracker_id = if !param_key_provided?(params, 'tracker_id') && parent_issue&.tracker_id.present?
                       parent_issue.tracker_id.to_s
                     else
                       default_tracker_id(target_project).to_s
                     end
      end

      tracker = target_project.trackers.find_by(id: tracker_id.to_i)
      unless tracker
        return [nil, error_response(I18n.t('redmine_kanban.error_tracker_unavailable'), field_errors: { tracker_id: [I18n.t('redmine_kanban.error_tracker_project_required')] })]
      end

      start_date = normalize_date(params[:start_date])
      return [nil, invalid_date_response(:start_date)] if start_date == :invalid

      due_date = normalize_date(params[:due_date])
      return [nil, invalid_date_response(:due_date)] if due_date == :invalid

      issue = Issue.new
      issue.project = target_project
      issue.author = @user
      issue.init_journal(@user)

      attributes = {
        'subject' => subject,
        'description' => params[:description].to_s,
        'status_id' => params[:status_id].to_i,
        'assigned_to_id' => normalize_assigned_to_id(params[:assigned_to_id]),
        'priority_id' => normalize_priority_id(params[:priority_id]),
        'start_date' => start_date,
        'due_date' => due_date,
        'tracker_id' => tracker_id.to_i
      }
      attributes['done_ratio'] = normalize_done_ratio(params[:done_ratio]) if param_key_provided?(params, 'done_ratio')

      if params[:parent_issue_id].present?
        attributes['parent_issue_id'] = params[:parent_issue_id]
        apply_parent_defaults!(attributes, params, parent_issue)
      end

      issue.send(:safe_attributes=, attributes, @user)

      if issue.save
        [issue, nil]
      else
        [nil, error_response(issue.errors.full_messages.join(', '), field_errors: issue.errors.to_hash(true))]
      end
    end

    def existing_parent_issue(parent_issue_id)
      parent = find_visible_parent_issue(parent_issue_id)
      return [nil, error_response(I18n.t('redmine_kanban.error_parent_unavailable'), status: :not_found)] unless parent
      return [nil, error_response(I18n.t('redmine_kanban.error_permission_denied'), status: :forbidden)] unless PermissionPolicy.new(user: @user).can_create_issue?(parent.project, @project)

      [parent, nil]
    end

    def snapshot_invalidated_result?(result)
      result.dig(:invalidations, :board_snapshot) == true
    end

    def normalize_bulk_parent(parent_params)
      BulkPayloadNormalizer.normalize_row(parent_params, field: 'parent')
    rescue BulkPayloadNormalizer::Error => error
      error_response(error.message, field_errors: error.field_errors)
    end

    def normalize_bulk_subtasks(subtasks)
      BulkPayloadNormalizer.normalize_collection(subtasks)
    rescue BulkPayloadNormalizer::Error => error
      response = error_response(error.message, field_errors: error.field_errors)
      response[:row_index] = error.row_index unless error.row_index.nil?
      response[:row_key] = error.row_key unless error.row_key.nil?
      response
    end

    def default_tracker_id(project)
      project.trackers.sorted.first&.id
    end

    def find_visible_parent_issue(parent_issue_id)
      return nil if parent_issue_id.blank?

      Issue.visible(@user).find_by(id: parent_issue_id)
    end

    def param_key_provided?(params, key)
      return false unless params.respond_to?(:key?)

      params.key?(key) || params.key?(key.to_s) || params.key?(key.to_sym)
    end

    def normalize_assigned_to_id(value)
      normalize_nullable_id(value)
    end

    def normalize_priority_id(value)
      normalize_optional_integer(value)
    end

    def normalize_date(value)
      normalize_optional_date(value)
    end

    def invalid_date_response(field)
      key = field == :start_date ? 'redmine_kanban.error_invalid_date_start' : 'redmine_kanban.error_invalid_date_due'
      message = I18n.t(key)
      error_response(message, field_errors: { field => [message] })
    end

    def normalize_done_ratio(value)
      return nil if value.nil? || value.to_s.strip.empty?

      value.to_i.clamp(0, 100)
    end

    def issue_presenter(issue)
      @board_context.presenter([issue.id]).first
    end

    def mutation_result_builder
      @mutation_result_builder ||= MutationResultBuilder.new(board_context: @board_context, operation_id: @operation_id)
    end

  end
end
