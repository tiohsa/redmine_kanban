// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getActiveSaveForm, isTimeEntryForm } from './redmineForm';

const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('time entry form selection', () => {
  it('selects only the Redmine time-entry form', () => {
    const document = doc('<form id="search-form"></form><form id="new_time_entry"></form>');
    const search = document.querySelector('#search-form') as HTMLFormElement;
    const timeEntry = document.querySelector('#new_time_entry') as HTMLFormElement;
    expect(isTimeEntryForm(search)).toBe(false);
    expect(isTimeEntryForm(timeEntry)).toBe(true);
    expect(getActiveSaveForm(document, 'time_entry', '/issues/1/time_entries/new')?.form).toBe(timeEntry);
  });
});
