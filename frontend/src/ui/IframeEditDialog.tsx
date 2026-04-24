import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyLinkTargetBlank, getCleanDialogStyles, type CleanDialogStyleVariant } from './board/iframeStyles';
import { IssueDialogHeader } from './IssueDialogHeader';
import { extractIssueIdFromUrl } from './utils/url';
import { useBulkSubtaskMutation } from './hooks/useBulkSubtaskMutation';

const REDMINE_ERROR_SELECTORS = ['#errorExplanation', '.flash.error', '.flash-error', '#flash_error', '.conflict'] as const;
const MAX_DIALOG_VIEWPORT_HEIGHT_RATIO = 0.9;
const MIN_DIALOG_HEIGHT_PX = 320;
const DEFAULT_DIALOG_WIDTH_PX = 1600;
const COMPACT_ICON_BUTTON_SIZE = 24;
const COMPACT_ACTION_BUTTON_HEIGHT = 28;
const COMPACT_ACTION_BUTTON_MIN_WIDTH = 88;

type ObserverWindow = Window & {
  ResizeObserver?: typeof ResizeObserver;
  MutationObserver?: typeof MutationObserver;
};

export function hasRedmineFormError(doc: Document): boolean {
  return REDMINE_ERROR_SELECTORS.some((selector) => doc.querySelector(selector) !== null);
}

export function getRedmineFormErrorMessage(doc: Document): string | null {
  for (const selector of REDMINE_ERROR_SELECTORS) {
    const element = doc.querySelector<HTMLElement>(selector);
    const text = element?.textContent?.trim();
    if (text) return text;
  }

  return null;
}

export function isIssueShowUrl(currentUrl: string): boolean {
  const normalizedUrl = currentUrl.split('#')[0];
  return /\/issues\/\d+(?:\?.*)?$/.test(normalizedUrl) && !normalizedUrl.includes('/edit');
}

export function shouldTreatEditLoadAsSuccess(currentUrl: string, doc: Document): boolean {
  return isIssueShowUrl(currentUrl) && !hasRedmineFormError(doc);
}

export function resolveDialogStyleVariant(
  mode: Props['mode'] = 'edit',
  currentUrl: string,
  fallbackUrl: string
): CleanDialogStyleVariant {
  if (mode === 'time_entry') {
    return 'time-entry-compact';
  }
  return isIssueShowUrl(currentUrl || fallbackUrl) ? 'issue-view' : 'issue-compact';
}

export function getElementOuterHeight(element: HTMLElement | null): number {
  if (!element) return 0;
  return Math.ceil(element.getBoundingClientRect().height);
}

export function getDocumentScrollHeight(element: HTMLElement): number {
  return Math.max(
    element.scrollHeight,
    element.clientHeight,
    element.offsetHeight,
    Math.ceil(element.getBoundingClientRect().height),
  );
}

export function getDialogContentHeight(doc: Document): number {
  const candidates = [
    doc.querySelector<HTMLElement>('#content'),
    doc.querySelector<HTMLElement>('#main'),
    doc.body,
    doc.documentElement,
  ];

  for (const element of candidates) {
    if (!element) continue;
    const height = getDocumentScrollHeight(element);
    if (height > 0) return height;
  }

  return 0;
}

type Props = {
  url: string;
  issueId: number;
  issueTitle?: string;
  mode?: 'create' | 'edit' | 'time_entry';
  labels: Record<string, string>;
  baseUrl: string;
  queryKey: readonly unknown[];
  onClose: () => void;
  onSuccess: (message: string) => void;
};

export function IframeEditDialog({ url, issueId, issueTitle, mode = 'edit', labels, baseUrl, queryKey, onClose, onSuccess }: Props) {
  const [subtasks, setSubtasks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [dialogHeightPx, setDialogHeightPx] = useState<number | null>(null);
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [isSubtasksOpen, setIsSubtasksOpen] = useState(false);
  const isSubmittingRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const subtaskSectionRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const iframeEscapeCleanupRef = useRef<(() => void) | null>(null);
  const iframeSizeObserverCleanupRef = useRef<(() => void) | null>(null);
  const dialogResizeCleanupRef = useRef<(() => void) | null>(null);
  const parentAttributesRef = useRef<Record<string, number | undefined>>({});

  const bulkMutation = useBulkSubtaskMutation(baseUrl, queryKey);

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  const measureDialogHeight = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      setDialogHeightPx(Math.floor(window.innerHeight * MAX_DIALOG_VIEWPORT_HEIGHT_RATIO));
      return;
    }

    const maxHeightPx = Math.floor(window.innerHeight * MAX_DIALOG_VIEWPORT_HEIGHT_RATIO);
    const chromeHeight =
      getElementOuterHeight(headerRef.current) +
      getElementOuterHeight(errorRef.current) +
      getElementOuterHeight(subtaskSectionRef.current) +
      getElementOuterHeight(footerRef.current);
    const iframeContentHeight = getDialogContentHeight(doc);
    const nextHeight = Math.min(
      maxHeightPx,
      Math.max(MIN_DIALOG_HEIGHT_PX, chromeHeight + iframeContentHeight),
    );

    setDialogHeightPx(nextHeight);
  }, []);

  const bindIframeSizeObservers = useCallback((doc: Document) => {
    iframeSizeObserverCleanupRef.current?.();

    const cleanupCallbacks: Array<() => void> = [];
    const iframeWindow = iframeRef.current?.contentWindow as ObserverWindow | null;
    const resizeObserverCtor = iframeWindow?.ResizeObserver ?? window.ResizeObserver;
    const mutationObserverCtor = iframeWindow?.MutationObserver ?? window.MutationObserver;

    if (typeof resizeObserverCtor !== 'undefined') {
      const resizeObserver = new resizeObserverCtor(() => {
        measureDialogHeight();
      });
      const resizeTargets = [
        doc.querySelector<HTMLElement>('#content'),
        doc.querySelector<HTMLElement>('#main'),
        doc.body,
        doc.documentElement,
      ].filter((element): element is HTMLElement => Boolean(element));

      resizeTargets.forEach((element) => resizeObserver.observe(element));
      cleanupCallbacks.push(() => resizeObserver.disconnect());
    }

    if (typeof mutationObserverCtor !== 'undefined' && doc.body) {
      const mutationObserver = new mutationObserverCtor(() => {
        measureDialogHeight();
      });
      mutationObserver.observe(doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      cleanupCallbacks.push(() => mutationObserver.disconnect());
    }

    iframeSizeObserverCleanupRef.current = () => {
      cleanupCallbacks.forEach((cleanup) => cleanup());
    };
  }, [measureDialogHeight]);

  const handleSuccess = useCallback(async (targetIssueId: number) => {
    if (mode === 'time_entry') {
      onSuccess(labels.successful_update ?? 'Successful update');
      onClose();
      return;
    }

    const lines = subtasks.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);

    if (lines.length > 0) {
      try {
        await bulkMutation.mutateAsync(lines.map((subject) => ({
          parent_issue_id: targetIssueId,
          subject,
          project_id: parentAttributesRef.current.project_id,
          tracker_id: parentAttributesRef.current.tracker_id,
          priority_id: parentAttributesRef.current.priority_id,
          status_id: parentAttributesRef.current.status_id,
          assigned_to_id: parentAttributesRef.current.assigned_to_id,
        })));
        onSuccess(
          (mode === 'create' ? labels.created_with_subtasks : labels.updated_with_subtasks)
            .replace('%{id}', String(targetIssueId))
            .replace('%{count}', String(lines.length))
        );
      } catch {
        onSuccess(
          (mode === 'create' ? labels.created_subtask_failed : labels.updated_subtask_failed)
            .replace('%{id}', String(targetIssueId))
        );
      }
    } else {
      onSuccess(
        (mode === 'create' ? labels.created : labels.saved)
          .replace('%{id}', String(targetIssueId))
      );
    }

    onClose();
  }, [bulkMutation, labels, mode, onClose, onSuccess, subtasks]);

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLIFrameElement, Event>) => {
    const iframe = e.currentTarget;
    iframeRef.current = iframe;

    try {
      const doc = iframe.contentDocument;
      const nextCurrentUrl = iframe.contentWindow?.location.href ?? '';
      if (nextCurrentUrl) {
        setCurrentUrl(nextCurrentUrl);
      }

      if (doc) {
        const style = doc.createElement('style');
        const styleVariant = resolveDialogStyleVariant(mode, nextCurrentUrl, url);
        style.textContent = getCleanDialogStyles({
          variant: styleVariant,
        });
        doc.head.appendChild(style);
        applyLinkTargetBlank(doc);

        const errorMessage = getRedmineFormErrorMessage(doc);
        setIframeError(errorMessage);
        bindIframeSizeObservers(doc);

        iframeEscapeCleanupRef.current?.();
        if (iframe.contentWindow) {
          const handleIframeEscape = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape' && !isSubmittingRef.current) {
              ev.preventDefault();
              ev.stopPropagation();
              onClose();
            }
          };
          iframe.contentWindow.addEventListener('keydown', handleIframeEscape, true);
          iframeEscapeCleanupRef.current = () => {
            iframe.contentWindow?.removeEventListener('keydown', handleIframeEscape, true);
          };
        }

        if (isSubmittingRef.current) {
          if (mode === 'create') {
            const newIssueId = extractIssueIdFromUrl(nextCurrentUrl);
            if (newIssueId) {
              void handleSuccess(newIssueId);
              return;
            }
          } else if (mode === 'time_entry') {
            if (!nextCurrentUrl.includes('/time_entries/new')) {
              void handleSuccess(issueId);
              return;
            }
          } else if (shouldTreatEditLoadAsSuccess(nextCurrentUrl, doc)) {
            void handleSuccess(issueId);
            return;
          }

          setIsSubmitting(false);
        }
      }
    } catch (err) {
      console.warn('Cannot access iframe content:', err);
      setIframeError(null);
      if (isSubmittingRef.current) {
        setIsSubmitting(false);
      }
    } finally {
      setIsLoading(false);
      window.requestAnimationFrame(() => {
        measureDialogHeight();
      });
    }
  }, [bindIframeSizeObservers, handleSuccess, issueId, measureDialogHeight, mode, onClose, url]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, isSubmitting]);

  useEffect(() => {
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
        measureDialogHeight();
      })
      : null;

    const handleResize = () => {
      measureDialogHeight();
    };

    [headerRef.current, footerRef.current, subtaskSectionRef.current, errorRef.current]
      .filter((element): element is HTMLDivElement => Boolean(element))
      .forEach((element) => resizeObserver?.observe(element));

    window.addEventListener('resize', handleResize);
    dialogResizeCleanupRef.current = () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
    };

    measureDialogHeight();

    return () => {
      dialogResizeCleanupRef.current?.();
      dialogResizeCleanupRef.current = null;
    };
  }, [measureDialogHeight, iframeError, isSubtasksOpen, mode]);

  useEffect(() => () => {
    iframeEscapeCleanupRef.current?.();
    iframeEscapeCleanupRef.current = null;
    iframeSizeObserverCleanupRef.current?.();
    iframeSizeObserverCleanupRef.current = null;
    dialogResizeCleanupRef.current?.();
    dialogResizeCleanupRef.current = null;
  }, []);

  const handleSubmit = () => {
    if (!iframeRef.current?.contentDocument || !iframeRef.current.contentWindow) return;

    let form: HTMLFormElement | null = null;
    if (mode === 'time_entry') {
      form = iframeRef.current.contentDocument.getElementById('new_time_entry') as HTMLFormElement;
    }
    if (!form) {
      form = (iframeRef.current.contentDocument.getElementById('issue-form') as HTMLFormElement) || iframeRef.current.contentDocument.forms[0];
    }

    if (!form) return;

    const formData = new FormData(form);
    const getVal = (name: string) => {
      const v = formData.get(name);
      if (typeof v === 'string' && v.trim()) return Number(v);
      const field = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (field && field.value.trim()) return Number(field.value);
      return undefined;
    };

    parentAttributesRef.current = {
      project_id: getVal('issue[project_id]') ?? getVal('project_id'),
      tracker_id: getVal('issue[tracker_id]'),
      priority_id: getVal('issue[priority_id]'),
      status_id: getVal('issue[status_id]'),
      assigned_to_id: getVal('issue[assigned_to_id]'),
    };

    setIsSubmitting(true);
    iframeRef.current.contentWindow.onbeforeunload = null;
    try {
      const win = iframeRef.current.contentWindow as typeof iframeRef.current.contentWindow & { $?: (arg: Window) => { off: (name: string) => void }; jQuery?: (arg: Window) => { off: (name: string) => void } };
      if (win.$ || win.jQuery) {
        (win.$ || win.jQuery)?.(win)?.off('beforeunload');
      }
    } catch {
      // Ignore jQuery access issues in the iframe.
    }
    form.submit();
  };

  const submitLabel = mode === 'create'
    ? (isSubmitting ? labels.creating : labels.create)
    : (isSubmitting ? labels.saving : labels.save);
  const isViewDialog = mode !== 'create' && isIssueShowUrl(currentUrl || url);
  const resolvedIssueTitle =
    issueTitle && issueId > 0 && !issueTitle.includes(`#${issueId}`)
      ? `${issueTitle} #${issueId}`
      : issueTitle;
  const dialogTitle = mode === 'create'
    ? (labels.issue_create_dialog_title ?? 'Create issue')
    : mode === 'time_entry'
      ? (labels.time_entry_dialog_title ?? 'Log time')
      : resolvedIssueTitle && issueId > 0
        ? resolvedIssueTitle
        : isViewDialog
          ? (labels.issue_info_dialog_title ?? 'Issue details')
          : (labels.issue_edit_dialog_title ?? 'Edit issue');
  const issueDialogLinkUrl = currentUrl || url;
  const issueDialogLinkLabel = labels.open_in_redmine ?? 'Open in Redmine';
  const closeLabel = labels.close ?? 'Close';
  const maxDialogHeight = Math.floor(window.innerHeight * MAX_DIALOG_VIEWPORT_HEIGHT_RATIO);
  const effectiveDialogHeight = dialogHeightPx ?? maxDialogHeight;

  const containerStyle: React.CSSProperties = {
    width: `${DEFAULT_DIALOG_WIDTH_PX}px`,
    maxWidth: '98vw',
    height: `${effectiveDialogHeight}px`,
    maxHeight: `${maxDialogHeight}px`,
    backgroundColor: '#fff',
    borderRadius: '6px',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.2), 0 4px 6px -2px rgba(0, 0, 0, 0.1)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxSizing: 'border-box',
  };

  return (
    <div
      className="rk-modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="rk-iframe-dialog-container rk-iframe-dialog-container-issue"
        style={containerStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <IssueDialogHeader
          ref={headerRef}
          dataTestId="issue-dialog-header"
          title={dialogTitle}
          linkUrl={issueDialogLinkUrl}
          linkAriaLabel={issueDialogLinkLabel}
          onClose={onClose}
          closeAriaLabel={closeLabel}
          compact
          iconButtonSize={COMPACT_ICON_BUTTON_SIZE}
        />

        <div style={{ flex: '1 1 auto', position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {iframeError ? (
            <div
              data-testid="issue-dialog-error"
              ref={errorRef}
              style={{
                flex: '0 0 auto',
                padding: '12px 16px',
                backgroundColor: '#fdecea',
                color: '#b71c1c',
                borderBottom: '1px solid #f5c6cb',
                fontSize: 13,
              }}
            >
              {iframeError}
            </div>
          ) : null}

          <div className="rk-iframe-wrapper">
            <iframe
              ref={iframeRef}
              className={`rk-iframe-dialog-frame${isLoading ? ' issue-iframe-loading' : ''}`}
              src={url}
              onLoad={handleLoad}
            />
          </div>
        </div>

        {mode !== 'time_entry' ? (
          <div
            ref={subtaskSectionRef}
            className="rk-create-footer rk-create-footer-compact"
            style={{
              flex: '0 0 auto',
              padding: '8px 12px 0 12px',
              backgroundColor: '#fff',
              borderTop: '1px solid #e0e0e0',
            }}
          >
            <div className="rk-subtask-input">
              <button
                type="button"
                className="rk-subtask-toggle"
                onClick={() => setIsSubtasksOpen(!isSubtasksOpen)}
              >
                <span
                  className="rk-subtask-toggle-icon"
                  style={{ transform: isSubtasksOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                >
                  ▶
                </span>
                <label className="rk-label rk-subtask-toggle-label">{labels.bulk_subtask_title}</label>
              </button>
              {isSubtasksOpen ? (
                <textarea
                  rows={3}
                  value={subtasks}
                  onChange={(e) => setSubtasks(e.target.value)}
                  placeholder={labels.bulk_subtask_placeholder}
                  disabled={isSubmitting}
                  className="rk-subtask-textarea"
                />
              ) : null}
            </div>
          </div>
        ) : null}

        <div
          data-testid="issue-dialog-footer"
          ref={footerRef}
          className="rk-create-footer rk-create-footer-compact"
          style={{
            flex: '0 0 auto',
            flexDirection: 'row',
            alignItems: 'center',
            padding: '2px 12px 4px 12px',
            display: 'flex',
            justifyContent: 'flex-start',
            gap: '6px',
            backgroundColor: '#fff',
            borderTop: mode === 'time_entry' ? '1px solid #e0e0e0' : 'none',
          }}
        >
          <button
            type="button"
            className="rk-btn"
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              height: `${COMPACT_ACTION_BUTTON_HEIGHT}px`,
              minWidth: `${COMPACT_ACTION_BUTTON_MIN_WIDTH}px`,
            }}
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            className="rk-btn rk-btn-primary"
            onClick={handleSubmit}
            disabled={isSubmitting}
            style={{
              height: `${COMPACT_ACTION_BUTTON_HEIGHT}px`,
              minWidth: `${COMPACT_ACTION_BUTTON_MIN_WIDTH}px`,
            }}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
