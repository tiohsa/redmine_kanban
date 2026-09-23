import { useEffect, useRef, useState } from 'react';
import { useDropdownDismiss } from './useDropdownDismiss';

function triggerClass(showLabel: boolean | undefined, open: boolean, active: boolean) {
  return `rk-dropdown-trigger ${showLabel ? 'rk-dropdown-trigger-labeled' : ''} ${open ? 'rk-active' : ''} ${active ? 'rk-active-soft' : ''}`;
}

export function SearchPopover({
  label,
  title,
  placeholder,
  value,
  onChange,
  showTriggerLabel,
}: {
  label: string;
  title: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  showTriggerLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, menuRef, menuId } = useDropdownDismiss(open, () => setOpen(false), () => onChange(''));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onChange, open]);

  return (
    <div className="rk-dropdown-container">
      <button type="button"
        ref={triggerRef} aria-label={label} aria-expanded={open} aria-controls={open ? menuId : undefined} aria-haspopup="dialog"
        className={triggerClass(showTriggerLabel, open, Boolean(value))}
        onClick={() => setOpen(!open)}
        title={label}
      >
        <span className="rk-icon">filter_list</span>
        {showTriggerLabel ? <span>{label}</span> : null}
        {value ? <span className="rk-indicator-dot" /> : null}
      </button>
      {open ? (
        <div id={menuId} ref={menuRef} role="dialog" aria-label={label} className="rk-dropdown-menu" style={{ width: '300px' }}>
          <div className="rk-dropdown-title">{title}</div>
          <div style={{ padding: '12px' }}>
            <div className="rk-search-box">
              <span className="rk-icon">search</span>
              <input
                ref={inputRef}
                autoFocus
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
              />
              {value ? (
                <button
                  type="button"
                  className="rk-search-clear"
                  aria-label={label}
                  onClick={() => {
                    onChange('');
                    inputRef.current?.focus();
                  }}
                >
                  <span className="rk-icon">close</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
