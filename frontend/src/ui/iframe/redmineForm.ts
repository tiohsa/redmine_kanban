export type IframeMode = 'create' | 'edit' | 'time_entry';
export type SaveTarget = 'issue' | 'new-issue' | 'journal' | 'time_entry' | null;

const REDMINE_ERROR_SELECTORS = ['#errorExplanation', '.flash.error', '.flash-error', '#flash_error', '.conflict'] as const;
const REDMINE_SUCCESS_SELECTORS = ['#flash_notice', '.flash.notice', '.flash-notice'] as const;

export function hasRedmineFormError(doc: Document): boolean {
  return REDMINE_ERROR_SELECTORS.some((selector) => doc.querySelector(selector) !== null);
}

export function getRedmineFormErrorMessage(doc: Document): string | null {
  for (const selector of REDMINE_ERROR_SELECTORS) {
    const text = doc.querySelector<HTMLElement>(selector)?.textContent?.trim();
    if (text) return text;
  }
  return null;
}

export function hasRedmineSuccessNotice(doc: Document): boolean {
  return REDMINE_SUCCESS_SELECTORS.some((selector) => doc.querySelector(selector)?.textContent?.trim());
}

export function isIssueShowUrl(currentUrl: string): boolean {
  const normalizedUrl = currentUrl.split('#')[0];
  return /\/issues\/\d+(?:\?.*)?$/.test(normalizedUrl) && !normalizedUrl.includes('/edit');
}

export function buildIssueEditUrl(currentUrl: string, fallbackIssueId: number): string {
  const fallbackUrl = `/issues/${fallbackIssueId}/edit`;
  if (!currentUrl) return fallbackUrl;

  try {
    const isAbsoluteUrl = /^[a-z][a-z\d+\-.]*:\/\//i.test(currentUrl);
    const parsedUrl = new URL(currentUrl, 'http://redmine-kanban.local');
    const match = parsedUrl.pathname.match(/^\/issues\/(\d+)\/?$/);
    if (!match) return fallbackUrl;

    parsedUrl.pathname = `/issues/${match[1]}/edit`;
    parsedUrl.search = '';
    parsedUrl.hash = '';
    return isAbsoluteUrl ? parsedUrl.toString() : parsedUrl.pathname;
  } catch {
    return fallbackUrl;
  }
}

export function shouldTreatEditLoadAsSuccess(currentUrl: string, doc: Document): boolean {
  return isIssueShowUrl(currentUrl) && !hasRedmineFormError(doc);
}

export function findJournalEditForm(doc: Document): HTMLFormElement | null {
  return (
    doc.querySelector<HTMLFormElement>('form[action*="/journals/"]') ||
    doc.querySelector<HTMLFormElement>('form[id^="journal-"][id$="-form"]') ||
    doc.querySelector<HTMLTextAreaElement>('textarea[name="journal[notes]"]')?.closest('form') ||
    null
  );
}

export function getActiveSaveForm(
  doc: Document,
  mode: IframeMode,
  currentUrl: string,
): { form: HTMLFormElement; target: SaveTarget } | null {
  if (mode === 'time_entry') {
    const form = doc.querySelector<HTMLFormElement>('#new_time_entry');
    return form ? { form, target: 'time_entry' } : null;
  }

  const journalForm = findJournalEditForm(doc);
  if (journalForm) return { form: journalForm, target: 'journal' };

  const issueForm = doc.querySelector<HTMLFormElement>('#issue-form');
  if (!issueForm) return null;
  return {
    form: issueForm,
    target: currentUrl.includes('/issues/new') ? 'new-issue' : 'issue',
  };
}

export function isTimeEntryForm(form: HTMLFormElement): boolean {
  return form.matches('form#new_time_entry');
}

export function submitForm(form: HTMLFormElement): void {
  const submitButton = form.querySelector<HTMLElement>('input[type="submit"], button[type="submit"]');
  if (submitButton) {
    submitButton.click();
  } else if (typeof form.requestSubmit === 'function') {
    form.requestSubmit();
  } else {
    form.submit();
  }
}

export function readNumericFormValue(formData: FormData, form: HTMLFormElement, name: string): number | undefined {
  const value = formData.get(name);
  if (typeof value === 'string' && value.trim()) return Number(value);
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
    if (field.value.trim()) return Number(field.value);
  }
  return undefined;
}
