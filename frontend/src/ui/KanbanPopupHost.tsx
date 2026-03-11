import React from 'react';
import type { BoardData, Issue } from './types';

type Props = {
  data: BoardData | null;
  loading: boolean;
  notice: string | null;
  error: string | null;
  pendingDeleteIssue: Issue | null;
  isRestoring: boolean;
  onCloseNotice: () => void;
  onCloseError: () => void;
  onFinalizeDelete: (issueId: number) => void;
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
  onFinalizeDelete,
  onUndoDelete,
}: Props) {
  const labels = data?.labels;

  return (
    <div className="rk-popup-host" aria-live="polite" aria-relevant="additions text">
      {loading ? (
        <div className="rk-popup rk-popup-info" role="dialog" aria-label={labels?.loading}>
          <div className="rk-popup-head">
            <div className="rk-popup-title">{labels?.loading}</div>
          </div>
          <div className="rk-popup-body">{labels?.fetching_data}</div>
        </div>
      ) : null}

      {notice || pendingDeleteIssue ? (
        <div className={`rk-popup ${pendingDeleteIssue ? 'rk-popup-info' : 'rk-popup-warn'}`} role="dialog">
          <div className="rk-popup-head">
            <div className="rk-popup-title">{labels?.notice}</div>
            <button
              type="button"
              className="rk-icon-btn rk-popup-close"
              aria-label={labels?.close}
              onClick={() => {
                if (pendingDeleteIssue) {
                  onFinalizeDelete(pendingDeleteIssue.id);
                } else {
                  onCloseNotice();
                }
              }}
            >
              ×
            </button>
          </div>
          <div className="rk-popup-body">
            {pendingDeleteIssue ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <span>{(labels?.deleted_with_undo ?? '').replace('%{id}', String(pendingDeleteIssue.id))}</span>
                <button
                  type="button"
                  className="rk-btn rk-btn-primary"
                  style={{ height: '24px', fontSize: '11px', padding: '0 8px' }}
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
        </div>
      ) : null}

      {error ? (
        <div className="rk-popup rk-popup-error" role="dialog" aria-label={labels?.error} aria-live="assertive">
          <div className="rk-popup-head">
            <div className="rk-popup-title">{labels?.error}</div>
            <button type="button" className="rk-icon-btn rk-popup-close" aria-label={labels?.close} onClick={onCloseError}>
              ×
            </button>
          </div>
          <div className="rk-popup-body">{error}</div>
        </div>
      ) : null}
    </div>
  );
}
