import React from 'react';

type Props = {
  title: string;
  linkUrl?: string | null;
  linkAriaLabel: string;
  onClose?: () => void;
  closeAriaLabel?: string;
  compact?: boolean;
  iconButtonSize?: number;
  dataTestId?: string;
};

export const IssueDialogHeader = React.forwardRef<HTMLDivElement, Props>(function IssueDialogHeader({
  title,
  linkUrl,
  linkAriaLabel,
  onClose,
  closeAriaLabel,
  compact = false,
  iconButtonSize,
  dataTestId,
}, ref) {
  const compactIconButtonSize = iconButtonSize ? `${iconButtonSize}px` : undefined;

  return (
    <div
      ref={ref}
      data-testid={dataTestId}
      className={`rk-modal-head rk-issue-dialog-head${compact ? ' rk-issue-dialog-head-compact' : ''}`}
    >
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
            style={compactIconButtonSize ? {
              width: compactIconButtonSize,
              height: compactIconButtonSize,
            } : undefined}
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
            style={compactIconButtonSize ? {
              width: compactIconButtonSize,
              height: compactIconButtonSize,
            } : undefined}
          >
            <span className="rk-icon">close</span>
          </button>
        ) : null}
      </div>
    </div>
  );
});
