export const MAX_DIALOG_VIEWPORT_HEIGHT_RATIO = 0.9;
export const MIN_DIALOG_HEIGHT_PX = 320;

export function getElementOuterHeight(element: HTMLElement | null): number {
  return element ? Math.ceil(element.getBoundingClientRect().height) : 0;
}

export function getDocumentScrollHeight(element: HTMLElement): number {
  return Math.max(
    element.scrollHeight,
    element.clientHeight,
    element.offsetHeight,
    Math.ceil(element.getBoundingClientRect().height),
  );
}

export function getDialogContentHeight(doc: Document): number {
  const candidates = [
    doc.querySelector<HTMLElement>('#content'),
    doc.querySelector<HTMLElement>('#main'),
    doc.body,
    doc.documentElement,
  ];
  for (const element of candidates) {
    if (!element) continue;
    const height = getDocumentScrollHeight(element);
    if (height > 0) return height;
  }
  return 0;
}

export function calculateDialogHeight(
  viewportHeight: number,
  iframeContentHeight: number,
  chromeElements: Array<HTMLElement | null>,
): number {
  const maxHeight = Math.floor(viewportHeight * MAX_DIALOG_VIEWPORT_HEIGHT_RATIO);
  const chromeHeight = chromeElements.reduce((sum, element) => sum + getElementOuterHeight(element), 0);
  return Math.min(maxHeight, Math.max(MIN_DIALOG_HEIGHT_PX, chromeHeight + iframeContentHeight));
}
