require_relative 'subtask_loader'

module RedmineKanban
  class IssueCreator
    include ParamNormalizer
    include IssueParentAttributes
    include ServiceResponse

    def initialize(project:, user:)
      @project = project
      @user = user
      @settings = Settings.new(Setting.plugin_redmine_kanban)
    end

    def create(params:)
      subject = params[:subject].to_s.strip
      return error_response(nil, field_errors: { subject: ['件名を入力してください'] }) if subject.empty?

      target_project_id = params[:project_id].to_i
      target_project = if target_project_id > 0
                         Project.visible(@user).find_by(id: target_project_id)
                       else
                         @project
                       end
      unless target_project
        return error_response('指定されたプロジェクトが見つからないか、表示する権限がありません', field_errors: { project_id: ['指定されたプロジェクトを利用できません'] })
      end

      unless @user.allowed_to?(:view_redmine_kanban, @project)
        return error_response('指定されたプロジェクトでチケットを作成する権限がありません', status: :forbidden)
      end

      parent_issue = find_visible_parent_issue(params[:parent_issue_id])
      if params[:parent_issue_id].present? && !parent_issue
        return error_response('親チケットが見つからないか、表示する権限がありません', field_errors: { parent_issue_id: ['親チケットを利用できません'] }, status: :not_found)
      end

      if parent_issue && parent_issue.project_id != target_project.id
        return error_response('親チケットと作成先プロジェクトが一致しません', field_errors: { project_id: ['親チケットと同じプロジェクトを指定してください'] })
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
        return error_response('指定されたtrackerは作成先プロジェクトで利用できません', field_errors: { tracker_id: ['作成先プロジェクトで利用可能なtrackerを指定してください'] })
      end

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
        'start_date' => normalize_date(params[:start_date]),
        'due_date' => normalize_date(params[:due_date]),
        'tracker_id' => tracker_id.to_i
      }

      if params[:parent_issue_id].present?
        attributes['parent_issue_id'] = params[:parent_issue_id]
        apply_parent_defaults!(attributes, params, parent_issue)
      end

      issue.safe_attributes = attributes

      if issue.save
        { ok: true, issue: issue_presenter(issue).issue_to_h(issue) }
      else
        error_response(issue.errors.full_messages.join(', '), field_errors: issue.errors.to_hash(true))
      end
    end

    def create_with_subtasks(parent_params:, subtasks:, idempotency_key:)
      return error_response('Idempotency-Keyが必要です', status: :unprocessable_entity) if idempotency_key.blank?

      record = acquire_idempotency_record(idempotency_key)
      return record if record.is_a?(Hash)

      result = nil
      begin
        Issue.transaction do
          parent_issue_id = parent_params[:parent_issue_id] || parent_params['parent_issue_id']
          parent_result = if parent_issue_id.present?
                            existing_parent_result(parent_issue_id)
                          else
                            create(params: parent_params)
                          end
          unless parent_result[:ok]
            result = parent_result
            raise ActiveRecord::Rollback
          end

          parent_id = parent_result.dig(:issue, :id) || parent_result.dig('issue', 'id')
          created = []
          subtask_collection(subtasks).each_with_index do |subtask_params, index|
            child_result = create(params: subtask_params.merge(parent_issue_id: parent_id))
            unless child_result[:ok]
              result = child_result.merge(
                row_index: index,
                row_number: index + 1,
                subject: subtask_params[:subject] || subtask_params['subject']
              )
              raise ActiveRecord::Rollback
            end
            created << child_result[:issue]
          end
          result = { ok: true, issue: parent_result[:issue], subtasks: created }
        end

        if result && result[:ok]
          record.update!(status: 'completed', response_json: JSON.generate(result), completed_at: Time.current)
        else
          record.destroy!
        end
        result || error_response('一括作成に失敗しました')
      rescue StandardError
        record.destroy! if record.persisted? && record.status == 'processing'
        raise
      end
    rescue ActiveRecord::RecordNotUnique
      existing = RedmineKanban::IdempotencyRecord.find_by(
        user_id: @user.id, operation: 'bulk_create', project_id: @project.id, idempotency_key: idempotency_key.to_s
      )
      return JSON.parse(existing.response_json, symbolize_names: true) if existing&.status == 'completed'

      error_response('同じ一括作成リクエストが処理中です', status: :conflict)
    end

    private

    def acquire_idempotency_record(idempotency_key)
      RedmineKanban::IdempotencyRecord.create!(
        user_id: @user.id,
        operation: 'bulk_create',
        project_id: @project.id,
        idempotency_key: idempotency_key.to_s,
        status: 'processing'
      )
    rescue ActiveRecord::RecordNotUnique
      existing = RedmineKanban::IdempotencyRecord.find_by!(
        user_id: @user.id, operation: 'bulk_create', project_id: @project.id, idempotency_key: idempotency_key.to_s
      )
      return JSON.parse(existing.response_json, symbolize_names: true) if existing.status == 'completed'

      error_response('同じ一括作成リクエストが処理中です', status: :conflict)
    end

    def existing_parent_result(parent_issue_id)
      parent = find_visible_parent_issue(parent_issue_id)
      return error_response('親チケットが見つからないか、表示する権限がありません', status: :not_found) unless parent
      return error_response('親チケットに子チケットを追加する権限がありません', status: :forbidden) unless PermissionPolicy.new(user: @user).can_create_issue?(parent.project, @project)

      { ok: true, issue: issue_presenter(parent).issue_to_h(parent) }
    end

    def subtask_collection(subtasks)
      return subtasks.to_h.values if subtasks.respond_to?(:to_h) && !subtasks.is_a?(Array)

      Array(subtasks)
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

    def issue_presenter(issue)
      BoardIssuePresenter.new(
        user: @user,
        subtasks_by_parent_id: SubtaskLoader.new(user: @user).subtasks_by_parent_id([issue.id])
      )
    end

  end
end
