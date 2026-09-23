export type Filters = {
  assigneeIds: string[];
  q: string;
  due: 'all' | 'overdue' | 'thisweek' | '3days' | '7days' | '1day' | 'custom' | 'none';
  dueDays?: number;
  priority: string[];
  priorityFilterEnabled: boolean;
  projectIds: number[];
  statusIds: number[];
  trackerIds: number[];
};

export type LaneType = 'none' | 'assignee' | 'priority' | 'category';
export type FitMode = 'none' | 'width';
export type CardDisplayMode = 'standard' | 'single_line';
export type SortField = 'due' | 'priority' | 'updated';
export type SortDirection = 'asc' | 'desc';
export type SortCriterion = { field: SortField; direction: SortDirection };
export type SortConfig = SortCriterion[];
