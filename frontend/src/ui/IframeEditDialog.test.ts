// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  hasRedmineFormError,
  findJournalEditForm,
  getActiveSaveForm,
  submitForm,
  resolveDialogStyleVariant,
  isIssueShowUrl,
  buildIssueEditUrl,
  shouldTreatEditLoadAsSuccess,
} from './IframeEditDialog';

function createDoc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('buildIssueEditUrl', () => {
  it('converts an issue show path to the Redmine issue edit path', () => {
    expect(buildIssueEditUrl('/issues/1', 99)).toBe('/issues/1/edit');
  });

  it('converts an absolute issue show URL to an absolute edit URL', () => {
    expect(buildIssueEditUrl('https://redmine.example.test/issues/1', 99)).toBe(
      'https://redmine.example.test/issues/1/edit'
    );
  });

  it('falls back to the issue id when the current URL is not a Redmine issue show URL', () => {
    expect(buildIssueEditUrl('/projects/demo/kanban/issues/1', 42)).toBe('/issues/42/edit');
  });
});

describe('IframeEditDialog edit success detection', () => {
  it('treats issue show URL as success when no error elements exist', () => {
    const doc = createDoc('<html><body><div id="content">ok</div></body></html>');
    expect(isIssueShowUrl('/issues/123')).toBe(true);
    expect(shouldTreatEditLoadAsSuccess('/issues/123', doc)).toBe(true);
  });

  it('does not treat edit URL as success', () => {
    const doc = createDoc('<html><body></body></html>');
    expect(isIssueShowUrl('/issues/123/edit')).toBe(false);
    expect(shouldTreatEditLoadAsSuccess('/issues/123/edit', doc)).toBe(false);
  });

  it('does not treat show URL as success when errorExplanation exists', () => {
    const doc = createDoc('<html><body><div id="errorExplanation">error</div></body></html>');
    expect(hasRedmineFormError(doc)).toBe(true);
    expect(shouldTreatEditLoadAsSuccess('/issues/123', doc)).toBe(false);
  });

  it('does not treat show URL as success when flash error exists', () => {
    const doc = createDoc('<html><body><div class="flash error">error</div></body></html>');
    expect(hasRedmineFormError(doc)).toBe(true);
    expect(shouldTreatEditLoadAsSuccess('/issues/123', doc)).toBe(false);
  });

  it('uses the sidebarless variant for show URLs only', () => {
    expect(resolveDialogStyleVariant('edit', '/issues/123', '/issues/123')).toBe('issue-view');
    expect(resolveDialogStyleVariant('edit', '/issues/123/edit', '/issues/123/edit')).toBe('issue-compact');
    expect(resolveDialogStyleVariant('create', '/projects/demo/issues/new', '/projects/demo/issues/new')).toBe('issue-compact');
    expect(resolveDialogStyleVariant('time_entry', '/issues/123/time_entries/new', '/issues/123/time_entries/new')).toBe('time-entry-compact');
  });

  it('finds journal edit forms before issue forms', () => {
    const doc = createDoc(`
      <form id="issue-form"></form>
      <form id="journal-42-form"></form>
    `);

    expect(findJournalEditForm(doc)?.id).toBe('journal-42-form');
    expect(getActiveSaveForm(doc, 'edit', '/issues/123')?.target).toBe('journal');
  });

  it('finds journal edit forms by journals action before id selectors', () => {
    const doc = createDoc(`
      <form id="journal-42-form"></form>
      <form id="journal-action-form" action="/journals/42"></form>
      <form id="issue-form"></form>
    `);

    expect(findJournalEditForm(doc)?.id).toBe('journal-action-form');
  });

  it('finds journal edit forms by notes textarea parent form', () => {
    const doc = createDoc(`
      <form id="fallback-form"></form>
      <form id="notes-form"><textarea name="journal[notes]"></textarea></form>
      <form id="issue-form"></form>
    `);

    const active = getActiveSaveForm(doc, 'edit', '/issues/123');
    expect(active?.form.id).toBe('notes-form');
    expect(active?.target).toBe('journal');
  });

  it('does not fall back to the first form when no supported save form exists', () => {
    const doc = createDoc('<form id="unrelated-form"></form>');

    expect(getActiveSaveForm(doc, 'edit', '/issues/123')).toBeNull();
  });

  it('prioritizes the time entry form only in time entry mode', () => {
    const doc = createDoc(`
      <form id="new_time_entry"></form>
      <form id="issue-form"></form>
    `);

    expect(getActiveSaveForm(doc, 'time_entry', '/issues/123/time_entries/new')?.target).toBe('time_entry');
    expect(getActiveSaveForm(doc, 'edit', '/issues/123/edit')?.target).toBe('issue');
  });

  it('distinguishes new issue and issue edit forms from URL and mode', () => {
    const doc = createDoc('<form id="issue-form"></form>');

    expect(getActiveSaveForm(doc, 'create', '/projects/demo/issues/new')?.target).toBe('new-issue');
    expect(getActiveSaveForm(doc, 'edit', '/issues/123/edit')?.target).toBe('issue');
    expect(getActiveSaveForm(doc, 'create', '/issues/123/edit')?.target).toBe('issue');
  });

  it('clicks the submit button before falling back to requestSubmit or submit', () => {
    const doc = createDoc('<form><button type="submit">Save</button></form>');
    const form = doc.querySelector('form') as HTMLFormElement;
    const button = doc.querySelector('button') as HTMLButtonElement;
    const clickSpy = vi.spyOn(button, 'click').mockImplementation(() => undefined);
    const requestSubmitSpy = vi.spyOn(form, 'requestSubmit').mockImplementation(() => undefined);
    const submitSpy = vi.spyOn(form, 'submit').mockImplementation(() => undefined);

    submitForm(form);

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(requestSubmitSpy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('uses requestSubmit when no submit button exists', () => {
    const doc = createDoc('<form></form>');
    const form = doc.querySelector('form') as HTMLFormElement;
    const requestSubmitSpy = vi.spyOn(form, 'requestSubmit').mockImplementation(() => undefined);
    const submitSpy = vi.spyOn(form, 'submit').mockImplementation(() => undefined);

    submitForm(form);

    expect(requestSubmitSpy).toHaveBeenCalledOnce();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('uses submit when no submit button or requestSubmit exists', () => {
    const doc = createDoc('<form></form>');
    const form = doc.querySelector('form') as HTMLFormElement;
    Object.defineProperty(form, 'requestSubmit', { value: undefined, configurable: true });
    const submitSpy = vi.spyOn(form, 'submit').mockImplementation(() => undefined);

    submitForm(form);

    expect(submitSpy).toHaveBeenCalledOnce();
  });
});
