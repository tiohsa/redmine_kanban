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
const COMPACT_ACTION_BUTTON_MIN_WIDTH = 112;

type DialogMode = 'form' | 'saving' | 'issue-show' | 'error';
export type SaveTarget = 'issue' | 'new-issue' | 'journal' | 'time_entry' | null;

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

export function buildIssueEditUrl(currentUrl: string, fallbackIssueId: number): string {
  const fallbackUrl = `/issues/${fallbackIssueId}/edit`;

  if (!currentUrl) {
    return fallbackUrl;
  }

  try {
    const isAbsoluteUrl = /^[a-z][a-z\d+\-.]*:\/\//i.test(currentUrl);
    const parsedUrl = new URL(currentUrl, 'http://redmine-kanban.local');
    const match = parsedUrl.pathname.match(/^\/issues\/(\d+)\/?$/);

    if (!match) {
      return fallbackUrl;
    }

    parsedUrl.pathname = `/issues/${match[1]}/edit`;
    parsedUrl.search = '';
    parsedUrl.hash = '';

    return isAbsoluteUrl ? parsedUrl.toString() : parsedUrl.pathname;
  } catch {
    return fallbackUrl;
  }
}

export function shouldTreatEditLoadAsSuccess(currentUrl: string, doc: Document): boolean {
  return isIssueShowUrl(currentUrl) && !hasRedmineFormError(doc);
}

export function findJournalEditForm(doc: Document): HTMLFormElement | null {
  return (
    doc.querySelector<HTMLFormElement>('form[action*="/journals/"]') ||
    doc.querySelector<HTMLFormElement>('form[id^="journal-"][id$="-form"]') ||
    doc.querySelector<HTMLTextAreaElement>('textarea[name="journal[notes]"]')?.closest('form') ||
    null
  );
}

export function getActiveSaveForm(
  doc: Document,
  mode: Props['mode'],
  currentUrl: string,
): { form: HTMLFormElement; target: SaveTarget } | null {
  if (mode === 'time_entry') {
    const timeEntryForm = doc.querySelector<HTMLFormElement>('#new_time_entry');
    return timeEntryForm ? { form: timeEntryForm, target: 'time_entry' } : null;
  }

  const journalForm = findJournalEditForm(doc);
  if (journalForm) return { form: journalForm, target: 'journal' };

  const issueForm = doc.querySelector<HTMLFormElement>('#issue-form');
  if (issueForm) {
    return {
      form: issueForm,
      target: mode === 'create' || currentUrl.includes('/issues/new') ? 'new-issue' : 'issue',
    };
  }

  return null;
}

export function submitForm(form: HTMLFormElement): void {
  const submitButton = form.querySelector<HTMLElement>('input[type="submit"], button[type="submit"]');
  if (submitButton) {
    submitButton.click();
    return;
  }

  if (typeof form.requestSubmit === 'function') {
    form.requestSubmit();
    return;
  }

  form.submit();
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
  const [dialogMode, setDialogMode] = useState<DialogMode>('form');
  const [displayedIssueId, setDisplayedIssueId] = useState<number | null>(null);
  const [saveTarget, setSaveTarget] = useState<SaveTarget>(
    mode === 'time_entry' ? 'time_entry' : mode === 'create' ? 'new-issue' : 'issue',
  );
  const isSubmittingRef = useRef(false);
  const saveTargetRef = useRef<SaveTarget>(null);
  const handleSuccessRef = useRef<((targetIssueId: number) => void) | null>(null);
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
        if (isSubmittingRef.current && saveTargetRef.current === 'journal' && !hasRedmineFormError(doc) && !findJournalEditForm(doc)) {
          handleSuccessRef.current?.(issueId);
        } else if (!isSubmittingRef.current) {
          const activeSaveForm = getActiveSaveForm(doc, mode, iframeRef.current?.contentWindow?.location.href ?? currentUrl);
          setSaveTarget(activeSaveForm?.target ?? null);
          if (activeSaveForm?.target === 'journal') {
            setDialogMode('form');
          }
        }
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
  }, [currentUrl, issueId, measureDialogHeight, mode]);

  const handleSuccess = useCallback(async (targetIssueId: number) => {
    const completedSaveTarget = saveTargetRef.current;

    if (completedSaveTarget === 'journal') {
      setDisplayedIssueId(targetIssueId);
      setSaveTarget(null);
      saveTargetRef.current = null;
      setDialogMode('issue-show');
      setIsSubmitting(false);
      onSuccess(labels.saved.replace('%{id}', String(targetIssueId)));
      return;
    }

    if (completedSaveTarget === 'time_entry' || mode === 'time_entry') {
      setSaveTarget(null);
      saveTargetRef.current = null;
      setDialogMode('form');
      setIsSubmitting(false);
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

    setDisplayedIssueId(targetIssueId);
    setDialogMode('issue-show');
    setSaveTarget(null);
    saveTargetRef.current = null;
    setIsSubmitting(false);
  }, [bulkMutation, labels, mode, onClose, onSuccess, subtasks]);

  useEffect(() => {
    handleSuccessRef.current = (targetIssueId: number) => {
      void handleSuccess(targetIssueId);
    };
  }, [handleSuccess]);

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
      if (!isSubmittingRef.current) {
        const activeSaveForm = getActiveSaveForm(doc, mode, nextCurrentUrl);
        setSaveTarget(activeSaveForm?.target ?? null);
        if (activeSaveForm?.target === 'journal') {
          setDialogMode('form');
        } else if (isIssueShowUrl(nextCurrentUrl)) {
          setDisplayedIssueId(extractIssueIdFromUrl(nextCurrentUrl));
          setDialogMode('issue-show');
        } else {
          setDialogMode(errorMessage ? 'error' : 'form');
        }
      }
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
        const currentSaveTarget = saveTargetRef.current;
        const hasError = hasRedmineFormError(doc);

        if (hasError) {
          setDialogMode('error');
          setIsSubmitting(false);
          setSaveTarget(null);
          saveTargetRef.current = null;
        } else if (currentSaveTarget === 'new-issue') {
          const newIssueId = extractIssueIdFromUrl(nextCurrentUrl);
          if (newIssueId) {
            void handleSuccess(newIssueId);
            return;
          }
        } else if (currentSaveTarget === 'issue' && shouldTreatEditLoadAsSuccess(nextCurrentUrl, doc)) {
          const loadedIssueId = extractIssueIdFromUrl(nextCurrentUrl) ?? issueId;
          void handleSuccess(loadedIssueId);
          return;
        } else if (currentSaveTarget === 'time_entry') {
          if (!nextCurrentUrl.includes('/time_entries/new')) {
            void handleSuccess(issueId);
            return;
          }
        } else if (currentSaveTarget === 'journal' && !findJournalEditForm(doc)) {
          void handleSuccess(issueId);
          return;
        } else {
          setIsSubmitting(false);
        }
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

    if (dialogMode === 'issue-show') {
      const targetIssueId = displayedIssueId ?? issueId;
      iframeRef.current.contentWindow.location.href = buildIssueEditUrl(currentUrl || url, targetIssueId);
      setDialogMode('form');
      setSaveTarget('issue');
      return;
    }

    const activeSaveForm = getActiveSaveForm(iframeRef.current.contentDocument, mode, currentUrl);
    if (!activeSaveForm) return;

    const { form, target } = activeSaveForm;

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

    setDialogMode('saving');
    setSaveTarget(target);
    saveTargetRef.current = target;
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
    submitForm(form);
  };

  const effectiveSaveTarget = saveTargetRef.current ?? saveTarget;
  const submitLabel = dialogMode === 'issue-show'
    ? (labels.edit_issue ?? 'Edit issue')
    : effectiveSaveTarget === 'journal'
      ? (isSubmitting ? (labels.saving_comment ?? 'Saving comment...') : (labels.save_comment ?? 'Save comment'))
      : effectiveSaveTarget === 'new-issue' || mode === 'create'
        ? (isSubmitting ? labels.creating : (labels.create_issue ?? labels.create))
        : (isSubmitting ? labels.saving : labels.save);
  const showPrimaryAction = dialogMode === 'issue-show' || saveTarget !== null || isSubmitting;
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
          {showPrimaryAction ? (
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
          ) : null}
        </div>
      </div>
    </div>
  );
}
