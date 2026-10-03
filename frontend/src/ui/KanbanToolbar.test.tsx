import { describe, expect, it } from 'vitest';
import { buildBoardDataUrl } from './boardQuery';

describe('snapshot admission URL', () => {
  it('does not send a user configured entity limit', () => {
    expect(buildBoardDataUrl('/projects/demo/kanban', [], [], [])).not.toContain('board_entity_limit');
  });
});
