import { createTimeEntryOperation, type TimeEntryOperation } from './iframe/timeEntryOperation';
import { useBoardActions, type BoardActionArgs } from '../application/board/useBoardActions';

type Args = Omit<BoardActionArgs, 'onOpenTimeEntry'> & {
  setIframeTimeEntryOperation: (value: TimeEntryOperation | null) => void;
};

export function useKanbanActions({ setIframeTimeEntryOperation, ...args }: Args) {
  return useBoardActions({
    ...args,
    onOpenTimeEntry: (issueId) => {
      const instanceKey = args.baseUrl.replace(/\/projects\/[^/]+\/kanban\/?$/, '');
      setIframeTimeEntryOperation(createTimeEntryOperation(instanceKey, issueId));
    },
  });
}
