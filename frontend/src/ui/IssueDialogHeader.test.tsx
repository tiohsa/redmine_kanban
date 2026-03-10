// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IssueDialogHeader } from './IssueDialogHeader';

describe('IssueDialogHeader', () => {
  it('renders issue badge and external link in a new tab', () => {
    render(
      <IssueDialogHeader
        title="Feature request #12"
        linkUrl="/issues/12/edit"
        linkAriaLabel="Redmine標準画面を開く"
      />
    );

    expect(screen.getByRole('heading', { name: 'Feature request #12' })).toBeTruthy();

    const link = screen.getByRole('link', { name: 'Redmine標準画面を開く' });
    expect(link.getAttribute('href')).toBe('/issues/12/edit');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders a close action when provided', () => {
    const onClose = vi.fn();

    render(
      <IssueDialogHeader
        title="Bug fix #7"
        linkUrl="/issues/7"
        linkAriaLabel="Redmine標準画面を開く"
        onClose={onClose}
        closeAriaLabel="閉じる"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
