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

export function getCleanDialogStyles(): string {
  return `
    ${ISSUE_DIALOG_HIDE_SELECTORS.join(', ')} { display: none !important; }
    #content { margin: 0 !important; width: 100% !important; padding: 10px !important; }
  `;
}
