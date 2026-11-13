// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KanbanIssueModal } from './KanbanIssueModal';
import type { BoardData } from './types';

const labels: Record<string, string> = {
  cancel: 'Cancel',
  close: 'Close',
  create: 'Create',
  delete: 'Delete',
  delete_confirm_message: 'Delete %{id}?',
  invalid_assignee: 'Invalid assignee',
  invalid_priority: 'Invalid priority',
  issue_assignee: 'Assignee',
  issue_create_dialog_title: 'Create issue',
  issue_description: 'Description',
  issue_done_ratio: 'Done ratio',
  issue_due_date: 'Due date',
  issue_priority: 'Priority',
  issue_start_date: 'Start date',
  issue_subject: 'Subject',
  issue_tracker: 'Tracker',
  not_set: 'Not set',
  open_in_redmine: 'Open in Redmine',
  save: 'Save',
  saving: 'Saving',
  select_tracker: 'Select tracker',
  url_clickable: 'Links',
};

const data = {
  ok: true,
  issues: [{
    id: 7,
    subject: 'Unknown tracker issue',
    status_id: 1,
    tracker_id: null,
    description: '',
    assigned_to_id: null,
    lock_version: 1,
    urls: { issue: '/issues/7', issue_edit: '/issues/7/edit' },
    project: { id: 1, name: 'Demo' },
  }],
  columns: [{ id: 1, name: 'Open', is_closed: false, count: 1 }],
  lanes: [{ id: 'none', name: 'All', assigned_to_id: null }],
  lists: {
    assignees: [],
    trackers: [{ id: 1, name: 'Bug' }, { id: 2, name: 'Feature' }],
    priorities: [],
    projects: [{ id: 1, name: 'Demo', level: 0 }],
    viewable_projects: [{ id: 1, name: 'Demo', level: 0 }],
    creatable_projects: [{ id: 1, name: 'Demo', level: 0 }],
  },
  labels,
  meta: {
    project_id: 1,
    project_ids: [1],
    current_user_id: 1,
    can_move: true,
    can_create: true,
    can_delete: true,
    lane_type: 'none',
    aging_warn_days: 3,
    aging_danger_days: 7,
    aging_exclude_closed: false,
  },
} as BoardData;

describe('KanbanIssueModal', () => {
  afterEach(() => cleanup());

  it('uses the shared tracker title projection for a child issue', () => {
    const childData = {
      ...data,
      issues: [{
        ...data.issues[0],
        id: 8,
        subject: 'Child issue',
        tracker_id: 2,
        parent_id: 7,
      }, {
        ...data.issues[0],
        id: 7,
        subject: 'Parent issue',
        tracker_id: 1,
        subtasks: [{
          id: 8,
          subject: 'Child issue',
          status_id: 1,
          tracker_id: 2,
          is_closed: false,
        }],
      }],
    } as BoardData;

    render(
      <KanbanIssueModal
        data={childData}
        baseUrl="/projects/demo/kanban"
        ctx={{ statusId: 1, issueId: 8 }}
        onClose={() => {}}
        onSaved={async () => {}}
        onDeleted={async () => {}}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Feature #8 Child issue' })).toBeTruthy();
  });

  it('keeps an unknown edit tracker visibly unselected instead of defaulting to the first tracker', () => {
    render(
      <KanbanIssueModal
        data={data}
        baseUrl="/projects/demo/kanban"
        ctx={{ statusId: 1, issueId: 7 }}
        onClose={() => {}}
        onSaved={async () => {}}
        onDeleted={async () => {}}
      />,
    );

    const tracker = screen.getByRole('combobox', { name: 'Tracker' }) as HTMLSelectElement;
    expect(tracker.value).toBe('');
    expect(screen.getByRole('option', { name: 'Select tracker' })).toBeTruthy();
  });

  it('disables done_ratio select and omits done_ratio from save payload when can_edit_done_ratio is false', async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const editData = {
      ...data,
      issues: [{
        ...data.issues[0],
        tracker_id: 1,
        done_ratio: 40,
        permissions: { can_move: true, can_edit: true, can_delete: true, can_edit_done_ratio: false },
      }],
    } as BoardData;

    render(
      <KanbanIssueModal
        data={editData}
        baseUrl="/projects/demo/kanban"
        ctx={{ statusId: 1, issueId: 7 }}
        onClose={() => {}}
        onSaved={onSaved}
        onDeleted={async () => {}}
      />,
    );

    const doneRatioSelect = screen.getByRole('combobox', { name: 'Done ratio' }) as HTMLSelectElement;
    expect(doneRatioSelect.disabled).toBe(true);
    expect(doneRatioSelect.value).toBe('40');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const [payload, isEdit] = onSaved.mock.calls[0];
    expect(isEdit).toBe(true);
    expect('done_ratio' in payload).toBe(false);
  });

  it('enables done_ratio select and includes done_ratio in save payload when can_edit_done_ratio is true', async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const editData = {
      ...data,
      issues: [{
        ...data.issues[0],
        tracker_id: 1,
        done_ratio: 40,
        permissions: { can_move: true, can_edit: true, can_delete: true, can_edit_done_ratio: true },
      }],
    } as BoardData;

    render(
      <KanbanIssueModal
        data={editData}
        baseUrl="/projects/demo/kanban"
        ctx={{ statusId: 1, issueId: 7 }}
        onClose={() => {}}
        onSaved={onSaved}
        onDeleted={async () => {}}
      />,
    );

    const doneRatioSelect = screen.getByRole('combobox', { name: 'Done ratio' }) as HTMLSelectElement;
    expect(doneRatioSelect.disabled).toBe(false);
    fireEvent.change(doneRatioSelect, { target: { value: '70' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const [payload, isEdit] = onSaved.mock.calls[0];
    expect(isEdit).toBe(true);
    expect(payload.done_ratio).toBe(70);
  });

  it('enables done_ratio select and includes done_ratio when creating a new issue', async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined);

    render(
      <KanbanIssueModal
        data={data}
        baseUrl="/projects/demo/kanban"
        ctx={{ statusId: 1 }}
        onClose={() => {}}
        onSaved={onSaved}
        onDeleted={async () => {}}
      />,
    );

    const doneRatioSelect = screen.getByRole('combobox', { name: 'Done ratio' }) as HTMLSelectElement;
    expect(doneRatioSelect.disabled).toBe(false);
    fireEvent.change(doneRatioSelect, { target: { value: '30' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const [payload, isEdit] = onSaved.mock.calls[0];
    expect(isEdit).toBe(false);
    expect(payload.done_ratio).toBe(30);
  });
});
