import { describe, expect, it } from 'vitest';
import cssContent from './styles.css?raw';

describe('Two-Tier Token Architecture for styles.css', () => {
  it('loads non-empty raw css content', () => {
    expect(cssContent.length).toBeGreaterThan(1000);
  });

  it('eliminates all component-level dark/light mode overrides', () => {
    // Theme switching must rely purely on CSS variables declared on root selectors,
    // not component descendant selectors like `.rk-root[data-rk-theme="dark"] .rk-xxx`.
    const componentOverridePattern = /\[data-rk-theme\s*=\s*["'](?:dark|light)["']\]\s+(?:\.rk-|select\.|#|\.react-datepicker)/g;
    const matches = cssContent.match(componentOverridePattern);

    expect(matches).toBeNull();
  });

  it('declares theme attributes only on root containers and datepicker portal', () => {
    // Only root/portal selectors should have data-rk-theme attributes
    const lines = cssContent.split('\n');
    const themeSelectorLines = lines
      .map((line: string, idx: number) => ({ line: line.trim(), lineNum: idx + 1 }))
      .filter(({ line }: { line: string; lineNum: number }) => line.includes('data-rk-theme'));

    for (const { line } of themeSelectorLines) {
      const isAllowedRoot =
        line.startsWith('.rk-root[data-rk-theme=') ||
        line.startsWith('#redmine-kanban-datepicker-portal[data-rk-theme=');
      expect(isAllowedRoot).toBe(true);
    }
  });

  it('defines Tier 1 Slate palette primitives', () => {
    const slateSteps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
    for (const step of slateSteps) {
      expect(cssContent).toContain(`--rk-palette-slate-${step}:`);
    }
  });

  it('defines all required Tier 2 semantic tokens in both Light and Dark blocks', () => {
    // Extract light block (between :root and .rk-root[data-rk-theme="dark"])
    const darkStartIndex = cssContent.indexOf('.rk-root[data-rk-theme="dark"]');
    expect(darkStartIndex).toBeGreaterThan(0);

    const lightBlock = cssContent.slice(0, darkStartIndex);
    const darkEndIndex = cssContent.indexOf('\n.rk-root {', darkStartIndex);
    expect(darkEndIndex).toBeGreaterThan(darkStartIndex);

    const darkBlock = cssContent.slice(darkStartIndex, darkEndIndex);

    const requiredSemanticTokens = [
      // Surface & Background
      '--rk-bg-main',
      '--rk-bg-surface',
      '--rk-bg-secondary',
      '--rk-bg-elevated',
      '--rk-bg-subtle',
      '--rk-bg-control',
      '--rk-bg-input',
      '--rk-bg-hover',
      '--rk-bg-accent-soft',

      // Borders
      '--rk-border',
      '--rk-border-light',
      '--rk-border-strong',
      '--rk-border-control',
      '--rk-border-elevated',

      // Text
      '--rk-text-primary',
      '--rk-text-dark',
      '--rk-text-charcoal',
      '--rk-text-secondary',
      '--rk-text-muted',
      '--rk-text-accent-hover',
      '--rk-accent-fg',
      '--rk-tooltip-bg',
      '--rk-tooltip-fg',

      // Brand
      '--rk-brand-blue',
      '--rk-primary',
      '--rk-primary-hover',
      '--rk-primary-active',
      '--rk-btn-primary-bg',
      '--rk-btn-primary-hover-bg',

      // Toolbar & Controls
      '--rk-toolbar-separator-bg',
      '--rk-dropdown-checkbox-bg',
      '--rk-dropdown-checkbox-border',
      '--rk-switch-bg',
      '--rk-switch-border',
      '--rk-switch-thumb-bg',

      // Semantic Alerts
      '--rk-danger',
      '--rk-danger-bg',
      '--rk-danger-hover',
      '--rk-danger-text',
      '--rk-danger-border',
      '--rk-warn',
      '--rk-warn-bg',
      '--rk-warn-text',
      '--rk-warn-border',
      '--rk-success-bg',
      '--rk-success-text',
      '--rk-pill-bg',
      '--rk-pill-text',

      // Priority Badges
      '--rk-badge-low-bg',
      '--rk-badge-low-fg',
      '--rk-badge-low-border',
      '--rk-badge-normal-bg',
      '--rk-badge-normal-fg',
      '--rk-badge-normal-border',
      '--rk-badge-high-bg',
      '--rk-badge-high-fg',
      '--rk-badge-high-border',
      '--rk-badge-urgent-bg',
      '--rk-badge-urgent-fg',
      '--rk-badge-urgent-border',
      '--rk-badge-immediate-bg',
      '--rk-badge-immediate-fg',
      '--rk-badge-immediate-border',

      // Datepicker
      '--rk-datepicker-surface-subtle',
      '--rk-datepicker-surface-muted',
      '--rk-datepicker-border-strong',
      '--rk-datepicker-header-bg',
      '--rk-datepicker-day-selected-bg',
      '--rk-datepicker-select-bg',
      '--rk-datepicker-btn-bg',
      '--rk-datepicker-btn-border',
      '--rk-datepicker-btn-hover-bg',
      '--rk-datepicker-btn-hover-fg',
      '--rk-datepicker-clear-bg',
      '--rk-datepicker-clear-border',
      '--rk-datepicker-clear-fg',

      // Work Timer
      '--rk-timer-surface-running',
      '--rk-timer-surface-pending',
      '--rk-timer-primary',
      '--rk-timer-border',
      '--rk-timer-pending-bg',
      '--rk-timer-pending-border',
      '--rk-timer-btn-light-bg',
      '--rk-timer-btn-secondary-bg',
      '--rk-timer-danger-outline-bg',
      '--rk-timer-duration-btn-bg',
      '--rk-timer-duration-btn-selected-bg',

      // Pending Work
      '--rk-pending-work-box-bg',
      '--rk-pending-work-btn-bg',
      '--rk-pending-work-state-bg',
      '--rk-pending-work-discard-bg',
    ];

    for (const token of requiredSemanticTokens) {
      expect(lightBlock).toContain(`${token}:`);
      expect(darkBlock).toContain(`${token}:`);
    }
  });

  it('connects Tier 1 Slate palette variables to Tier 2 semantic tokens', () => {
    // In Dark mode, semantic tokens connect to Tier 1 Slate palette
    const darkStartIndex = cssContent.indexOf('.rk-root[data-rk-theme="dark"]');
    const darkEndIndex = cssContent.indexOf('\n.rk-root {', darkStartIndex);
    const darkBlock = cssContent.slice(darkStartIndex, darkEndIndex);

    expect(darkBlock).toContain('--rk-bg-secondary: var(--rk-palette-slate-700);');
    expect(darkBlock).toContain('--rk-bg-elevated: var(--rk-palette-slate-800);');
    expect(darkBlock).toContain('--rk-bg-control: var(--rk-palette-slate-900);');
    expect(darkBlock).toContain('--rk-tooltip-bg: var(--rk-palette-slate-900);');
    expect(darkBlock).toContain('--rk-tooltip-fg: var(--rk-palette-slate-50);');
    expect(darkBlock).toContain('--rk-switch-bg: var(--rk-palette-slate-700);');
    expect(darkBlock).toContain('--rk-switch-thumb-bg: var(--rk-palette-slate-400);');
  });
});
