const ISSUE_DIALOG_HIDE_SELECTORS = [
  '#top-menu',
  '#header',
  '#main-menu',
  '#footer',
  // Limit action hiding to the top-level issue form so nested Redmine modals keep their buttons.
  '#issue-form > p.buttons',
  '#issue-form > .buttons',
  '#issue-form > input[name="commit"]',
  '#issue-form > input[name="continue"]',
  '#issue-form > input[type="submit"]',
  '#issue-form > a.icon-cancel',
  '#issue-form > a[onclick*="history.back"]',
  '#issue-form > a[href*="javascript:history"]',
  '#issue-form > a[href*="preview"]',
  '#issue-form > a[href*="/issues"]',
];

const TIME_ENTRY_DIALOG_HIDE_SELECTORS = [
  '#top-menu',
  '#header',
  '#main-menu',
  '#footer',
  '#content > p.buttons',
  '#content > .buttons',
  '#content > a.icon-cancel',
  '#content > a[onclick*="history.back"]',
  '#content > a[href*="javascript:history"]',
  '#content a[href*="/kanban"]',
  '#new_time_entry p.buttons',
  '#new_time_entry .buttons',
  '#new_time_entry input[name="commit"]',
  '#new_time_entry input[type="submit"]',
  '#new_time_entry a.icon-cancel',
  '#new_time_entry a[href*="/kanban"]',
  '#new_time_entry a[onclick*="history.back"]',
  '#new_time_entry a[href*="javascript:history"]',
];

export type CleanDialogStyleVariant = 'default' | 'issue-compact' | 'issue-view' | 'time-entry-compact';

type GetCleanDialogStylesOptions = {
  variant?: CleanDialogStyleVariant;
};

export function applyLinkTargetBlank(doc: Document): void {
  const links = doc.querySelectorAll<HTMLAnchorElement>('.wiki a');
  links.forEach((link) => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
}

const BASE_DIALOG_STYLE_RULES = `
  ${ISSUE_DIALOG_HIDE_SELECTORS.join(', ')} { display: none !important; }
  html, body, #wrapper, #main { height: auto !important; min-height: 0 !important; }
  html, body { overflow-y: auto !important; }
  body { background: #fff !important; }
  #content { margin: 0 !important; width: 100% !important; padding: 10px !important; }
  #content > h2 { display: none !important; }
`;

const TIME_ENTRY_BASE_STYLE_RULES = `
  ${TIME_ENTRY_DIALOG_HIDE_SELECTORS.join(', ')} { display: none !important; }
  html, body, #wrapper, #main { height: auto !important; min-height: 0 !important; }
  html, body { overflow-y: auto !important; }
  body { background: #fff !important; }
  #content { margin: 0 !important; width: 100% !important; padding: 8px 10px 10px !important; }
  #content > h2 { display: none !important; }
`;

const ISSUE_COMPACT_STYLE_RULES = `
  #content { padding: 2.5px 10px 10px !important; }
  #content > h2 {
    margin: 0 !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    line-height: 1.05 !important;
    min-height: 0 !important;
  }
  #content > h2 + *,
  #content > .issue.details,
  #content > #issue-form {
    margin-top: 2.5px !important;
  }
  #content > #issue-form > :first-child,
  #content > .issue.details > :first-child {
    margin-top: 0 !important;
    padding-top: 0 !important;
  }
`;

const ISSUE_VIEW_STYLE_RULES = `
  #content > .contextual:has(+ h2.inline-block) {
    display: none !important;
  }
  #sidebar,
  #sidebar-switch-panel,
  #sidebar-handler,
  #sidebar-handler-container {
    display: none !important;
  }
`;

const TIME_ENTRY_COMPACT_STYLE_RULES = `
  #content > form,
  #content > #new_time_entry,
  #content > .box {
    margin-top: 0 !important;
  }
  #content > :first-child,
  #new_time_entry > :first-child {
    margin-top: 0 !important;
    padding-top: 0 !important;
  }
`;

export function getCleanDialogStyles({ variant = 'default' }: GetCleanDialogStylesOptions = {}): string {
  const includeCompactRules = variant === 'issue-compact' || variant === 'issue-view';
  const includeIssueViewRules = variant === 'issue-view';
  const isTimeEntryVariant = variant === 'time-entry-compact';

  return `
    ${isTimeEntryVariant ? TIME_ENTRY_BASE_STYLE_RULES : BASE_DIALOG_STYLE_RULES}
    ${includeCompactRules ? ISSUE_COMPACT_STYLE_RULES : ''}
    ${includeIssueViewRules ? ISSUE_VIEW_STYLE_RULES : ''}
    ${isTimeEntryVariant ? TIME_ENTRY_COMPACT_STYLE_RULES : ''}
  `;
}
