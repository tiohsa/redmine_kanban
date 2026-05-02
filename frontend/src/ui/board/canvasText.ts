export function truncateTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const lines: string[] = [];
  const chars = Array.from(text);
  let currentLine = '';

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const test = currentLine + char;
    const w = ctx.measureText(test).width;

    if (w > maxWidth) {
      if (currentLine) lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = test;
    }
  }
  if (currentLine) lines.push(currentLine);

  if (lines.length <= maxLines) return lines;

  const result = lines.slice(0, maxLines - 1);
  const lastLineCandidate = lines[maxLines - 1];
  let lastLine = lastLineCandidate;
  while (lastLine.length > 0 && ctx.measureText(lastLine + '...').width > maxWidth) {
    lastLine = lastLine.slice(0, -1);
  }
  result.push(lastLine + '...');

  return result;
}

export function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '...').width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '...';
}
