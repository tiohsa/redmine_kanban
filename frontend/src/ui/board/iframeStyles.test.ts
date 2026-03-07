import { describe, it, expect } from 'vitest';
import { getCleanDialogStyles } from './iframeStyles';

describe('getCleanDialogStyles', () => {
  it('should return CSS containing display: none for Redmine headers', () => {
    const css = getCleanDialogStyles();
    expect(css).toContain('#top-menu');
    expect(css).toContain('#header');
    expect(css).toContain('#main-menu');
    expect(css).toContain('display: none !important');
  });

  it('should scope action hiding to the top-level issue form', () => {
    const css = getCleanDialogStyles();
    expect(css).toContain('#issue-form > p.buttons');
    expect(css).toContain('#issue-form > input[type="submit"]');
    expect(css).toContain('#issue-form > a[href*="/issues"]');
  });

  it('should not hide nested modal actions with global selectors', () => {
    const css = getCleanDialogStyles();
    expect(css).not.toMatch(/(^|,)\s*input\[type="submit"\]/m);
    expect(css).not.toMatch(/(^|,)\s*\.buttons a/m);
    expect(css).not.toMatch(/(^|,)\s*a\.icon-cancel/m);
  });

  it('should return CSS adjusting content margins', () => {
    const css = getCleanDialogStyles();
    expect(css).toContain('#content');
    expect(css).toContain('margin: 0 !important');
  });
});
