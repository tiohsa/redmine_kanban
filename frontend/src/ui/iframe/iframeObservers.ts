type ObserverWindow = Window & {
  ResizeObserver?: typeof ResizeObserver;
  MutationObserver?: typeof MutationObserver;
};

export function observeIframeDocument(
  doc: Document,
  iframeWindow: ObserverWindow | null,
  onResize: () => void,
  onMutation: () => void,
): () => void {
  const cleanups: Array<() => void> = [];
  const resizeObserverCtor = iframeWindow?.ResizeObserver ?? window.ResizeObserver;
  const mutationObserverCtor = iframeWindow?.MutationObserver ?? window.MutationObserver;

  if (typeof resizeObserverCtor !== 'undefined') {
    const observer = new resizeObserverCtor(onResize);
    [
      doc.querySelector<HTMLElement>('#content'),
      doc.querySelector<HTMLElement>('#main'),
      doc.body,
      doc.documentElement,
    ]
      .filter((element): element is HTMLElement => Boolean(element))
      .forEach((element) => observer.observe(element));
    cleanups.push(() => observer.disconnect());
  }

  if (typeof mutationObserverCtor !== 'undefined' && doc.body) {
    const observer = new mutationObserverCtor(onMutation);
    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    cleanups.push(() => observer.disconnect());
  }

  return () => cleanups.forEach((cleanup) => cleanup());
}

export function observeDialogChrome(
  elements: Array<HTMLElement | null>,
  onResize: () => void,
): () => void {
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
  elements
    .filter((element): element is HTMLElement => Boolean(element))
    .forEach((element) => observer?.observe(element));
  window.addEventListener('resize', onResize);

  return () => {
    window.removeEventListener('resize', onResize);
    observer?.disconnect();
  };
}
