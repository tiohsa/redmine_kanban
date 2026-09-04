// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { canSubmitTimeEntry, createTimeEntryOperation, timeEntryIdentity } from './timeEntryOperation';
import { resolveSaveLoadOutcome } from './saveFlow';

describe('Time Entry operation identity', () => {
  it('retains the trusted issue and instance in both entry points', () => {
    const scope = { instanceKey: 'https://example.test/redmine', userId: 7 };
    const context = { origin: 'timer' as const, scope, sessionId: 's', issueId: 12, attemptId: 'a', ownerTabId: 'tab', hours: '0.25' };
    for (const operation of [createTimeEntryOperation(scope.instanceKey, 12), createTimeEntryOperation(scope.instanceKey, 12, context)]) {
      expect(operation.issueId).toBe(12);
      expect(timeEntryIdentity(operation)?.instancePath).toBe('/redmine');
      expect(new URL(operation.url).searchParams.get('back_url')).toBe('https://example.test/redmine/issues/12');
    }
  });
  it.each([0, -1, NaN, 1.5])('rejects invalid issue %s at creation', id => {
    expect(() => createTimeEntryOperation('', id)).toThrow();
  });
  it.each([0, 99])('rejects URL / issue mismatches in the shared resolver: %s', issueId => {
    const operation = { origin: 'time_entry_on_close' as const, issueId, url: '/issues/12/time_entries/new' };
    expect(timeEntryIdentity(operation)).toBeNull();
    expect(resolveSaveLoadOutcome({ doc: document, currentUrl: `/issues/${issueId}`, saveTarget: 'time_entry', mode: 'time_entry', fallbackIssueId: issueId, operation })).toEqual({ type: 'unknown' });
  });
});


it('checks the native form target and issue before allowing a POST', () => {
  const operation = createTimeEntryOperation(window.location.origin + '/redmine', 12);
  const form = document.createElement('form');
  form.action = '/redmine/time_entries';
  form.innerHTML = '<input name="time_entry[issue_id]" value="12">';
  expect(canSubmitTimeEntry(operation, form, operation.url)).toBe(true);
  form.querySelector('input')!.value = '99';
  expect(canSubmitTimeEntry(operation, form, operation.url)).toBe(false);
  form.querySelector('input')!.value = '12';
  form.action = '/other/time_entries';
  expect(canSubmitTimeEntry(operation, form, operation.url)).toBe(false);
});
