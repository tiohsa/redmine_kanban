export function buildWorkTimerTimeEntryUrl(
  instanceKey: string,
  issueId: number | string,
  hours: string,
): string {
  const issueUrl = `${instanceKey.replace(/\/$/, '')}/issues/${encodeURIComponent(String(issueId))}`;
  const params = new URLSearchParams({
    'time_entry[hours]': hours,
    back_url: issueUrl,
  });
  return `${issueUrl}/time_entries/new?${params.toString()}`;
}
