import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyLinkTargetBlank, getCleanDialogStyles, type CleanDialogStyleVariant } from './board/iframeStyles';
import { IssueDialogHeader } from './IssueDialogHeader';
import { extractIssueIdFromUrl } from './utils/url';
import { BulkSubtaskError, useBulkSubtaskMutation } from './hooks/useBulkSubtaskMutation';
import { BulkSubtaskEditor } from './BulkSubtaskEditor';
import type { SubtaskCreateInput } from './bulkSubtasks';
import { getJson } from './http';
import {
  buildIssueEditUrl,
  findJournalEditForm,
  getActiveSaveForm,
  getRedmineFormErrorMessage,
  hasRedmineFormError,
  isIssueShowUrl,
  readNumericFormValue,
  shouldTreatEditLoadAsSuccess,
  submitForm,
  type SaveTarget,
} from './iframe/redmineForm';
import {
  calculateDialogHeight,
  getDialogContentHeight,
  MAX_DIALOG_VIEWPORT_HEIGHT_RATIO,
} from './iframe/iframeMeasurement';
import { observeDialogChrome, observeIframeDocument } from './iframe/iframeObservers';
import { resolveSaveLoadOutcome } from './iframe/saveFlow';

const DEFAULT_DIALOG_WIDTH_PX = 1600;
const COMPACT_ICON_BUTTON_SIZE = 24;
const COMPACT_ACTION_BUTTON_HEIGHT = 28;
const COMPACT_ACTION_BUTTON_MIN_WIDTH = 112;

type DialogMode = 'form' | 'saving' | 'issue-show' | 'error';
export type { SaveTarget } from './iframe/redmineForm';
export {
  buildIssueEditUrl,
  findJournalEditForm,
  getActiveSaveForm,
  hasRedmineFormError,
  isIssueShowUrl,
  shouldTreatEditLoadAsSuccess,
  submitForm,
} from './iframe/redmineForm';

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

export function formatBulkSubtaskError(error: unknown, fallback: string): string {
  if (!(error instanceof BulkSubtaskError)) return fallback;

  const { rowIndex, subject, status, message, fieldErrors } = error.details;
  const fields = Object.values(fieldErrors).flat().filter(Boolean);
  const reason = [message, ...fields].filter((value, index, values) => values.indexOf(value) === index).join(' / ');
  const statusText = status ? `HTTP ${status}` : null;
  return [
    fallback,
    `${rowIndex + 1}行目「${subject}」`,
    statusText,
    reason,
  ].filter(Boolean).join('：');
}

type Props = {
  url: string;
  issueId: number;
  issueTitle?: string;
  projectId?: number;
  mode?: 'create' | 'edit' | 'time_entry';
  labels: Record<string, string>;
  baseUrl: string;
  queryKey: readonly unknown[];
  projectIds?: number[];
  scopeStatusIds?: number[];
  dependencyStatusIds?: number[];
  boardEntityLimit?: number;
  onClose: () => void;
  onSuccess: (message: string, issueId?: number) => void;
  onNativeWriteComplete?: () => void;
  onTimeEntrySubmitting?: () => Promise<boolean> | boolean;
  onTimeEntryValidationError?: () => Promise<boolean> | boolean;
  onTimeEntryUnknown?: () => Promise<boolean> | boolean;
  onTimeEntrySuccess?: () => Promise<boolean> | boolean;
};

export function IframeEditDialog({ url, issueId, issueTitle, projectId, mode = 'edit', labels, baseUrl, queryKey, projectIds = [], scopeStatusIds = [], dependencyStatusIds = scopeStatusIds, boardEntityLimit = 1500, onClose, onSuccess, onNativeWriteComplete, onTimeEntrySubmitting, onTimeEntryValidationError, onTimeEntryUnknown, onTimeEntrySuccess }: Props) {
  const [subtasks, setSubtasks] = useState<SubtaskCreateInput[]>([]);
  const [subtaskValidationError, setSubtaskValidationError] = useState<string | null>(null);
  const [trackerOptions, setTrackerOptions] = useState<Array<{ id: number; name: string }>>([]);
  const [parentTrackerId, setParentTrackerId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaveTransitioning, setIsSaveTransitioning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [dialogHeightPx, setDialogHeightPx] = useState<number | null>(null);
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [isSubtasksOpen, setIsSubtasksOpen] = useState(false);
  const [subtaskRegistrationConsumed, setSubtaskRegistrationConsumed] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>('form');
  const [displayedIssueId, setDisplayedIssueId] = useState<number | null>(null);
  const [saveTarget, setSaveTarget] = useState<SaveTarget>(
    mode === 'time_entry' ? 'time_entry' : mode === 'create' ? 'new-issue' : 'issue',
  );
  const isSubmittingRef = useRef(false);
  const saveTransitionRef = useRef(false);
  const successHandlingRef = useRef(false);
  const saveTargetRef = useRef<SaveTarget>(null);
  const submitPreparationRef = useRef(false);
  const nativeSubmitBypassRef = useRef(false);
  const iframeSubmitCleanupRef = useRef<(() => void) | null>(null);
  const dialogClosingRef = useRef(false);
  const submitSubtasksAfterEditLoadRef = useRef(false);
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
  const parentTrackerChangeCleanupRef = useRef<(() => void) | null>(null);
  const onTimeEntryUnknownRef = useRef(onTimeEntryUnknown);

  const bulkMutation = useBulkSubtaskMutation(baseUrl, queryKey, projectIds, scopeStatusIds, dependencyStatusIds, boardEntityLimit, true);
  const requestClose = useCallback(() => {
    dialogClosingRef.current = true;
    onClose();
  }, [onClose]);
  const hasSubtaskInput = useMemo(
    () => subtasks.some((subtask) => subtask.subject.trim().length > 0),
    [subtasks],
  );

  useEffect(() => {
    if (mode === 'time_entry') return;

    let active = true;
    const query = projectId ? `?target_project_id=${encodeURIComponent(projectId)}` : '';
    void getJson<{ trackers: Array<{ id: number; name: string }> }>(`${baseUrl}/trackers${query}`)
      .then((result) => {
        if (active) setTrackerOptions(result.trackers);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [baseUrl, mode, projectId]);

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  useEffect(() => {
    onTimeEntryUnknownRef.current = onTimeEntryUnknown;
  }, [onTimeEntryUnknown]);

  useEffect(() => () => {
    if (mode === 'time_entry' && isSubmittingRef.current && saveTargetRef.current === 'time_entry') void onTimeEntryUnknownRef.current?.();
  }, [mode]);

  const measureDialogHeight = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      setDialogHeightPx(Math.floor(window.innerHeight * MAX_DIALOG_VIEWPORT_HEIGHT_RATIO));
      return;
    }

    setDialogHeightPx(calculateDialogHeight(
      window.innerHeight,
      getDialogContentHeight(doc),
      [headerRef.current, errorRef.current, subtaskSectionRef.current, footerRef.current],
    ));
  }, []);

  const bindIframeSizeObservers = useCallback((doc: Document) => {
    iframeSizeObserverCleanupRef.current?.();

    iframeSizeObserverCleanupRef.current = observeIframeDocument(
      doc,
      iframeRef.current?.contentWindow ?? null,
      measureDialogHeight,
      () => {
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
      },
    );
  }, [currentUrl, issueId, measureDialogHeight, mode]);

  const handleSuccess = useCallback(async (targetIssueId: number) => {
    if (successHandlingRef.current) return;
    successHandlingRef.current = true;
    saveTransitionRef.current = false;
    setIsSaveTransitioning(false);
    const completedSaveTarget = saveTargetRef.current;

    if (completedSaveTarget === 'journal') {
      setDisplayedIssueId(targetIssueId);
      setSaveTarget(null);
      saveTargetRef.current = null;
      setDialogMode('issue-show');
      setIsSubmitting(false);
      onSuccess(labels.saved.replace('%{id}', String(targetIssueId)), targetIssueId);
      onNativeWriteComplete?.();
      return;
    }

    if (completedSaveTarget === 'time_entry' || mode === 'time_entry') {
      setSaveTarget(null);
      saveTargetRef.current = null;
      setDialogMode('form');
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      await onTimeEntrySuccess?.();
      onSuccess(labels.successful_update, targetIssueId);
      return;
    }

    const lines = subtasks;

    if (lines.length > 0) {
      try {
        await bulkMutation.mutateAsync({
          parent: {
            parent_issue_id: targetIssueId,
            project_id: parentAttributesRef.current.project_id,
          },
          subtasks: lines.map((subtask) => ({
            parent_issue_id: targetIssueId,
            subject: subtask.subject,
            project_id: parentAttributesRef.current.project_id,
            tracker_id: subtask.trackerId,
            priority_id: parentAttributesRef.current.priority_id,
            status_id: parentAttributesRef.current.status_id,
            assigned_to_id: parentAttributesRef.current.assigned_to_id,
          })),
        });
        setSubtaskRegistrationConsumed(true);
        setSubtasks([]);
        setSubtaskValidationError(null);
        setIsSubtasksOpen(false);
        onSuccess(
          (mode === 'create' ? labels.created_with_subtasks : labels.updated_with_subtasks)
            .replace('%{id}', String(targetIssueId))
            .replace('%{count}', String(lines.length)),
          targetIssueId,
        );
      } catch (error) {
        const failureMessage = (mode === 'create' ? labels.created_subtask_failed : labels.updated_subtask_failed)
          .replace('%{id}', String(targetIssueId));
        const detailedMessage = formatBulkSubtaskError(error, failureMessage);
        setIframeError(detailedMessage);
        onSuccess(detailedMessage, targetIssueId);
      }
    } else {
      onSuccess(
        (mode === 'create' ? labels.created : labels.saved)
          .replace('%{id}', String(targetIssueId)),
        targetIssueId,
      );
    }

    setDisplayedIssueId(targetIssueId);
    setDialogMode('issue-show');
    setSaveTarget(null);
    saveTargetRef.current = null;
    setIsSubmitting(false);
    onNativeWriteComplete?.();
  }, [bulkMutation, labels, mode, onNativeWriteComplete, onSuccess, onTimeEntrySuccess, subtasks]);

  const submitIssueForm = useCallback(async (form: HTMLFormElement, target: SaveTarget) => {
    if (target === 'time_entry' && (submitPreparationRef.current || isSubmittingRef.current)) return;
    if (target === 'time_entry') submitPreparationRef.current = true;
    const formData = new FormData(form);
    const getVal = (name: string) => readNumericFormValue(formData, form, name);

    parentAttributesRef.current = {
      project_id: getVal('issue[project_id]') ?? getVal('project_id') ?? projectId,
      tracker_id: getVal('issue[tracker_id]'),
      priority_id: getVal('issue[priority_id]'),
      status_id: getVal('issue[status_id]'),
      assigned_to_id: getVal('issue[assigned_to_id]'),
    };

    if (target === 'time_entry' && onTimeEntrySubmitting && !await onTimeEntrySubmitting()) {
      submitPreparationRef.current = false;
      setIframeError(labels.timer_conflict ?? 'Unable to secure the work timer session.');
      return;
    }
    if (target === 'time_entry' && dialogClosingRef.current) {
      submitPreparationRef.current = false;
      return;
    }
    if (target === 'time_entry') submitPreparationRef.current = false;
    setDialogMode('saving');
    successHandlingRef.current = false;
    saveTransitionRef.current = false;
    setIsSaveTransitioning(false);
    setSaveTarget(target);
    saveTargetRef.current = target;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.onbeforeunload = null;
      try {
        const win = iframeRef.current.contentWindow as typeof iframeRef.current.contentWindow & { $?: (arg: Window) => { off: (name: string) => void }; jQuery?: (arg: Window) => { off: (name: string) => void } };
        if (win.$ || win.jQuery) {
          (win.$ || win.jQuery)?.(win)?.off('beforeunload');
        }
      } catch {
        // Ignore jQuery access issues in the iframe.
      }
    }
    nativeSubmitBypassRef.current = true;
    try {
      submitForm(form);
    } finally {
      nativeSubmitBypassRef.current = false;
    }
  }, [labels.timer_conflict, onTimeEntrySubmitting, projectId]);

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
        iframeSubmitCleanupRef.current?.();
        iframeSubmitCleanupRef.current = null;
        if (mode === 'time_entry') {
          const handleNativeSubmit = (event: Event) => {
            const form = event.target instanceof HTMLFormElement ? event.target : null;
            if (!form) return;
            if (nativeSubmitBypassRef.current) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (isSubmittingRef.current || submitPreparationRef.current) return;
            void submitIssueForm(form, 'time_entry');
          };
          doc.addEventListener('submit', handleNativeSubmit, true);
          iframeSubmitCleanupRef.current = () => doc.removeEventListener('submit', handleNativeSubmit, true);
        }
        const trackerSelect = doc.querySelector<HTMLSelectElement>('select[name="issue[tracker_id]"], select#issue_tracker_id');
        if (trackerSelect) {
          setTrackerOptions(Array.from(trackerSelect.options).map((option) => ({ id: Number(option.value), name: option.textContent?.trim() ?? option.value })).filter((option) => option.id > 0));
          setParentTrackerId(Number(trackerSelect.value) || null);
          parentTrackerChangeCleanupRef.current?.();
          const handleParentTrackerChange = () => setParentTrackerId(Number(trackerSelect.value) || null);
          trackerSelect.addEventListener('change', handleParentTrackerChange);
          parentTrackerChangeCleanupRef.current = () => trackerSelect.removeEventListener('change', handleParentTrackerChange);
        }
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
        if (activeSaveForm?.target === 'issue' && submitSubtasksAfterEditLoadRef.current) {
          submitSubtasksAfterEditLoadRef.current = false;
          void submitIssueForm(activeSaveForm.form, activeSaveForm.target);
        } else if (activeSaveForm?.target === 'journal') {
          setDialogMode('form');
        } else if (isIssueShowUrl(nextCurrentUrl)) {
          setDisplayedIssueId(extractIssueIdFromUrl(nextCurrentUrl));
          setDialogMode('issue-show');
        } else {
          saveTransitionRef.current = false;
          setIsSaveTransitioning(false);
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
              requestClose();
            }
          };
          iframe.contentWindow.addEventListener('keydown', handleIframeEscape, true);
          iframeEscapeCleanupRef.current = () => {
            iframe.contentWindow?.removeEventListener('keydown', handleIframeEscape, true);
        };
      }

      if (isSubmittingRef.current) {
        const outcome = resolveSaveLoadOutcome({
          doc,
          currentUrl: nextCurrentUrl,
          saveTarget: saveTargetRef.current,
          mode,
          fallbackIssueId: issueId,
        });
        if (outcome.type === 'error') {
          if (saveTargetRef.current === 'time_entry' || mode === 'time_entry') {
            void (async () => {
              const synchronized = await onTimeEntryValidationError?.();
              if (synchronized === false) {
                setIframeError(labels.timer_sync_failed ?? 'Timer state synchronization failed. Retry synchronization before submitting again.');
                return;
              }
              setDialogMode('error');
              setIsSubmitting(false);
              setSaveTarget(null);
              saveTargetRef.current = null;
            })();
          } else {
            setDialogMode('error');
            setIsSubmitting(false);
            setSaveTarget(null);
            saveTargetRef.current = null;
          }
        } else if (outcome.type === 'success') {
          void handleSuccess(outcome.issueId);
          return;
        } else if (outcome.type === 'keep-submitting') {
          // Keep the submit lock while the iframe is still showing the form
          // that initiated this save. Redmine can reload that form before
          // navigating to the saved issue, and another click must not submit it again.
        } else {
          setIsSubmitting(false);
        }
      }
      }
    } catch (err) {
      console.warn('Cannot access iframe content:', err);
      setIframeError(null);
      if (isSubmittingRef.current) {
        if (saveTargetRef.current === 'time_entry' || mode === 'time_entry') {
          void (async () => {
            const synchronized = await onTimeEntryUnknown?.();
            if (synchronized === false) {
              setIframeError(labels.timer_sync_failed ?? 'Timer state synchronization failed. Retry synchronization before submitting again.');
              return;
            }
            setIsSubmitting(false);
          })();
        } else {
          setIsSubmitting(false);
        }
      }
    } finally {
      setIsLoading(false);
      window.requestAnimationFrame(() => {
        measureDialogHeight();
      });
    }
  }, [bindIframeSizeObservers, handleSuccess, issueId, labels.timer_sync_failed, measureDialogHeight, mode, onTimeEntryUnknown, onTimeEntryValidationError, requestClose, submitIssueForm, url]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        requestClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isSubmitting, requestClose]);

  useEffect(() => {
    dialogResizeCleanupRef.current = observeDialogChrome(
      [headerRef.current, footerRef.current, subtaskSectionRef.current, errorRef.current],
      measureDialogHeight,
    );

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
    parentTrackerChangeCleanupRef.current?.();
    parentTrackerChangeCleanupRef.current = null;
    iframeSubmitCleanupRef.current?.();
    iframeSubmitCleanupRef.current = null;
  }, []);

  const handleSubmit = () => {
    if (isSubmittingRef.current || saveTransitionRef.current || submitPreparationRef.current) return;
    if (!iframeRef.current?.contentDocument || !iframeRef.current.contentWindow) return;
    if (subtaskValidationError) return;

    if (dialogMode === 'issue-show') {
      const targetIssueId = displayedIssueId ?? issueId;
      successHandlingRef.current = false;
      if (!hasSubtaskInput) {
        setSubtaskRegistrationConsumed(false);
        setSubtasks([]);
        setSubtaskValidationError(null);
      }
      submitSubtasksAfterEditLoadRef.current = hasSubtaskInput;
      if (hasSubtaskInput) {
        saveTransitionRef.current = true;
        setIsSaveTransitioning(true);
      }
      iframeRef.current.contentWindow.location.href = buildIssueEditUrl(currentUrl || url, targetIssueId);
      setDialogMode('form');
      setSaveTarget('issue');
      return;
    }

    const activeSaveForm = getActiveSaveForm(iframeRef.current.contentDocument, mode, currentUrl);
    if (!activeSaveForm) return;

    const { form, target } = activeSaveForm;

    void submitIssueForm(form, target);
  };

  const effectiveSaveTarget = saveTargetRef.current ?? saveTarget;
  const submitLabel = dialogMode === 'issue-show'
    ? (hasSubtaskInput ? labels.save : labels.edit_issue)
    : effectiveSaveTarget === 'journal'
      ? (isSubmitting ? labels.saving_comment : labels.save_comment)
      : effectiveSaveTarget === 'new-issue'
        ? (isSubmitting ? labels.creating : (labels.create_issue ?? labels.create))
        : (isSubmitting ? labels.saving : labels.save);
  const showPrimaryAction = dialogMode === 'issue-show' || saveTarget !== null || isSubmitting;
  const isViewDialog = mode !== 'create' && isIssueShowUrl(currentUrl || url);
  const resolvedIssueTitle =
    issueTitle && issueId > 0 && !issueTitle.includes(`#${issueId}`)
      ? `${issueTitle} #${issueId}`
      : issueTitle;
  const dialogTitle = mode === 'create'
    ? labels.issue_create_dialog_title
    : mode === 'time_entry'
      ? labels.time_entry_dialog_title
      : resolvedIssueTitle && issueId > 0
        ? resolvedIssueTitle
        : isViewDialog
          ? labels.issue_info_dialog_title
          : labels.issue_edit_dialog_title;
  const issueDialogLinkUrl = currentUrl || url;
  const issueDialogLinkLabel = labels.open_in_redmine;
  const closeLabel = labels.close;
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
          requestClose();
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
              onClose={requestClose}
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
            className="rk-create-footer rk-create-footer-compact rk-subtask-footer"
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
                disabled={subtaskRegistrationConsumed || isSubmitting || isSaveTransitioning}
              >
                <span
                  className="rk-subtask-toggle-icon"
                  style={{ transform: isSubtasksOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                >
                  ▶
                </span>
                <span className="rk-label rk-subtask-toggle-label">{labels.bulk_subtask_title}</span>
              </button>
              {isSubtasksOpen ? (
                <BulkSubtaskEditor
                  labels={labels}
                  trackers={trackerOptions}
                  initialTrackerId={parentTrackerId}
                  showRowTrackerButton={false}
                  disabled={isSubmitting || isSaveTransitioning}
                  onChange={setSubtasks}
                  onValidationChange={setSubtaskValidationError}
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
            onClick={requestClose}
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
              disabled={isSubmitting || isSaveTransitioning}
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
