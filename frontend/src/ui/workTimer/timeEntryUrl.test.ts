import { describe, expect, it } from 'vitest';
import { buildWorkTimerTimeEntryUrl } from './timeEntryUrl';

describe('buildWorkTimerTimeEntryUrl', () => {
  it('redirects a successful timer entry to the issue instead of nesting Kanban', () => {
    const url = new URL(buildWorkTimerTimeEntryUrl('http://127.0.0.1:8080', 12, '1.25'));

    expect(url.pathname).toBe('/issues/12/time_entries/new');
    expect(url.searchParams.get('time_entry[hours]')).toBe('1.25');
    expect(url.searchParams.get('back_url')).toBe('http://127.0.0.1:8080/issues/12');
  });

  it('preserves a Redmine subpath in the form and back URL', () => {
    const url = new URL(buildWorkTimerTimeEntryUrl('https://redmine.test/redmine/', '34', '0.50'));

    expect(url.pathname).toBe('/redmine/issues/34/time_entries/new');
    expect(url.searchParams.get('back_url')).toBe('https://redmine.test/redmine/issues/34');
  });
});
