export function extractIssueIdFromUrl(url: string): number | null {
  // Matches /issues/12345 or full URL
  const match = url.match(/\/issues\/(\d+)(?:\?|$|\/)/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return null;
}
