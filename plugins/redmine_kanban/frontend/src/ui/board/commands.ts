export type BoardCommand = {
  type: 'move_issue';
  issueId: number;
  statusId: number;
  laneId: string | number;
  assignedToId: number | null;
};
