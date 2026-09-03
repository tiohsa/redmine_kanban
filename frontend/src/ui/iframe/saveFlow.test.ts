// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { resolveSaveLoadOutcome } from './saveFlow';

const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('resolveSaveLoadOutcome', () => {
  it('keeps the submit lock while an issue edit form reloads', () => {
    expect(resolveSaveLoadOutcome({
      doc: doc('<form id="issue-form"></form>'),
      currentUrl: '/issues/12/edit',
      saveTarget: 'issue',
      mode: 'edit',
      fallbackIssueId: 12,
    })).toEqual({ type: 'keep-submitting' });
  });

  it('resolves a newly created issue id from the redirect', () => {
    expect(resolveSaveLoadOutcome({
      doc: doc('<main>saved</main>'),
      currentUrl: '/issues/42',
      saveTarget: 'new-issue',
      mode: 'create',
      fallbackIssueId: 0,
    })).toEqual({ type: 'success', issueId: 42 });
  });

  it('reports Redmine validation errors before redirect handling', () => {
    expect(resolveSaveLoadOutcome({
      doc: doc('<div id="errorExplanation">invalid</div>'),
      currentUrl: '/issues/42',
      saveTarget: 'issue',
      mode: 'edit',
      fallbackIssueId: 42,
    })).toEqual({ type: 'error' });
  });

  it('completes a time entry when Redmine returns the new form with a success notice', () => {
    expect(resolveSaveLoadOutcome({
      doc: doc('<div id="flash_notice">Created</div><form id="new_time_entry"></form>'),
      currentUrl: '/issues/12/time_entries/new',
      saveTarget: 'time_entry',
      mode: 'time_entry',
      fallbackIssueId: 12,
    })).toEqual({ type: 'success', issueId: 12 });
  });

  it('marks a time entry result unknown when the new form has no success notice', () => {
    expect(resolveSaveLoadOutcome({
      doc: doc('<form id="new_time_entry"></form>'),
      currentUrl: '/issues/12/time_entries/new',
      saveTarget: 'time_entry',
      mode: 'time_entry',
      fallbackIssueId: 12,
    })).toEqual({ type: 'unknown' });
  });

  it.each(['/login', '/error', '/plugins/other/result'])('does not accept an unexpected time entry redirect: %s', (currentUrl) => {
    expect(resolveSaveLoadOutcome({
      doc: doc('<main>Unexpected page</main>'),
      currentUrl,
      saveTarget: 'time_entry',
      mode: 'time_entry',
      fallbackIssueId: 12,
    })).toEqual({ type: 'unknown' });
  });

  it('accepts the configured Redmine issue redirect after a time entry save', () => {
    expect(resolveSaveLoadOutcome({
      doc: doc('<main>Issue</main>'),
      currentUrl: '/issues/12',
      saveTarget: 'time_entry',
      mode: 'time_entry',
      fallbackIssueId: 12,
    })).toEqual({ type: 'success', issueId: 12 });
  });
});
