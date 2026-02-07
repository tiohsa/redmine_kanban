export function getCleanDialogStyles(): string {
  return `
    #top-menu, #header, #main-menu, #footer { display: none !important; }
    #content { margin: 0 !important; width: 100% !important; padding: 10px !important; }
    input[name="commit"], input[name="continue"], input[type="submit"] { display: none !important; }
    .buttons a, a.icon-cancel, a[onclick*="history.back"], a[href*="javascript:history"], form > a, #content > a, .form-actions a { display: none !important; }
  `;
}
