require 'net/http'
require 'json'
require 'uri'

module RedmineKanban
  class LlmService
    def initialize(api_key: nil, endpoint: nil, model: nil)
      load_env_local
      @api_key = api_key || ENV['LLM_API_KEY']
      # Gemini API endpoint structure: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
      base = endpoint || ENV['LLM_API_ENDPOINT'] || 'https://generativelanguage.googleapis.com/v1beta'
      @model = model || ENV['LLM_MODEL'] || 'gemini-1.5-flash'
      @endpoint = "#{base}/models/#{@model}:generateContent"
    end

    def analyze_board(issues)
      prompt = build_system_prompt
      user_content = build_user_content(issues)

      # Add API key to query parameter
      uri = URI.parse("#{@endpoint}?key=#{@api_key}")
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true

      request = Net::HTTP::Post.new(uri.request_uri)
      Rails.logger.info("LlmService: Analyzing #{issues.size rescue 0} issues with model #{@model}")
      request['Content-Type'] = 'application/json'

      # Gemini API Request Body
      body = {
        contents: [
          {
            parts: [
              { text: "#{prompt}\n\n#{user_content}" }
            ]
          }
        ]
      }

      request.body = body.to_json

      begin
        response = http.request(request)
        if response.code == '200'
          Rails.logger.info("LlmService: Success response from Gemini API")
          parse_response(response.body)
        else
          Rails.logger.error("LlmService: API Error #{response.code} - #{response.message}")
          { error: "API Error: #{response.code} - #{response.message}", details: response.body }
        end
      rescue StandardError => e
        Rails.logger.error("LlmService: Connection Error: #{e.message}")
        { error: "Connection Error: #{e.message}" }
      end
    end

    private

    def build_system_prompt
      <<~PROMPT
        あなたはアジャイル開発の経験豊富なプロジェクトマネージャーです。
        提供されたタスクリスト（JSON形式）を分析し、以下の観点でMarkdown形式のレポートを作成してください：

        1. **ボトルネックの特定**: 進行が遅れているタスクや、ブロックされているタスク。
        2. **リスク評価**: 期限切れ、または期限が近いタスクのリスク。
        3. **負荷分析**: 特定の担当者にタスクが偏っていないか。
        4. **推奨アクション**: チームが次に行うべき具体的なアクション。

        回答は簡潔かつ具体的な日本語で行ってください。
      PROMPT
    end

    def build_user_content(issues)
      # Simplify issue data to reduce token usage
      simplified_issues = issues.map do |i|
        {
          id: i['id'],
          subject: i['subject'],
          status: i['status_name'],
          assigned_to: i['assigned_to_name'] || 'Unassigned',
          priority: i['priority_name'],
          due_date: i['due_date'],
          done_ratio: i['done_ratio']
        }
      end.to_json
      
      "以下のタスクリストを分析してください：\n#{simplified_issues}"
    end

    def parse_response(body)
      json = JSON.parse(body)
      # Gemini API Response structure: candidates[0].content.parts[0].text
      content = json.dig('candidates', 0, 'content', 'parts', 0, 'text')
      { result: content }
    rescue JSON::ParserError
      { error: "Failed to parse API response" }
    end

    def load_env_local
      # Try multiple locations for .env.local
      possible_paths = []
      
      begin
        possible_paths << File.join(Rails.root, '.env.local')
      rescue NameError
        # Rails.root might not be defined
      end
      
      # Also check plugin directory (for development convenience)
      plugin_dir = File.expand_path('../../../../..', __FILE__)
      possible_paths << File.join(plugin_dir, '.env.local')
      
      possible_paths.each do |env_file|
        next unless File.exist?(env_file)
        
        Rails.logger.info("LlmService: Loading environment from #{env_file}") rescue nil
        File.foreach(env_file) do |line|
          next if line.strip.start_with?('#') || line.strip.empty?
          key, value = line.strip.split('=', 2)
          ENV[key] = value if key && value && !ENV.key?(key)
        end
        break # Only load the first found file
      end
    end
  end
end
