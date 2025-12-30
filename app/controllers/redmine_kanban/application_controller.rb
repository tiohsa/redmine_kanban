module RedmineKanban
  class ApplicationController < ::ApplicationController
    before_action :find_project_by_project_id
    before_action :authorize

    private

    def find_project_by_project_id
      value = params[:project_id].to_s
      @project = if value.match?(/\A\d+\z/)
                   Project.find(value.to_i)
                 else
                   Project.find_by!(identifier: value)
                 end
    rescue ActiveRecord::RecordNotFound
      render_404
    end
  end
end
