import { BoardState } from './model';

export type CommandType =
  | 'MOVE_CARD'
  | 'UPDATE_CARD'
  | 'RELOAD_BOARD';

export interface BaseCommand {
  type: CommandType;
  timestamp: number;
}

export interface MoveCardCommand extends BaseCommand {
  type: 'MOVE_CARD';
  payload: {
    cardId: number;
    fromColumnId: number;
    fromLaneId: string | number;
    toColumnId: number;
    toLaneId: string | number;
    newIndex: number;
  };
}

export interface UpdateCardCommand extends BaseCommand {
  type: 'UPDATE_CARD';
  payload: {
    cardId: number;
    changes: Partial<any>; // Should be Partial<Issue> technically
  };
}

export interface ReloadBoardCommand extends BaseCommand {
  type: 'RELOAD_BOARD';
  payload: {
    data: any; // Raw API response
  };
}

export type BoardCommand = MoveCardCommand | UpdateCardCommand | ReloadBoardCommand;

// Result of a command execution (New State)
export type CommandResult = {
  success: boolean;
  newState?: BoardState;
  error?: string;
};
