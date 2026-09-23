// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolbarMultiSelect } from './ToolbarDropdown';

const labels = { all: 'All', reset: 'Reset' };
const options = [
  { id: 'a', name: 'Project Alpha' },
  { id: 'b', name: 'Project Beta' },
  { id: 'c', name: 'Project C' },
  { id: 'd', name: 'Redmine Kanban' },
  { id: 'e', name: '製造管理' },
  { id: 'f', name: '製造システム' },
  { id: 'g', name: '営業システム' },
];

afterEach(() => cleanup());

function openProjectFilter(value: string[] = [], onChange = vi.fn()) {
  render(
    <ToolbarMultiSelect
      label="Project"
      icon="folder"
      options={options}
      value={value}
      onChange={onChange}
      labels={labels}
      includeAllOption
      searchable
      searchPlaceholder="Search projects..."
      searchEmptyLabel="No matching projects"
    />,
  );
  const selectedTitle = value.length > 0
    ? value.map((id) => options.find((option) => option.id === id)?.name).join(', ')
    : 'Project';
  fireEvent.click(screen.getByTitle(selectedTitle));
  return onChange;
}

describe('ToolbarMultiSelect search', () => {
  it('matches trimmed, case-insensitive queries including Japanese text', () => {
    openProjectFilter();
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: '  KANBAN  ' } });
    expect(screen.getByText('Redmine Kanban')).toBeTruthy();
    expect(screen.queryByText('Project Alpha')).toBeNull();

    fireEvent.change(input, { target: { value: '製造' } });
    expect(screen.getByText('製造管理')).toBeTruthy();
    expect(screen.getByText('製造システム')).toBeTruthy();
    expect(screen.queryByText('営業システム')).toBeNull();
  });

  it('keeps hidden selections when selecting a visible project', () => {
    const onChange = openProjectFilter(['a', 'b']);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Project C' } });
    fireEvent.click(screen.getByText('Project C'));

    expect(onChange).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('keeps All scoped to every option even while the list is searched', () => {
    const onChange = openProjectFilter();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Kanban' } });
    fireEvent.click(screen.getByText('All'));

    expect(onChange).toHaveBeenCalledWith(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('clears the query when the dropdown is closed and reopened', () => {
    openProjectFilter();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Kanban' } });
    fireEvent.click(screen.getByTitle('Project'));
    fireEvent.click(screen.getByTitle('Project'));

    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Project Alpha')).toBeTruthy();
  });

  it('shows a localized empty-result message', () => {
    openProjectFilter();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing' } });

    expect(screen.getByText('No matching projects')).toBeTruthy();
  });

  it('clears the search query with the x button', () => {
    openProjectFilter();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Kanban' } });

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Project' })).getByRole('button', { name: 'Project' }));

    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Project Alpha')).toBeTruthy();
  });

  it('does not add a search field when searchable is omitted', () => {
    render(
      <ToolbarMultiSelect
        label="Assignee"
        icon="person"
        options={options}
        value={[]}
        onChange={vi.fn()}
        labels={labels}
      />,
    );
    fireEvent.click(screen.getByTitle('Assignee'));

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Project Alpha')).toBeTruthy();
  });
});
