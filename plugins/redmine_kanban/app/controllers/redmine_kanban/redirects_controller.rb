module RedmineKanban
  class RedirectsController < ::ApplicationController
    def gantt
      qs = request.query_string.to_s
      suffix = qs.empty? ? '' : "?#{qs}"
      redirect_to "/projects/#{params[:project_id]}/issues/gantt#{suffix}"
    end
  end
end

