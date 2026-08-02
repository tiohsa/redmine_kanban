export type CardMetadataSegment = {
  text: string;
  x: number;
  width: number;
};

export type CardMetadataLayout = {
  id: CardMetadataSegment;
  tracker?: CardMetadataSegment;
  assignee?: CardMetadataSegment;
  assigneeIconX?: number;
};

type CardMetadataOptions = {
  contentX: number;
  rightX: number;
  idText: string;
  trackerName?: string | null;
  assigneeName?: string | null;
};

const metadataGap = 12;
const assigneeIconWidth = 14;
const assigneeIconGap = 2;
const trackerMaxWidth = 90;
const assigneeMaxWidth = 80;

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text || maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;

  const ellipsis = '...';
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(`${chars.join('')}${ellipsis}`).width > maxWidth) chars.pop();
  if (ctx.measureText(`${chars.join('')}${ellipsis}`).width <= maxWidth) return `${chars.join('')}${ellipsis}`;
  if (ctx.measureText(chars[0] ?? '').width <= maxWidth) return chars[0] ?? '';
  return ctx.measureText(ellipsis).width <= maxWidth ? ellipsis : '';
}

export function layoutCardMetadata(
  ctx: CanvasRenderingContext2D,
  { contentX, rightX, idText, trackerName, assigneeName }: CardMetadataOptions,
): CardMetadataLayout {
  const id: CardMetadataSegment = { text: idText, x: contentX, width: ctx.measureText(idText).width };
  let cursor = id.x + id.width + metadataGap;
  const hasAssignee = Boolean(assigneeName);
  const assigneeMinimumTextWidth = hasAssignee ? Math.min(24, ctx.measureText(Array.from(assigneeName!)[0] ?? '').width) : 0;
  const assigneeReserve = hasAssignee
    ? assigneeIconWidth + assigneeIconGap + assigneeMinimumTextWidth + metadataGap
    : 0;

  let tracker: CardMetadataSegment | undefined;
  if (trackerName) {
    const availableTrackerWidth = Math.min(trackerMaxWidth, Math.max(0, rightX - cursor - assigneeReserve));
    const text = fitText(ctx, trackerName, availableTrackerWidth);
    if (text) {
      tracker = { text, x: cursor, width: ctx.measureText(text).width };
      cursor = tracker.x + tracker.width + metadataGap;
    }
  }

  let assignee: CardMetadataSegment | undefined;
  let assigneeIconX: number | undefined;
  if (hasAssignee) {
    assigneeIconX = cursor;
    const assigneeX = assigneeIconX + assigneeIconWidth + assigneeIconGap;
    const availableAssigneeWidth = Math.min(assigneeMaxWidth, Math.max(0, rightX - assigneeX));
    const text = fitText(ctx, assigneeName!, availableAssigneeWidth);
    if (text) assignee = { text, x: assigneeX, width: ctx.measureText(text).width };
  }

  return { id, tracker, assignee, assigneeIconX };
}
