import { defineConfig } from 'vitepress'

const repository = 'https://github.com/tiohsa/redmine_kanban'

const jaSidebar = [
  {
    text: 'ガイド',
    items: [
      { text: 'はじめに', link: '/ja/guide/introduction' },
      { text: 'インストール', link: '/ja/guide/installation' },
      { text: '基本操作', link: '/ja/guide/basic-operations' },
    ],
  },
  {
    text: '機能',
    items: [
      { text: 'スイムレーン', link: '/ja/features/swimlanes' },
      { text: 'サブタスク管理', link: '/ja/features/subtasks' },
      { text: '停滞検知', link: '/ja/features/aging' },
      { text: 'フィルター', link: '/ja/features/filters' },
      { text: '保存ビュー', link: '/ja/features/saved-views' },
      { text: '作業時間タイマー', link: '/ja/features/work-timer' },
      { text: '表示設定・ダイアログ', link: '/ja/features/display-settings' },
      { text: 'API・クエリ仕様', link: '/ja/features/query-parameters' },
    ],
  },
  {
    text: '管理者ガイド',
    items: [
      { text: 'システム設定', link: '/ja/administration/settings' },
      { text: '権限設定', link: '/ja/administration/permissions' },
      { text: 'デプロイ', link: '/ja/administration/deployment' },
    ],
  },
  { text: 'トラブルシューティング', link: '/ja/troubleshooting/' },
]

const enSidebar = [
  {
    text: 'Guides',
    items: [
      { text: 'Introduction', link: '/en/guide/introduction' },
      { text: 'Installation', link: '/en/guide/installation' },
      { text: 'Basic operations', link: '/en/guide/basic-operations' },
    ],
  },
  {
    text: 'Features',
    items: [
      { text: 'Swimlanes', link: '/en/features/swimlanes' },
      { text: 'Subtasks', link: '/en/features/subtasks' },
      { text: 'Aging detection', link: '/en/features/aging' },
      { text: 'Filters', link: '/en/features/filters' },
      { text: 'Saved views', link: '/en/features/saved-views' },
      { text: 'Work timer', link: '/en/features/work-timer' },
      { text: 'Display settings', link: '/en/features/display-settings' },
      { text: 'API & query limits', link: '/en/features/query-parameters' },
    ],
  },
  {
    text: 'Administration',
    items: [
      { text: 'Settings', link: '/en/administration/settings' },
      { text: 'Permissions', link: '/en/administration/permissions' },
      { text: 'Deployment', link: '/en/administration/deployment' },
    ],
  },
  { text: 'Troubleshooting', link: '/en/troubleshooting/' },
]

const jaSearch = {
  provider: 'local' as const,
  options: {
    locales: {
      ja: {
        translations: {
          button: { buttonText: '検索', buttonAriaLabel: '検索' },
          modal: {
            noResultsText: '結果が見つかりません',
            resetButtonTitle: '検索をリセット',
            footer: {
              selectText: '選択',
              navigateText: '移動',
              closeText: '閉じる',
            },
          },
        },
      },
    },
  },
}

const enSearch = { provider: 'local' as const }

export default defineConfig({
  lang: 'en-US',
  title: 'Redmine Kanban Manual',
  description: 'User and administrator manual for Redmine Kanban',
  base: '/redmine_kanban/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['MAINTENANCE.md', 'IMPLEMENTATION_REPORT.md'],
  head: [['meta', { name: 'theme-color', content: '#ffffff' }]],
  themeConfig: {
    nav: [
      { text: 'English', link: '/en/' },
      { text: '日本語', link: '/ja/' },
    ],
    socialLinks: [{ icon: 'github', link: repository }],
    search: enSearch,
    editLink: {
      pattern: `${repository}/edit/main/website/:path`,
      text: 'Edit this page',
    },
    footer: {
      message: 'Manual version: v0.8.0',
      copyright: 'Redmine Kanban contributors',
    },
  },
  locales: {
    ja: {
      label: '日本語',
      lang: 'ja-JP',
      title: 'Redmine Kanban マニュアル',
      description: 'Redmine Kanban の利用者・管理者向けマニュアル',
      themeConfig: {
        outline: { label: 'このページの内容' },
        docFooter: { prev: '前のページ', next: '次のページ' },
        sidebarMenuLabel: 'メニュー',
        returnToTopLabel: 'ページの先頭へ',
        darkModeSwitchLabel: '表示モード',
        darkModeSwitchTitle: 'ダークモードに切り替える',
        lightModeSwitchTitle: 'ライトモードに切り替える',
        nav: [
          { text: 'ホーム', link: '/ja/' },
          { text: 'ガイド', link: '/ja/guide/introduction' },
          { text: '機能', link: '/ja/features/swimlanes' },
          { text: '管理者ガイド', link: '/ja/administration/settings' },
        ],
        sidebar: { '/ja/': jaSidebar },
        search: jaSearch,
        editLink: {
          pattern: `${repository}/edit/main/website/:path`,
          text: 'このページを編集',
        },
        footer: {
          message: '対象バージョン: v0.8.0',
          copyright: 'Redmine Kanban contributors',
        },
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      title: 'Redmine Kanban Manual',
      description: 'User and administrator manual for Redmine Kanban',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Guides', link: '/en/guide/introduction' },
          { text: 'Features', link: '/en/features/swimlanes' },
          { text: 'Administration', link: '/en/administration/settings' },
        ],
        sidebar: { '/en/': enSidebar },
        search: enSearch,
        editLink: {
          pattern: `${repository}/edit/main/website/:path`,
          text: 'Edit this page',
        },
        footer: {
          message: 'Manual version: v0.8.0',
          copyright: 'Redmine Kanban contributors',
        },
      },
    },
  },
})
