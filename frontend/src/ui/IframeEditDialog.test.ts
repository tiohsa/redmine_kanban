// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hasRedmineFormError, isIssueShowUrl, shouldTreatEditLoadAsSuccess } from './IframeEditDialog';

function createDoc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('IframeEditDialog edit success detection', () => {
  it('treats issue show URL as success when no error elements exist', () => {
    const doc = createDoc('<html><body><div id="content">ok</div></body></html>');
    expect(isIssueShowUrl('/issues/123')).toBe(true);
    expect(shouldTreatEditLoadAsSuccess('/issues/123', doc)).toBe(true);
  });

  it('does not treat edit URL as success', () => {
    const doc = createDoc('<html><body></body></html>');
    expect(isIssueShowUrl('/issues/123/edit')).toBe(false);
    expect(shouldTreatEditLoadAsSuccess('/issues/123/edit', doc)).toBe(false);
  });

  it('does not treat show URL as success when errorExplanation exists', () => {
    const doc = createDoc('<html><body><div id="errorExplanation">error</div></body></html>');
    expect(hasRedmineFormError(doc)).toBe(true);
    expect(shouldTreatEditLoadAsSuccess('/issues/123', doc)).toBe(false);
  });

  it('does not treat show URL as success when flash error exists', () => {
    const doc = createDoc('<html><body><div class="flash error">error</div></body></html>');
    expect(hasRedmineFormError(doc)).toBe(true);
    expect(shouldTreatEditLoadAsSuccess('/issues/123', doc)).toBe(false);
  });
});
