import React, { useEffect, useRef, useState } from 'react';

export function PriorityPopup({
  x,
  y,
  value,
  options,
  onClose,
  onChange,
}: {
  x: number;
  y: number;
  value: string;
  options: { id: string; name: string }[];
  onClose: () => void;
  onChange: (val: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 1000,
        background: 'white',
        borderRadius: '6px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        border: '1px solid #e2e8f0',
        minWidth: '160px',
        padding: '4px 0',
      }}
    >
      {options.map((option) => {
        const checked = option.id === value;
        return (
          <div
            key={option.id}
            className={`rk-dropdown-item ${checked ? 'selected' : ''}`}
            onClick={() => onChange(option.id)}
          >
            <div className="rk-dropdown-checkbox" />
            <span>{option.name}</span>
          </div>
        );
      })}
    </div>
  );
}

export function DatePopup({
  x,
  y,
  value,
  onClose,
  onCommit,
}: {
  x: number;
  y: number;
  value: string | null;
  onClose: () => void;
  onCommit: (val: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingValue, setPendingValue] = useState<string | null>(value);
  const [hasChange, setHasChange] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      if (inputRef.current && typeof inputRef.current.showPicker === 'function') {
        try {
          inputRef.current.showPicker();
        } catch {
          // ignore
        }
      }
    }, 10);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <input
      ref={inputRef}
      type="date"
      defaultValue={value || ''}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        opacity: 0,
        width: '1px',
        height: '1px',
        border: 'none',
        padding: 0,
        margin: 0,
        zIndex: 2000,
      }}
      onBlur={() => {
        if (hasChange) onCommit(pendingValue ?? null);
        setTimeout(onClose, 0);
      }}
      onChange={(event) => {
        setPendingValue(event.target.value || null);
        setHasChange(true);
      }}
    />
  );
}
