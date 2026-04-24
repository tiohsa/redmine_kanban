// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { applyLinkTargetBlank, getCleanDialogStyles } from './iframeStyles';

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

  it('should include compact issue header rules for issue dialogs', () => {
    const css = getCleanDialogStyles({ variant: 'issue-compact' });
    expect(css).toContain('padding: 2.5px 10px 10px !important');
    expect(css).toContain('#content > h2');
    expect(css).toContain('#content > #issue-form');
    expect(css).toContain('#content > .issue.details');
    expect(css).not.toContain('#sidebar-switch-panel');
  });

  it('should not include compact issue header rules for default dialogs', () => {
    const css = getCleanDialogStyles({ variant: 'default' });
    expect(css).not.toContain('padding: 2.5px 10px 10px !important');
    expect(css).not.toContain('#content > .issue.details');
    expect(css).not.toContain('#sidebar');
  });

  it('should include sidebar hiding rules for issue view dialogs', () => {
    const css = getCleanDialogStyles({ variant: 'issue-view' });
    expect(css).toContain('#content > .contextual:has(+ h2.inline-block)');
    expect(css).toContain('#sidebar');
    expect(css).toContain('#sidebar-switch-panel');
    expect(css).toContain('#sidebar-handler');
    expect(css).toContain('#sidebar-handler-container');
    expect(css).toContain('display: none !important');
    expect(css).toContain('#content > .issue.details');
  });

  it('should not include sidebar hiding rules for compact edit/create dialogs', () => {
    const css = getCleanDialogStyles({ variant: 'issue-compact' });
    expect(css).not.toContain('#sidebar-handler-container');
    expect(css).not.toContain('#content > .contextual:has(+ h2.inline-block)');
  });
});

describe('applyLinkTargetBlank', () => {
  it('should set target blank for links inside wiki content', () => {
    const doc = document.implementation.createHTMLDocument('iframe');
    doc.body.innerHTML = '<div class="wiki"><a href="https://example.com">Example</a></div>';

    applyLinkTargetBlank(doc);

    expect(doc.querySelector<HTMLAnchorElement>('.wiki a')?.target).toBe('_blank');
  });

  it('should set noopener noreferrer for links inside wiki content', () => {
    const doc = document.implementation.createHTMLDocument('iframe');
    doc.body.innerHTML = '<div class="wiki"><a href="https://example.com">Example</a></div>';

    applyLinkTargetBlank(doc);

    expect(doc.querySelector<HTMLAnchorElement>('.wiki a')?.rel).toBe('noopener noreferrer');
  });

  it('should not modify links outside wiki content', () => {
    const doc = document.implementation.createHTMLDocument('iframe');
    doc.body.innerHTML = '<a href="/issues/1">Issue</a><div class="wiki"><a href="https://example.com">Example</a></div>';
    const outsideLink = doc.querySelector<HTMLAnchorElement>('body > a');

    applyLinkTargetBlank(doc);

    expect(outsideLink?.getAttribute('target')).toBeNull();
    expect(outsideLink?.getAttribute('rel')).toBeNull();
  });
});
