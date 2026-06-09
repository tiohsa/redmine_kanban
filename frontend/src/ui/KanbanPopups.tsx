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

  useEffect(() => {
    const handleScroll = () => {
      onClose();
    };
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('wheel', handleScroll, true);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('wheel', handleScroll, true);
    };
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

  // Get today's date in YYYY-MM-DD format
  const getTodayStr = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  // State to hold the temporary selection during calendar navigation
  const [currentValue, setCurrentValue] = useState<string>(value || '');

  // Keep track of the baseline date at mount. If none provided, use today.
  const initialValueRef = useRef<string>(value || getTodayStr());

  // Prevent multiple commits
  const hasCommitted = useRef(false);

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

  const commitAndClose = (val: string | null) => {
    if (hasCommitted.current) return;
    hasCommitted.current = true;
    onCommit(val);
    onClose();
  };

  // Check if the change event corresponds to a real day selection rather than month/year navigation
  const isRealDaySelection = (oldValStr: string, newValStr: string) => {
    const oldParts = oldValStr.split('-');
    const newParts = newValStr.split('-');
    if (oldParts.length !== 3 || newParts.length !== 3) return true;

    const oldDay = parseInt(oldParts[2], 10);

    const newYear = parseInt(newParts[0], 10);
    const newMonth = parseInt(newParts[1], 10);
    const newDay = parseInt(newParts[2], 10);

    // Calculate maximum days in the new month
    const maxDayInNewMonth = new Date(newYear, newMonth, 0).getDate();

    // Check if the day was auto-clipped to the end of the new month (e.g. May 31 -> June 30)
    const isClipped = oldDay > maxDayInNewMonth && newDay === maxDayInNewMonth;

    if (isClipped) {
      return false; // Month changed, day was just clipped. Not a real day click.
    }

    return oldDay !== newDay;
  };

  return (
    <input
      ref={inputRef}
      type="date"
      value={currentValue}
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
        // Commit and close after picker UI is dismissed
        setTimeout(() => {
          commitAndClose(currentValue || null);
        }, 150);
      }}
      onChange={(event) => {
        const newValue = event.target.value;
        setCurrentValue(newValue);

        if (newValue && isRealDaySelection(initialValueRef.current, newValue)) {
          // Commit and close immediately when a new day is explicitly selected
          commitAndClose(newValue);
        }
      }}
    />
  );
}

export function ProgressPopup({
  x,
  y,
  value,
  onClose,
  onChange,
}: {
  x: number;
  y: number;
  value: number;
  onClose: () => void;
  onChange: (val: number) => void;
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

  useEffect(() => {
    const handleScroll = () => {
      onClose();
    };
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('wheel', handleScroll, true);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('wheel', handleScroll, true);
    };
  }, [onClose]);

  const options = Array.from({ length: 11 }, (_, i) => i * 10); // 0, 10, ..., 100

  // Calculate show direction based on viewport to avoid screen overflow using pure CSS transform
  const showUpward = y > window.innerHeight / 2;
  const showLeftward = x > window.innerWidth - 120;

  const transformStyle = [
    showLeftward ? 'translateX(-100%)' : 'translateX(0)',
    showUpward ? 'translateY(-100%)' : 'translateY(0)',
  ].join(' ');

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        transform: transformStyle,
        zIndex: 1000,
        background: 'white',
        borderRadius: '6px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        border: '1px solid #e2e8f0',
        minWidth: '100px',
        padding: '4px 0',
      }}
    >
      {options.map((option) => {
        const checked = option === value;
        return (
          <div
            key={option}
            className={`rk-dropdown-item ${checked ? 'selected' : ''}`}
            onClick={() => onChange(option)}
          >
            <div className="rk-dropdown-checkbox" />
            <span>{option}%</span>
          </div>
        );
      })}
    </div>
  );
}
