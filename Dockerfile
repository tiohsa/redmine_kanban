FROM redmine:latest

# 公式イメージは BUNDLE_WITHOUT=development:test が設定されているため、
# RAILS_ENV=development だと listen 等の development gem がバンドル外になり起動に失敗する。
# development を含めつつ test は除外してインストールする。
RUN set -eux; \
  bundle config set without 'test'; \
  bundle install; \
  chown -R redmine:redmine /home/redmine
