import { describe, expect, it } from 'vitest';
import { buildBoardDataUrl } from './boardQuery';

describe('snapshot toolbar contract', () => {
  it('uses the configured maximum as the only board admission control', () => {
    expect(buildBoardDataUrl('/projects/demo/kanban', [], [], [], 1500)).toContain('board_entity_limit=1500');
  });
});
