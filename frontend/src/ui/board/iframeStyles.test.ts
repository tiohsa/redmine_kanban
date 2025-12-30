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

  it('should return CSS adjusting content margins', () => {
    const css = getCleanDialogStyles();
    expect(css).toContain('#content');
    expect(css).toContain('margin: 0 !important');
  });
});
