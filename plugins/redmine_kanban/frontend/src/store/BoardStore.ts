import { BoardState, Card } from '../domain/model';
import { BoardCommand, MoveCardCommand } from '../domain/commands';
import { BoardData, Issue } from '../ui/types';
import { postJson } from '../ui/http';

type Listener = (state: BoardState) => void;

export class BoardStore {
  private state: BoardState;
  private listeners: Set<Listener> = new Set();
  private baseUrl: string = ''; // Set via init or ctor

  // Initial empty state
  private static readonly INITIAL_STATE: BoardState = {
    entities: { cards: {}, columns: {}, lanes: {} },
    structure: { columnIds: [], laneIds: [], board: {} },
    meta: {
      project_id: 0, current_user_id: 0, can_move: false, can_create: false, can_delete: false,
      lane_type: 'none', wip_limit_mode: 'column', wip_exceed_behavior: 'warn',
      aging_warn_days: 0, aging_danger_days: 0, aging_exclude_closed: false
    },
    lists: { assignees: [], trackers: [], priorities: [] },
    version: 0,
    lastSyncTime: 0
  };

  constructor(initialData?: BoardData, baseUrl: string = '/redmine_kanban') {
    this.baseUrl = baseUrl;
    if (initialData) {
      this.state = this.normalize(initialData);
    } else {
      this.state = BoardStore.INITIAL_STATE;
    }
  }

  public getState(): BoardState {
    return this.state;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(l => l(this.state));
  }

  public async execute(command: BoardCommand) {
    // 1. Validate (optional)
    // 2. Apply (Optimistic)
    const prevState = this.state;
    let newState = this.state;

    switch (command.type) {
      case 'MOVE_CARD':
        newState = this.applyMoveCard(this.state, command.payload);
        break;
      case 'UPDATE_CARD':
        newState = this.applyUpdateCard(this.state, command.payload);
        break;
      case 'RELOAD_BOARD':
        newState = this.normalize(command.payload.data);
        break;
    }

    if (newState !== this.state) {
      this.state = newState;
      this.notify();

      // 3. Side Effects (Persistence)
      try {
        await this.persist(command, prevState, newState);
      } catch (e) {
        console.error("Persistence failed, rolling back", e);
        // Rollback
        this.state = prevState;
        this.notify();
      }
    }
  }

  private async persist(command: BoardCommand, prevState: BoardState, newState: BoardState) {
     // TODO: Implement actual API calls based on command type
     switch (command.type) {
       case 'MOVE_CARD': {
         const { cardId, toColumnId, toLaneId } = (command as MoveCardCommand).payload;
         // Note: toLaneId might be 'none' or string if not mapped correctly, but API expects number/null
         // We need to resolve toLaneId to assigned_to_id if lane_type is assignee
         let assignedToId: number | null = null;
         if (this.state.meta.lane_type === 'assignee') {
           if (toLaneId === 'unassigned' || toLaneId === 'none') assignedToId = null;
           else assignedToId = Number(toLaneId);
         } else {
           // Keep existing assigned_to_id ? Or is this strictly status move?
           // Usually board move preserves assignee if swimlane isn't changing assignee
           const card = newState.entities.cards[cardId];
           assignedToId = card.assigned_to_id;
         }

         await postJson<{ ok: boolean }>(
           `${this.baseUrl}/issues/${cardId}/move`,
           { status_id: toColumnId, assigned_to_id: assignedToId },
           'PATCH'
         );
         break;
       }
       case 'UPDATE_CARD': {
         const { cardId, changes } = command.payload;
         await postJson(
           `${this.baseUrl}/issues/${cardId}`,
           changes,
           'PATCH'
         );
         break;
       }
     }
  }

  // --- Reducers / Appliers ---

  private applyUpdateCard(state: BoardState, payload: any): BoardState {
    const { cardId, changes } = payload;
    const currentCard = state.entities.cards[cardId];
    if (!currentCard) return state;

    const updatedCard = { ...currentCard, ...changes };
    const newEntities = {
      ...state.entities,
      cards: { ...state.entities.cards, [cardId]: updatedCard }
    };

    // Note: If Status or Assignee changed, we might need to move it in the board structure too.
    // For now assuming simplistic in-place update for text fields.
    // If status_id changed, RE-NORMALIZATION or MOVE logic is needed.
    // Simplifying: If critical fields change, we might want to trigger a Reload or simulate Move.

    return {
      ...state,
      entities: newEntities,
      version: state.version + 1
    };
  }

  private applyMoveCard(state: BoardState, payload: any): BoardState {
    const { cardId, fromColumnId, fromLaneId, toColumnId, toLaneId, newIndex } = payload;

    // Deep clone structure to mutate
    const newStructure = { ...state.structure, board: { ...state.structure.board } };

    const sourceKey = `${fromColumnId}:${fromLaneId}`;
    const targetKey = `${toColumnId}:${toLaneId}`;

    const sourceList = [...(newStructure.board[sourceKey] || [])];
    const targetList = sourceKey === targetKey ? sourceList : [...(newStructure.board[targetKey] || [])];

    // Remove from source
    const currentIdx = sourceList.indexOf(cardId);
    if (currentIdx === -1) return state; // Error: Card not found in source

    sourceList.splice(currentIdx, 1);

    // Insert into target
    targetList.splice(newIndex, 0, cardId);

    newStructure.board[sourceKey] = sourceList;
    if (sourceKey !== targetKey) {
      newStructure.board[targetKey] = targetList;
    }

    // Update Card status/assignment if needed
    // Note: This is "Optimistic UI". The Persistence layer will sync this to server.
    const newEntities = { ...state.entities, cards: { ...state.entities.cards } };
    const card = newEntities.cards[cardId];
    if (card) {
       newEntities.cards[cardId] = {
         ...card,
         status_id: toColumnId,
         // Update assignee if lane_type is assignee
         // This logic depends on meta
         assigned_to_id: (state.meta.lane_type === 'assignee' && typeof toLaneId === 'number')
           ? toLaneId
           : card.assigned_to_id
       };
    }

    return {
      ...state,
      structure: newStructure,
      entities: newEntities,
      version: state.version + 1
    };
  }

  // --- Normalization ---

  private normalize(data: BoardData): BoardState {
    const cards: Record<number, Card> = {};
    const columns: Record<number, any> = {};
    const lanes: Record<string|number, any> = {};
    const board: Record<string, number[]> = {};

    data.issues.forEach((issue) => {
      cards[issue.id] = { ...issue };
    });

    data.columns.forEach(col => {
      columns[col.id] = col;
    });

    data.lanes.forEach(lane => {
      lanes[lane.id] = lane;
    });

    // Initialize board lists
    data.columns.forEach(col => {
      data.lanes.forEach(lane => {
        const key = `${col.id}:${lane.id}`;
        board[key] = [];
      });
    });

    // Place cards
    data.issues.forEach(issue => {
      // Determine Lane ID
      let laneId: string | number = 'none';
      if (data.meta.lane_type === 'assignee') {
        laneId = issue.assigned_to_id || 'unassigned';
        // Note: Backend likely handles null as a specific ID or 'none' lane.
        // We need to match data.lanes IDs.
        // Assuming data.lanes includes a lane for 'unassigned' or similar if applicable.
        // For now, let's find the matching lane.
        const matchingLane = data.lanes.find(l => l.id == issue.assigned_to_id);
        if (matchingLane) laneId = matchingLane.id;
        else {
           // Fallback or specific logic needed.
           // If issue.assigned_to_id is null, it usually goes to a specific lane.
           // Let's assume the API returns lanes that cover all issues.
           // If 'none' mode, usually laneId is just 'none' or 0.
           // Note: TypeScript thinks 'assignee' comparison above means it can't be 'none' here
           // but data.meta comes from API so we should be safe or cast.
           if ((data.meta.lane_type as string) === 'none') laneId = data.lanes[0]?.id || 0;
        }
      } else {
        laneId = data.lanes[0]?.id || 0;
      }

      const key = `${issue.status_id}:${laneId}`;
      if (!board[key]) board[key] = [];
      board[key].push(issue.id);
    });

    // Ensure order in board lists if the API returns them ordered,
    // but the API returns a flat list of issues.
    // So we effectively just appended them.
    // If there is a specific order (e.g. priority), we might want to sort here.
    // Preserving the API order (which is usually sorted) is best.

    return {
      entities: { cards, columns, lanes },
      structure: {
        columnIds: data.columns.map(c => c.id),
        laneIds: data.lanes.map(l => l.id),
        board
      },
      meta: data.meta,
      lists: data.lists,
      version: 1,
      lastSyncTime: Date.now()
    };
  }
}
