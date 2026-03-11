import React, { useEffect, useRef, useState } from 'react';
import { CleanDialogStyleVariant, getCleanDialogStyles } from './board/iframeStyles';
import { IssueDialogHeader } from './IssueDialogHeader';
import { extractIssueIdFromUrl } from './utils/url';
import { useBulkSubtaskMutation } from './hooks/useBulkSubtaskMutation';

const REDMINE_ERROR_SELECTORS = ['#errorExplanation', '.flash.error', '.flash-error'] as const;

export function hasRedmineFormError(doc: Document): boolean {
    return REDMINE_ERROR_SELECTORS.some((selector) => doc.querySelector(selector) !== null);
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
    const [iframeRef, setIframeRef] = useState<HTMLIFrameElement | null>(null);
    const [currentUrl, setCurrentUrl] = useState(url);
    const isSubmittingRef = useRef(false);
    const isIssueDialog = mode !== 'time_entry';
    const isTimeEntryDialog = mode === 'time_entry';

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
            if (currentUrl) {
                setCurrentUrl(currentUrl);
            }

            if (doc) {
                const style = doc.createElement('style');
                const styleVariant = resolveDialogStyleVariant(mode, currentUrl, url);
                style.textContent = getCleanDialogStyles({
                    variant: styleVariant,
                });
                doc.head.appendChild(style);

                // Add Escape key listener for the iframe content
                iframe.contentWindow?.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Escape' && !isSubmittingRef.current) {
                        onClose();
                    }
                });

                // Detect successful update by checking URL (issue page without /edit)
                if (isSubmittingRef.current) {
                    if (mode === 'create') {
                        // For create mode, detect new issue ID in URL
                        const newIssueId = extractIssueIdFromUrl(currentUrl);
                        if (newIssueId) {
                            createdIssueIdRef.current = newIssueId;
                            handleSuccess(newIssueId);
                            return;
                        }
                    } else if (mode === 'time_entry') {
                        // For time_entry, Redmine redirects to issue page or time_entries list after success
                        // If we're no longer on the new time_entry form, consider it a success
                        if (!currentUrl.includes('/time_entries/new')) {
                            handleSuccess(issueId);
                            return;
                        }
                    } else {
                        // For edit mode, require both show URL and no visible validation/flash errors.
                        if (shouldTreatEditLoadAsSuccess(currentUrl, doc)) {
                            handleSuccess(issueId);
                            return;
                        }
                    }

                    // If still on form page with errors, reset submitting state
                    setIsSubmitting(false);
                }
            }
        } catch (err) {
            console.warn('Cannot access iframe content:', err);
            // Cross-origin error might mean redirect happened - reset state
            if (isSubmittingRef.current) {
                setIsSubmitting(false);
            }
        } finally {
            // Reveal iframe after styles are injected
            setIsLoading(false);
        }
    };

    const parentAttributesRef = useRef<Record<string, number | undefined>>({});
    const createdIssueIdRef = useRef<number | null>(null);

    const handleSuccess = async (targetIssueId: number) => {
        if (mode === 'time_entry') {
            onSuccess(labels.successful_update ?? 'Successful update');
            onClose();
            return;
        }

        const lines = subtasks.split('\n').map(s => s.trim()).filter(s => s.length > 0);

        if (lines.length > 0) {
            try {
                await bulkMutation.mutateAsync(lines.map(subject => ({
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
            } catch (e) {
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
    };

    const handleSubmit = () => {
        if (!iframeRef?.contentDocument || !iframeRef?.contentWindow) return;

        // Find the appropriate form based on mode
        let form: HTMLFormElement | null = null;
        if (mode === 'time_entry') {
            // Redmine's time entry form has id 'new_time_entry'
            form = iframeRef.contentDocument.getElementById('new_time_entry') as HTMLFormElement;
        }
        if (!form) {
            form = (iframeRef.contentDocument.getElementById('issue-form') as HTMLFormElement) || iframeRef.contentDocument.forms[0];
        }

        if (form) {
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

    const submitLabel = mode === 'create'
        ? (isSubmitting ? labels.creating : labels.create)
        : mode === 'time_entry'
            ? (isSubmitting ? labels.saving : labels.save)
            : (isSubmitting ? labels.saving : labels.save);
    const dialogContainerClassName = `rk-iframe-dialog-container${isIssueDialog ? ' rk-iframe-dialog-container-issue' : ''}${isTimeEntryDialog ? ' rk-iframe-dialog-container-time-entry' : ''}`;
    const footerClassName = `rk-create-footer${isIssueDialog || isTimeEntryDialog ? ' rk-create-footer-compact' : ''}${isTimeEntryDialog ? ' rk-create-footer-time-entry' : ''}`;
    const actionsClassName = `rk-modal-actions${isIssueDialog || isTimeEntryDialog ? ' rk-modal-actions-start' : ''}`;
    const isViewDialog = mode !== 'create' && isIssueShowUrl(currentUrl || url);
    const resolvedIssueTitle =
        issueTitle && issueId > 0 && !issueTitle.includes(`#${issueId}`)
            ? `${issueTitle} #${issueId}`
            : issueTitle;
    const dialogTitle = mode === 'create'
        ? (labels.issue_create_dialog_title ?? 'Create issue')
        : resolvedIssueTitle && issueId > 0
            ? resolvedIssueTitle
            : isViewDialog
                ? (labels.issue_info_dialog_title ?? 'Issue details')
                : (labels.issue_edit_dialog_title ?? 'Edit issue');
    const issueDialogLinkUrl = mode === 'time_entry' ? null : (currentUrl || url);
    const issueDialogLinkLabel = labels.open_in_redmine ?? 'Open in Redmine';
    const closeLabel = labels.close ?? 'Close';

    const [isSubtasksOpen, setIsSubtasksOpen] = useState(false);

    return (
        <div className="rk-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
            <div className={dialogContainerClassName} onClick={(e) => e.stopPropagation()}>
                {isIssueDialog ? (
                    <IssueDialogHeader
                        title={dialogTitle}
                        linkUrl={issueDialogLinkUrl}
                        linkAriaLabel={issueDialogLinkLabel}
                        onClose={onClose}
                        closeAriaLabel={closeLabel}
                    />
                ) : null}
                <div className="rk-iframe-wrapper">
                    <iframe className="rk-iframe-dialog-frame" src={url} onLoad={handleLoad} />
                </div>

                <div className={footerClassName}>
                    {mode !== 'time_entry' && (
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
                            {isSubtasksOpen && (
                                <textarea
                                    rows={3}
                                    value={subtasks}
                                    onChange={e => setSubtasks(e.target.value)}
                                    placeholder={labels.bulk_subtask_placeholder}
                                    disabled={isSubmitting}
                                    className="rk-subtask-textarea"
                                />
                            )}
                        </div>
                    )}
                    <div className={actionsClassName}>
                        <button type="button" className="rk-btn" onClick={onClose} disabled={isSubmitting}>
                            {labels.cancel}
                        </button>
                        <button type="button" className="rk-btn rk-btn-primary" onClick={handleSubmit} disabled={isSubmitting}>
                            {submitLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
