import React, { useEffect } from 'react';
import type { Issue, ToolbarViewModel } from './types';

export const NOTICE_AUTO_DISMISS_MS = 5_000;
export const DELETE_NOTICE_AUTO_DISMISS_MS = 8_000;
export const ERROR_AUTO_DISMISS_MS = 8_000;

type Props = {
  data: Pick<ToolbarViewModel, 'labels'> | null;
  loading: boolean;
  notice: string | null;
  error: string | null;
  pendingDeleteIssue: Issue | null;
  isRestoring: boolean;
  onCloseNotice: () => void;
  onCloseError: () => void;
  onDismissDeleteNotice: () => void;
  onUndoDelete: () => void;
};

export function KanbanPopupHost({
  data,
  loading,
  notice,
  error,
  pendingDeleteIssue,
  isRestoring,
  onCloseNotice,
  onCloseError,
  onDismissDeleteNotice,
  onUndoDelete,
}: Props) {
  const labels = data?.labels;

  useEffect(() => {
    if (!notice && !pendingDeleteIssue) return undefined;
    if (pendingDeleteIssue && isRestoring) return undefined;

    const timeout = window.setTimeout(() => {
      if (pendingDeleteIssue) {
        onDismissDeleteNotice();
      } else {
        onCloseNotice();
      }
    }, pendingDeleteIssue ? DELETE_NOTICE_AUTO_DISMISS_MS : NOTICE_AUTO_DISMISS_MS);

    return () => window.clearTimeout(timeout);
  }, [isRestoring, notice, onCloseNotice, onDismissDeleteNotice, pendingDeleteIssue]);

  useEffect(() => {
    if (!error) return undefined;

    const timeout = window.setTimeout(() => {
      onCloseError();
    }, ERROR_AUTO_DISMISS_MS);

    return () => window.clearTimeout(timeout);
  }, [error, onCloseError]);

  return (
    <div className="rk-popup-host" aria-live="polite" aria-relevant="additions text">
      {loading ? (
        <div className="rk-popup rk-popup-info" role="dialog" aria-label={labels?.loading}>
          <div className="rk-popup-row">
            <div className="rk-popup-body">{labels?.fetching_data}</div>
          </div>
        </div>
      ) : null}

      {notice || pendingDeleteIssue ? (
        <div className="rk-popup rk-popup-info" role="dialog" aria-label={labels?.notice}>
          <div className="rk-popup-row">
            <div className="rk-popup-body">
              {pendingDeleteIssue ? (
                <div className="rk-popup-delete-notice">
                  <span className="rk-popup-delete-message">
                    {(labels?.deleted_with_undo ?? '').replace('%{id}', String(pendingDeleteIssue.id))}
                  </span>
                  <button
                    type="button"
                    className="rk-btn rk-btn-primary rk-popup-undo-btn"
                    onClick={onUndoDelete}
                    disabled={isRestoring}
                  >
                    {isRestoring ? labels?.restoring : labels?.undo}
                  </button>
                </div>
              ) : (
                notice
              )}
            </div>
            <button
              type="button"
              className="rk-icon-btn rk-popup-close"
              aria-label={labels?.close}
              onClick={() => {
                if (pendingDeleteIssue) {
                  onDismissDeleteNotice();
                } else {
                  onCloseNotice();
                }
              }}
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rk-popup rk-popup-error" role="dialog" aria-label={labels?.error} aria-live="assertive">
          <div className="rk-popup-row">
            <div className="rk-popup-body">{error}</div>
            <button type="button" className="rk-icon-btn rk-popup-close" aria-label={labels?.close} onClick={onCloseError}>
              ×
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
