import React, { useEffect, useRef, useState } from 'react';
import { getCleanDialogStyles } from './board/iframeStyles';
import { extractIssueIdFromUrl } from './utils/url';
import { useBulkSubtaskMutation } from './hooks/useBulkSubtaskMutation';

type Props = {
  url: string;
  labels: Record<string, string>;
  baseUrl: string;
  queryKey: readonly unknown[];
  onClose: () => void;
  onSuccess: (message: string) => void;
};

export function IframeCreateDialog({ url, labels, baseUrl, queryKey, onClose, onSuccess }: Props) {
  const [subtasks, setSubtasks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [iframeRef, setIframeRef] = useState<HTMLIFrameElement | null>(null);
  const isSubmittingRef = useRef(false);

  const bulkMutation = useBulkSubtaskMutation(baseUrl, queryKey);

  // Keep ref in sync with state
  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSubmitting]);

  const handleLoad = (e: React.SyntheticEvent<HTMLIFrameElement, Event>) => {
    const iframe = e.currentTarget;
    setIframeRef(iframe);
    try {
      const doc = iframe.contentDocument;
      const currentUrl = iframe.contentWindow?.location.href ?? '';

      if (doc) {
        const style = doc.createElement('style');
        style.textContent = getCleanDialogStyles();
        doc.head.appendChild(style);

        // Detect successful creation by checking URL
        if (isSubmittingRef.current) {
          const newIssueId = extractIssueIdFromUrl(currentUrl);
          if (newIssueId) {
            handleParentCreated(newIssueId);
            return;
          }

          // If we loaded a page and didn't find a new issue ID, it must be an error page or the form submission failed
          // (e.g. validation errors shown on /issues endpoint, or wrong form submitted)
          setIsSubmitting(false);
        }
      }
    } catch (err) {
      console.warn('Cannot access iframe content:', err);
      // Cross-origin error might mean redirect happened - reset state
      if (isSubmittingRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  const parentAttributesRef = useRef<Record<string, number | undefined>>({});

  const handleParentCreated = async (parentId: number) => {
    const lines = subtasks.split('\n').map(s => s.trim()).filter(s => s.length > 0);

    if (lines.length > 0) {
      try {
        await bulkMutation.mutateAsync(lines.map(subject => ({
          parent_issue_id: parentId,
          subject,
          tracker_id: parentAttributesRef.current.tracker_id,
          priority_id: parentAttributesRef.current.priority_id,
          status_id: parentAttributesRef.current.status_id,
          assigned_to_id: parentAttributesRef.current.assigned_to_id,
        })));
        onSuccess(
          (labels.created_with_subtasks)
            .replace('%{id}', String(parentId))
            .replace('%{count}', String(lines.length))
        );
      } catch (e) {
        onSuccess(
          (labels.created_subtask_failed)
            .replace('%{id}', String(parentId))
        );
      }
    } else {
      onSuccess(
        (labels.created)
          .replace('%{id}', String(parentId))
      );
    }
    onClose();
  };

  const handleSubmit = () => {
    if (!iframeRef?.contentDocument || !iframeRef?.contentWindow) return;
    const form = (iframeRef.contentDocument.getElementById('issue-form') as HTMLFormElement) || iframeRef.contentDocument.forms[0];
    if (form) {
      const formData = new FormData(form);
      const getVal = (name: string) => {
        const v = formData.get(name);
        return (typeof v === 'string' && v.trim()) ? Number(v) : undefined;
      };

      parentAttributesRef.current = {
        tracker_id: getVal('issue[tracker_id]'),
        priority_id: getVal('issue[priority_id]'),
        status_id: getVal('issue[status_id]'),
        assigned_to_id: getVal('issue[assigned_to_id]'),
      };

      setIsSubmitting(true);
      // Disable beforeunload handler to prevent "Leave site?" dialog
      iframeRef.contentWindow.onbeforeunload = null;
      // Also remove any jQuery-bound handlers
      try {
        const win = iframeRef.contentWindow as any;
        if (win.$ || win.jQuery) {
          (win.$ || win.jQuery)(win).off('beforeunload');
        }
      } catch (e) {
        // Ignore errors
      }
      form.submit();
    }
  };

  return (
    <div className="rk-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="rk-iframe-dialog-container" onClick={(e) => e.stopPropagation()}>
        <div className="rk-iframe-wrapper">
          <iframe className="rk-iframe-dialog-frame" src={url} onLoad={handleLoad} />
        </div>

        <div className="rk-create-footer">
          <div className="rk-subtask-input">
            <label className="rk-label">{labels.bulk_subtask_title}</label>
            <textarea
              rows={3}
              value={subtasks}
              onChange={e => setSubtasks(e.target.value)}
              placeholder={labels.bulk_subtask_placeholder}
              disabled={isSubmitting}
            />
          </div>
          <div className="rk-modal-actions">
            <button type="button" className="rk-btn" onClick={onClose} disabled={isSubmitting}>
              {labels.cancel}
            </button>
            <button type="button" className="rk-btn" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? labels.creating : labels.create}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
