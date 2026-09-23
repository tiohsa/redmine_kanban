import { useEffect, useId, useRef } from 'react';

export function useDropdownDismiss(open: boolean, onDismiss: () => void, onEscape?: () => void) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) onDismiss();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onEscape?.();
      onDismiss();
      triggerRef.current?.focus();
    };
    const handleFocus = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && !triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) onDismiss();
    };
    document.addEventListener('focusin', handleFocus);
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [onDismiss, onEscape, open]);

  return { triggerRef, menuRef, menuId };
}
