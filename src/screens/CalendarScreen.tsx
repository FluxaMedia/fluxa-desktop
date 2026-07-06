import React, { useEffect, useMemo, useState } from 'react';
import { Bell, ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';
import type { AppState, LibraryItem } from '../core/types';
import { refreshWatchlistAirDates } from '../core/libraryEffects';
import { t } from '../i18n';

const NAV_RAIL_WIDTH = 104;
const CONTENT_PAD = 42;
const AIR_DATES_REFRESH_THROTTLE_MS = 60_000;

// Module-level (not component state) so it survives CalendarScreen unmounting when you
// navigate away and remounting when you come back — without this, every revisit redid
// the air-date refresh (a loadLibrary + per-addon fetch pass) from scratch.
let lastAirDatesRefreshAt = 0;

interface Props {
  state: AppState;
  onDispatch: (actionJson: string) => void;
}

type CalendarItem = {
  id?: string;
  title?: string;
  name?: string;
  subtitle?: string;
  episodeTitle?: string;
  dateIso?: string;
  poster?: string;
  contentId?: string;
  seriesId?: string;
};

export const CalendarScreen = React.memo(function CalendarScreen({ state, onDispatch }: Props) {
  const [monthStart, setMonthStart] = useState(() => firstDayOfMonth(new Date()));
  const [showCompleted, setShowCompleted] = useState(false);
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth() + 1;

  useEffect(() => {
    const cal = state.calendar as { year?: number; month?: number; items?: unknown[] } | undefined;
    const alreadyLoaded = cal?.year === year && cal?.month === month && Array.isArray(cal?.items);
    if (alreadyLoaded) return;
    onDispatch(JSON.stringify({ type: 'calendarMonthRequested', year, month }));
    // intentionally not depending on state.calendar — only re-checking on year/month
    // change, not on every state update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  const [isRefreshingAirDates, setIsRefreshingAirDates] = useState(false);
  useEffect(() => {
    if (Date.now() - lastAirDatesRefreshAt < AIR_DATES_REFRESH_THROTTLE_MS) return;
    lastAirDatesRefreshAt = Date.now();
    let cancelled = false;
    setIsRefreshingAirDates(true);
    refreshWatchlistAirDates()
      .then(() => {
        if (!cancelled) onDispatch(JSON.stringify({ type: 'calendarMonthRequested', year, month }));
      })
      .finally(() => { if (!cancelled) setIsRefreshingAirDates(false); });
    return () => { cancelled = true; };
    // mount-only: intentionally not depending on year/month
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const calendarState = (state.calendar ?? {}) as {
    items?: CalendarItem[];
    localItems?: CalendarItem[];
    externalItems?: CalendarItem[];
  };
  const items = useMemo(
    () => [
      ...(calendarState.items ?? []),
      ...(calendarState.localItems ?? []),
      ...(calendarState.externalItems ?? []),
    ],
    [calendarState.items, calendarState.localItems, calendarState.externalItems],
  );
  const completedItems = (state.library.lastWrite?.completed ?? state.library.completed ?? []) as LibraryItem[];
  const completedIds = useMemo(() => new Set(completedItems.map((item) => item.id)), [completedItems]);
  const completedNames = useMemo(() => new Set(completedItems.map((item) => item.name.toLowerCase())), [completedItems]);
  const visibleItems = useMemo(
    () => showCompleted ? items : items.filter((item) => !isCompletedCalendarItem(item, completedIds, completedNames)),
    [items, showCompleted, completedIds, completedNames],
  );
  const itemsByDate = useMemo(() => groupItemsByDate(visibleItems), [visibleItems]);
  const cells = useMemo(() => buildMonthCells(monthStart), [monthStart]);

  return (
    <div style={styles.screen}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>{t('nav.calendar')}</p>
          <h1 style={styles.title}>{monthTitle(monthStart)}</h1>
        </div>
        <div style={styles.actions}>
          {isRefreshingAirDates && (
            <span style={styles.refreshingLabel}>{t('calendar.checking_new_episodes')}</span>
          )}
          <button
            style={{ ...styles.filterBtn, background: showCompleted ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.045)' }}
            onClick={() => setShowCompleted((v) => !v)}
            title={showCompleted ? t('calendar.hide_completed') : t('calendar.show_completed')}
          >
            {showCompleted ? <Eye size={16} /> : <EyeOff size={16} />}
            <span>{showCompleted ? t('calendar.showing_completed') : t('calendar.hiding_completed')}</span>
          </button>
          <button style={styles.navBtn} onClick={() => setMonthStart(shiftMonth(monthStart, -1))}>
            <ChevronLeft size={22} />
          </button>
          <button style={styles.navBtn} onClick={() => setMonthStart(shiftMonth(monthStart, 1))}>
            <ChevronRight size={22} />
          </button>
        </div>
      </header>

      <div style={styles.weekRow}>
        {weekdays().map((day) => (
          <div key={day} style={styles.weekday}>{day}</div>
        ))}
      </div>

      <div style={styles.grid}>
        {cells.map((cell, cellIndex) => {
          const dayItems = cell ? (itemsByDate[cell.dateIso] ?? []) : [];
          const isToday = cell?.dateIso === todayIso();
          return (
            <div
              key={cell?.dateIso ?? `blank-${cellIndex}`}
              style={{
                ...styles.day,
                opacity: cell?.isCurrentMonth ? 1 : 0.34,
                borderColor: isToday ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.08)',
              }}
            >
              {cell && (
                <div style={styles.dayHeader}>
                  <span style={styles.dayNumber}>{cell.day}</span>
                  {isToday && <span style={styles.todayPill}>{t('calendar.today')}</span>}
                </div>
              )}
              <div style={styles.dayItems}>
                {dayItems.slice(0, 3).map((item, index) => (
                  <div key={item.id ?? `${item.title}-${index}`} style={styles.event}>
                    {item.poster && <img src={item.poster} alt="" style={styles.eventPoster} />}
                    <span style={styles.eventText}>{item.title ?? item.name ?? item.subtitle}</span>
                    <EventBadge item={item} />
                  </div>
                ))}
                {dayItems.length > 3 && (
                  <span style={styles.moreEvents}>{t('calendar.more_events', dayItems.length - 3)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {visibleItems.length === 0 && (
        <div style={styles.empty}>
          <Bell size={18} />
          <span>{items.length === 0 ? t('calendar.empty') : t('calendar.empty_filtered')}</span>
        </div>
      )}
    </div>
  );
}, (prev, next) => prev.state.calendar === next.state.calendar && prev.state.library === next.state.library && prev.onDispatch === next.onDispatch);

function firstDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function shiftMonth(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function monthTitle(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function weekdays(): string[] {
  const base = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, index) =>
    new Date(base.getFullYear(), base.getMonth(), base.getDate() + index)
      .toLocaleDateString(undefined, { weekday: 'short' }),
  );
}

function buildMonthCells(monthStart: Date) {
  const first = firstDayOfMonth(monthStart);
  const leading = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - leading);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      day: date.getDate(),
      dateIso: date.toISOString().slice(0, 10),
      isCurrentMonth: date.getMonth() === monthStart.getMonth(),
    };
  });
}

function groupItemsByDate(items: CalendarItem[]): Record<string, CalendarItem[]> {
  return items.reduce<Record<string, CalendarItem[]>>((acc, item) => {
    const date = item.dateIso?.slice(0, 10);
    if (!date) return acc;
    acc[date] = [...(acc[date] ?? []), item];
    return acc;
  }, {});
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isCompletedCalendarItem(item: CalendarItem, completedIds: Set<string>, completedNames: Set<string>): boolean {
  const ids = [item.contentId, item.seriesId, item.id].filter((id): id is string => !!id);
  if (ids.some((id) => completedIds.has(id))) return true;
  if (ids.some((id) => [...completedIds].some((completedId) => id === completedId || id.startsWith(`${completedId}:`)))) return true;
  const name = (item.title ?? item.name ?? '').toLowerCase();
  return !!name && completedNames.has(name);
}

function EventBadge({ item }: { item: CalendarItem }) {
  const date = item.dateIso?.slice(0, 10);
  if (!date) return null;
  const today = todayIso();
  const label = date === today
    ? t('calendar.new_today')
    : date > today
      ? t('calendar.upcoming')
      : t('calendar.released');
  return <span style={styles.eventBadge}>{label}</span>;
}

const styles: Record<string, React.CSSProperties> = {
  screen: {
    minHeight: '100%',
    background: '#040508',
    color: '#fff',
    padding: `34px 42px 80px ${NAV_RAIL_WIDTH + CONTENT_PAD}px`,
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  eyebrow: {
    margin: '0 0 6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  title: {
    margin: 0,
    fontSize: 36,
    fontWeight: 900,
    letterSpacing: 0,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  refreshingLabel: {
    fontSize: 13,
    opacity: 0.6,
  },
  filterBtn: {
    height: 36,
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '0 11px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
  },
  navBtn: {
    width: 42,
    height: 42,
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.06)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  weekRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: 8,
    marginBottom: 8,
  },
  weekday: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 12,
    fontWeight: 800,
    paddingLeft: 8,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: 8,
  },
  day: {
    minHeight: 104,
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.035)',
    padding: 8,
    overflow: 'hidden',
  },
  dayNumber: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    fontWeight: 800,
  },
  dayHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  todayPill: {
    color: '#000',
    background: '#fff',
    borderRadius: 999,
    padding: '2px 6px',
    fontSize: 9,
    fontWeight: 900,
  },
  dayItems: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    marginTop: 8,
  },
  event: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minHeight: 22,
    overflow: 'hidden',
  },
  eventPoster: {
    width: 18,
    height: 22,
    objectFit: 'cover',
    borderRadius: 3,
    flexShrink: 0,
  },
  eventText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  eventBadge: {
    marginLeft: 'auto',
    color: 'rgba(255,255,255,0.72)',
    background: 'rgba(255,255,255,0.1)',
    borderRadius: 999,
    padding: '2px 5px',
    fontSize: 9,
    fontWeight: 900,
    flexShrink: 0,
  },
  moreEvents: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 10,
    fontWeight: 800,
    paddingLeft: 2,
  },
  empty: {
    marginTop: 24,
    color: 'rgba(255,255,255,0.54)',
    fontSize: 15,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
};
