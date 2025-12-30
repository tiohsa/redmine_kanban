import { describe, it, expect } from 'vitest';
import { extractIssueIdFromUrl } from './url';

describe('extractIssueIdFromUrl', () => {
  it('should extract ID from standard issue URL', () => {
    expect(extractIssueIdFromUrl('http://example.com/issues/12345')).toBe(12345);
    expect(extractIssueIdFromUrl('/issues/12345')).toBe(12345);
  });

  it('should return null if not an issue URL', () => {
    expect(extractIssueIdFromUrl('http://example.com/projects/1')).toBeNull();
    expect(extractIssueIdFromUrl('/issues/new')).toBeNull();
  });

  it('should handle URL with query params', () => {
    expect(extractIssueIdFromUrl('/issues/12345?tab=history')).toBe(12345);
  });
});
