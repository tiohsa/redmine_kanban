import React from 'react';

type Props = {
  title: string;
  linkUrl?: string | null;
  linkAriaLabel: string;
  onClose?: () => void;
  closeAriaLabel?: string;
};

export function IssueDialogHeader({
  title,
  linkUrl,
  linkAriaLabel,
  onClose,
  closeAriaLabel,
}: Props) {
  return (
    <div className="rk-modal-head rk-issue-dialog-head">
      <div className="rk-issue-dialog-title-wrap">
        <h3>{title}</h3>
      </div>

      <div className="rk-issue-dialog-actions">
        {linkUrl ? (
          <a
            className="rk-icon-btn rk-issue-dialog-link"
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={linkAriaLabel}
            title={linkAriaLabel}
          >
            <span className="rk-icon">open_in_new</span>
          </a>
        ) : null}
        {onClose ? (
          <button
            type="button"
            className="rk-icon-btn rk-issue-dialog-close"
            aria-label={closeAriaLabel ?? 'Close'}
            title={closeAriaLabel ?? 'Close'}
            onClick={onClose}
          >
            <span className="rk-icon">close</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
