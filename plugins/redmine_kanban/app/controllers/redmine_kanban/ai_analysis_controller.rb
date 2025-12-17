module RedmineKanban
  class AiAnalysisController < ApiController
    def analyze
      # Prepare issues data from params
      # Expecting a list of issues in the body, or fetching them based on query
      # For simplicity and robust filtering, let's accept the issues payload directly from the frontend
      # which has already filtered and sorted them.
      
      issues = params[:issues]
      
      if issues.blank?
        render json: { error: 'No issues provided' }, status: :unprocessable_entity
        return
      end

      # Initialize Service (assuming API KEY is in ENV)
      service = LlmService.new
      
      # Check if API key is configured
      if ENV['LLM_API_KEY'].blank?
         # Mock response for development if no key provided
         mock_response = {
           result: <<~MARKDOWN
             **（開発モード：APIキーが設定されていません）**
             
             ### 分析結果サンプ​​ル
             
             **1. ボトルネックの特定**
             * タスクAが長期間「進行中」のままです。
             
             **2. リスク評価**
             * タスクBの期限が近づいています。
             
             **3. 推奨アクション**
             * タスクAの担当者に状況を確認してください。
           MARKDOWN
         }
         render json: mock_response
         return
      end

      result = service.analyze_board(issues)
      render json: result
    rescue StandardError => e
      render json: { error: e.message }, status: :internal_server_error
    end
  end
end
