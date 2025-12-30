export function getCleanDialogStyles(): string {
  return `
    #top-menu, #header, #main-menu, #footer { display: none !important; }
    #content { margin: 0 !important; width: 100% !important; padding: 10px !important; }
    input[name="commit"], input[name="continue"], a.preview { display: none !important; }
  `;
}
