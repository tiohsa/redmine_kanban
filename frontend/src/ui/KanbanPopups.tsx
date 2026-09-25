import React, { useCallback, useEffect, useRef } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { format as formatMonthName } from 'date-fns';
import { enUS, ja } from 'date-fns/locale';

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

function formatPopupDate(date: Date): string {
  return String(date.getFullYear()).padStart(4, '0') + '-'
    + String(date.getMonth() + 1).padStart(2, '0') + '-'
    + String(date.getDate()).padStart(2, '0');
}

export function DatePopup({
  x,
  y,
  value,
  labels,
  onClose,
  onCommit,
  restoreFocusTo,
}: {
  x: number;
  y: number;
  value: string | null;
  labels: Record<string, string>;
  onClose: () => void;
  onCommit: (val: string | null) => void;
  restoreFocusTo?: HTMLElement | null;
}) {
  const hasCommitted = useRef(false);
  const hasClosed = useRef(false);
  const focusTarget = useRef(restoreFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const [year, month, day] = value?.split('-').map(Number) ?? [];
  const selected = year && month && day ? new Date(year, month - 1, day) : null;
  const language = (document.documentElement.lang || navigator.language).toLowerCase();
  const locale = language.startsWith('ja') ? ja : enUS;
  const yearMonthOrder = language.startsWith('ja') ? 'year-month' : 'month-year';
  const currentYear = new Date().getFullYear();
  const selectableYears = Array.from({ length: 41 }, (_, index) => currentYear - 20 + index);
  if (year && !selectableYears.includes(year)) selectableYears.push(year);
  selectableYears.sort((a, b) => a - b);
  const monthOptions = Array.from({ length: 12 }, (_, index) => ({
    value: index,
    label: formatMonthName(new Date(2000, index, 1), 'LLLL', { locale }),
  }));

  const close = useCallback(() => {
    if (hasClosed.current) return;
    hasClosed.current = true;
    onClose();
    window.setTimeout(() => {
      const target = focusTarget.current;
      const active = document.activeElement;
      const calendar = document.querySelector('.rk-minimax-datepicker');
      if (target?.isConnected && target !== document.body
        && (!active || active === document.body || active === document.documentElement || (calendar?.contains(active) ?? false))) {
        target.focus({ preventScroll: true });
      }
    }, 0);
  }, [onClose]);

  useEffect(() => {
    const focusCalendar = () => {
      const calendar = document.querySelector<HTMLElement>('#redmine-kanban-datepicker-portal .rk-minimax-datepicker');
      const focusable = calendar?.querySelector<HTMLElement>('.react-datepicker__day--selected:not(.react-datepicker__day--outside-month)')
        ?? calendar?.querySelector<HTMLElement>('.react-datepicker__day--keyboard-selected:not(.react-datepicker__day--outside-month)')
        ?? calendar?.querySelector<HTMLElement>('.rk-minimax-datepicker-select--year');
      focusable?.focus({ preventScroll: true });
    };
    const timer = window.setTimeout(focusCalendar, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [close]);

  const commitAndClose = (nextValue: string | null) => {
    if (hasCommitted.current) return;
    hasCommitted.current = true;
    if (nextValue !== value) onCommit(nextValue);
    close();
  };

  return (
    <div
      className="rk-date-popup-anchor"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - 8)),
      }}
    >
      <DatePicker
        selected={selected}
        onChange={(date: Date | null) => commitAndClose(date ? formatPopupDate(date) : null)}
        onClickOutside={close}
        startOpen
        portalId="redmine-kanban-datepicker-portal"
        popperClassName="rk-datepicker-popper"
        popperPlacement={x > window.innerWidth / 2 ? 'bottom-end' : 'bottom-start'}
        calendarClassName={'rk-minimax-datepicker rk-minimax-datepicker--' + yearMonthOrder}
        showPopperArrow={false}
        locale={locale}
        dateFormat="yyyy-MM-dd"
        customInput={<button type="button" className="rk-date-popup-trigger" aria-label={labels.issue_due_date} tabIndex={-1} />}
        renderCustomHeader={({
          date,
          decreaseMonth,
          increaseMonth,
          changeYear,
          changeMonth,
          prevMonthButtonDisabled,
          nextMonthButtonDisabled,
        }) => {
          const selectedYear = date.getFullYear();
          const years = selectableYears.includes(selectedYear)
            ? selectableYears
            : [...selectableYears, selectedYear].sort((a, b) => a - b);
          const yearSelect = (
            <select
              className="rk-minimax-datepicker-select rk-minimax-datepicker-select--year"
              aria-label={labels.calendar_year}
              value={selectedYear}
              onChange={(event) => changeYear(Number(event.target.value))}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {years.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          );
          const monthSelect = (
            <select
              className="rk-minimax-datepicker-select rk-minimax-datepicker-select--month"
              aria-label={labels.calendar_month}
              value={date.getMonth()}
              onChange={(event) => changeMonth(Number(event.target.value))}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {monthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          );

          return (
            <div className="rk-minimax-datepicker-custom-header" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="rk-minimax-datepicker-nav-btn"
                aria-label={labels.calendar_previous_month}
                disabled={prevMonthButtonDisabled}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  decreaseMonth();
                }}
              >‹</button>
              <div className="rk-minimax-datepicker-header-dropdowns">
                {yearMonthOrder === 'year-month' ? yearSelect : monthSelect}
                {yearMonthOrder === 'year-month' ? monthSelect : yearSelect}
              </div>
              <button
                type="button"
                className="rk-minimax-datepicker-nav-btn"
                aria-label={labels.calendar_next_month}
                disabled={nextMonthButtonDisabled}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  increaseMonth();
                }}
              >›</button>
            </div>
          );
        }}
      >
        <div className="rk-minimax-datepicker-footer" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="rk-minimax-datepicker-btn"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              commitAndClose(formatPopupDate(new Date()));
            }}
          >{labels.calendar_today}</button>
          <button
            type="button"
            className="rk-minimax-datepicker-btn rk-minimax-datepicker-btn--clear"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              commitAndClose(null);
            }}
          >{labels.calendar_clear}</button>
        </div>
      </DatePicker>
    </div>
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
