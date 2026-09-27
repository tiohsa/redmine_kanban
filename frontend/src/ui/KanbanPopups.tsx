import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { format as formatMonthName } from 'date-fns';
import { enUS, ja } from 'date-fns/locale';

const FOCUS_RESTORE_DEADLINE_MS = 5_000;
let cancelPendingFocusRestore: (() => void) | undefined;

function isDetached(element: HTMLElement | null): boolean {
  return !element?.isConnected;
}

function focusRootFor(target: HTMLElement): HTMLElement {
  return target.closest<HTMLElement>('#redmine-kanban-root')
    ?? target.closest<HTMLElement>('.rk-canvas-board')
    ?? target.parentElement
    ?? document.documentElement;
}

function useChoicePopup(onClose: () => void, restoreFocusTo?: HTMLElement | null) {
  const menuRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef(restoreFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const focusRoot = useRef<HTMLElement | null>(null);
  if (!focusRoot.current && focusTarget.current) focusRoot.current = focusRootFor(focusTarget.current);
  const closed = useRef(false);

  useLayoutEffect(() => {
    // A newly opened choice popup owns focus and supersedes any older request.
    cancelPendingFocusRestore?.();
  }, []);

  const restoreFocus = useCallback((after?: PromiseLike<unknown>) => {
    cancelPendingFocusRestore?.();
    let observer: MutationObserver | undefined;
    let animationFrame: number | undefined;
    let scheduledTimer: number | undefined;
    let finished = false;
    let semanticSettled = !after;
    const target = focusTarget.current;
    const boardRoot = focusRoot.current;

    if (!target || !boardRoot) return;

    const isPassiveFocus = (active: Element | null) => (
      !active || active === document.body || active === document.documentElement || active === target
    );
    const canFocus = (element: HTMLElement | null): element is HTMLElement => Boolean(
      element?.isConnected
      && !element.matches(':disabled')
      && element !== document.body
      && element !== document.documentElement,
    );
    const focusFallback = () => {
      const active = document.activeElement;
      if (!isPassiveFocus(active) || menuRef.current?.contains(active)) return;
      if (!boardRoot.isConnected) return;
      const fallback = boardRoot.matches('.rk-canvas')
        ? boardRoot
        : boardRoot.querySelector<HTMLElement>('.rk-canvas');
      if (!canFocus(fallback)) return;
      fallback.focus({ preventScroll: true });
    };

    const release = () => {
      if (finished) return;
      finished = true;
      observer?.disconnect();
      observer = undefined;
      window.clearTimeout(deadlineTimer);
      if (scheduledTimer !== undefined) window.clearTimeout(scheduledTimer);
      if (animationFrame !== undefined && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = undefined;
      scheduledTimer = undefined;
      document.removeEventListener('focusin', handleFocusIn);
      if (cancelPendingFocusRestore === release) cancelPendingFocusRestore = undefined;
    };

    const handleFocusIn = () => {
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement
        && active !== target && !menuRef.current?.contains(active)) release();
    };

    const tryRestore = (expired = false) => {
      if (finished) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement
        && active !== target && !menuRef.current?.contains(active)) {
        release();
        return;
      }

      // A detached/replaced board ends this request. A removed source can use a
      // fallback only inside its still-connected board, and only when focus is idle.
      if (!boardRoot.isConnected) {
        release();
        return;
      }

      if (isDetached(target)) {
        focusFallback();
        release();
        return;
      }
      if (!boardRoot.contains(target)) {
        release();
        return;
      }

      // Expiry abandons the semantic wait. It never focuses the invoking control
      // while its mutation promise is still pending.
      if (expired) {
        focusFallback();
        release();
        return;
      }
      if (!semanticSettled) return;
      if (menuRef.current?.isConnected) return;

      if (active === target) {
        release();
        return;
      }
      if (!canFocus(target)) return;

      target.focus({ preventScroll: true });
      if (document.activeElement === target) release();
    };

    const scheduleRestoreCheck = () => {
      if (finished || animationFrame !== undefined || scheduledTimer !== undefined) return;
      if (typeof window.requestAnimationFrame === 'function') {
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = undefined;
          tryRestore();
        });
      } else {
        scheduledTimer = window.setTimeout(() => {
          scheduledTimer = undefined;
          tryRestore();
        }, 0);
      }
    };

    cancelPendingFocusRestore = release;
    document.addEventListener('focusin', handleFocusIn);
    observer = new MutationObserver(scheduleRestoreCheck);
    // One subtree observation covers source disabled/removal and board child
    // changes. The parent observation detects the board root being detached.
    observer.observe(boardRoot, {
      attributes: true,
      attributeFilter: ['disabled'],
      childList: true,
      subtree: true,
    });
    const rootParent = boardRoot.parentElement;
    if (rootParent && rootParent !== boardRoot) observer.observe(rootParent, { childList: true });
    const deadlineTimer = window.setTimeout(() => tryRestore(true), FOCUS_RESTORE_DEADLINE_MS);

    if (after) {
      void Promise.resolve(after).then(() => {
        if (finished) return;
        semanticSettled = true;
        scheduleRestoreCheck();
      }, () => {
        if (finished) return;
        semanticSettled = true;
        scheduleRestoreCheck();
      });
    } else {
      scheduleRestoreCheck();
    }
  }, []);

  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onClose();
    restoreFocus();
  }, [onClose, restoreFocus]);

  useEffect(() => {
    const selected = menuRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    (selected ?? menuRef.current?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) close();
    };
    const handleScroll = () => close();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('wheel', handleScroll, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('wheel', handleScroll, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [close]);

  return { menuRef, restoreFocus, close };
}

export function PriorityPopup({
  x,
  y,
  value,
  options,
  onClose,
  onChange,
  restoreFocusTo,
  ariaLabel = 'Priority',
}: {
  x: number;
  y: number;
  value: string;
  options: { id: string; name: string }[];
  onClose: () => void;
  onChange: (val: string) => void | PromiseLike<unknown>;
  restoreFocusTo?: HTMLElement | null;
  ariaLabel?: string;
}) {
  const { menuRef, restoreFocus, close } = useChoicePopup(onClose, restoreFocusTo);
  const selected = useRef(false);
  const choose = (id: string) => {
    if (selected.current) return;
    selected.current = true;
    if (id === value) {
      close();
      return;
    }
    const completion = onChange(id);
    restoreFocus(completion || undefined);
  };

  return (
    <div
      ref={menuRef}
      role="group"
      aria-label={ariaLabel}
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
        const select = () => choose(option.id);
        return (
          <button
            type="button"
            key={option.id}
            className={`rk-dropdown-item ${checked ? 'selected' : ''}`}
            aria-pressed={checked}
            onClick={select}
          >
            <span className="rk-dropdown-checkbox" aria-hidden="true" />
            <span>{option.name}</span>
          </button>
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
  offscreen,
  value,
  labels,
  onClose,
  onCommit,
  restoreFocusTo,
}: {
  x: number;
  y: number;
  offscreen?: boolean;
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
      // A later popup may already be mounted when this timer runs.
      const calendar = document.querySelector('.rk-minimax-datepicker');
      if (!calendar && target?.isConnected && target !== document.body
        && (!active || active === document.body || active === document.documentElement)) {
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

  useEffect(() => {
    if (offscreen) close();
  }, [offscreen, close]);

  const commitAndClose = (nextValue: string | null) => {
    if (hasCommitted.current) return;
    hasCommitted.current = true;
    if (nextValue !== value) onCommit(nextValue);
    close();
  };

  // Canvas scrolling changes x/y without a native scroll event for Floating UI.
  // Updated middleware options make it recalculate the open popper's position.
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
        popperModifiers={[{ name: 'board-anchor-position', options: { x, y }, fn: () => ({}) }]}
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
  restoreFocusTo,
  ariaLabel = 'Progress',
}: {
  x: number;
  y: number;
  value: number;
  onClose: () => void;
  onChange: (val: number) => void | PromiseLike<unknown>;
  restoreFocusTo?: HTMLElement | null;
  ariaLabel?: string;
}) {
  const { menuRef, restoreFocus, close } = useChoicePopup(onClose, restoreFocusTo);
  const selected = useRef(false);
  const options = Array.from({ length: 11 }, (_, i) => i * 10);
  const showUpward = y > window.innerHeight / 2;
  const showLeftward = x > window.innerWidth - 120;
  const transformStyle = [
    showLeftward ? 'translateX(-100%)' : 'translateX(0)',
    showUpward ? 'translateY(-100%)' : 'translateY(0)',
  ].join(' ');
  const choose = (next: number) => {
    if (selected.current) return;
    selected.current = true;
    if (next === value) {
      close();
      return;
    }
    const completion = onChange(next);
    restoreFocus(completion || undefined);
  };

  return (
    <div
      ref={menuRef}
      role="group"
      aria-label={ariaLabel}
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
        const select = () => choose(option);
        return (
          <button
            type="button"
            key={option}
            className={`rk-dropdown-item ${checked ? 'selected' : ''}`}
            aria-pressed={checked}
            onClick={select}
          >
            <span className="rk-dropdown-checkbox" aria-hidden="true" />
            <span>{option}%</span>
          </button>
        );
      })}
    </div>
  );
}
