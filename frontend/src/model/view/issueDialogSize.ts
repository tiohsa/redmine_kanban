export type IssueDialogSizeSettings = {
  widthPx: 900 | 1200 | 1500;
  heightMode: 'auto' | 'fixed';
  heightPercent: number;
  fullScreen: boolean;
};

export const DEFAULT_ISSUE_DIALOG_SIZE: IssueDialogSizeSettings = {
  widthPx: 1200,
  heightMode: 'auto',
  heightPercent: 80,
  fullScreen: false,
};

export function parseIssueDialogSize(value: string | null): IssueDialogSizeSettings {
  let stored: unknown;
  try {
    stored = JSON.parse(value ?? 'null');
  } catch {
    return { ...DEFAULT_ISSUE_DIALOG_SIZE };
  }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...DEFAULT_ISSUE_DIALOG_SIZE };
  const settings = stored as Record<string, unknown>;
  return {
    widthPx: settings.widthPx === 900 || settings.widthPx === 1200 || settings.widthPx === 1500
      ? settings.widthPx : DEFAULT_ISSUE_DIALOG_SIZE.widthPx,
    heightMode: settings.heightMode === 'fixed' ? 'fixed' : 'auto',
    heightPercent: typeof settings.heightPercent === 'number' && Number.isInteger(settings.heightPercent)
      && settings.heightPercent >= 50 && settings.heightPercent <= 90 && settings.heightPercent % 5 === 0
      ? settings.heightPercent : DEFAULT_ISSUE_DIALOG_SIZE.heightPercent,
    fullScreen: typeof settings.fullScreen === 'boolean' ? settings.fullScreen : false,
  };
}
