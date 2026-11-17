import { useEffect } from "react";

export function useManagedEffect(
  effect: () => void | (() => void),
  deps: ReadonlyArray<unknown>,
): void {
  useEffect(() => {
    return effect();
  }, deps);
}
