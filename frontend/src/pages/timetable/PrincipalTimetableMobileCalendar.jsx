import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { weekdayNameFromISODate, todayISODateLocal, PERIOD_TO_TIME } from '../../utils/timetablePeriods';
import styles from './PrincipalTimetableMobileCalendar.module.css';

// ── Date utilities ───────────────────────────────────────────────────────────

function isoAdd(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoMonday(isoDate) {
  const d = new Date(`${isoDate}T12:00:00`);
  const js = d.getDay();
  d.setDate(d.getDate() + (js === 0 ? -6 : 1 - js));
  return d.toISOString().slice(0, 10);
}

function isoShiftMonth(isoDate, delta) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/** 0=Mon … 6=Sun (ISO week order for calendar grid offsets). */
function isoWeekdayMon(isoDate) {
  const js = new Date(`${isoDate}T12:00:00`).getDay();
  return js === 0 ? 6 : js - 1;
}

function allDaysOfMonth(isoDate) {
  const d = new Date(`${isoDate}T12:00:00`);
  const year = d.getFullYear();
  const month = d.getMonth();
  const result = [];
  const cur = new Date(year, month, 1);
  while (cur.getMonth() === month) {
    const y = cur.getFullYear();
    const mo = String(cur.getMonth() + 1).padStart(2, '0');
    const dy = String(cur.getDate()).padStart(2, '0');
    result.push(`${y}-${mo}-${dy}`);
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

function fmt12h(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function fmtDayFull(isoDate) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function fmtMonthYear(isoDate) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });
}

// ── Toolbar helpers ──────────────────────────────────────────────────────────

const VIEWS = ['day', '3day', 'week', 'month'];
const VIEW_LABELS = { day: '1D', '3day': '3D', week: 'Week', month: 'Month' };

function toolbarTitle(view, anchor) {
  if (view === 'day') return fmtDayFull(anchor);
  if (view === '3day') {
    const a = new Date(`${anchor}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const b = new Date(`${isoAdd(anchor, 2)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${a} – ${b}`;
  }
  if (view === 'week') {
    const mon = isoMonday(anchor);
    const sun = isoAdd(mon, 6);
    const a = new Date(`${mon}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const b = new Date(`${sun}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${a} – ${b}`;
  }
  return fmtMonthYear(anchor);
}

function toolbarPrev(view, anchor) {
  if (view === 'day') return isoAdd(anchor, -1);
  if (view === '3day') return isoAdd(anchor, -3);
  if (view === 'week') return isoAdd(anchor, -7);
  return isoShiftMonth(anchor, -1);
}

function toolbarNext(view, anchor) {
  if (view === 'day') return isoAdd(anchor, 1);
  if (view === '3day') return isoAdd(anchor, 3);
  if (view === 'week') return isoAdd(anchor, 7);
  return isoShiftMonth(anchor, 1);
}

// ── CalendarToolbar ──────────────────────────────────────────────────────────

function CalendarToolbar({ view, anchor, onViewChange, onAnchorChange, t }) {
  const today = todayISODateLocal();
  return (
    <div className={styles.toolbar}>
      <div className={styles.viewSwitcher} role="group" aria-label="Calendar view">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            className={`${styles.viewBtn} ${view === v ? styles.viewBtnActive : ''}`}
            onClick={() => onViewChange(v)}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>
      <div className={styles.navRow}>
        <button
          type="button"
          className={styles.navArrow}
          onClick={() => onAnchorChange(toolbarPrev(view, anchor))}
          aria-label="Previous"
        >
          <ChevronLeft size={17} aria-hidden />
        </button>
        <span className={styles.navTitle}>{toolbarTitle(view, anchor)}</span>
        <button
          type="button"
          className={styles.navArrow}
          onClick={() => onAnchorChange(toolbarNext(view, anchor))}
          aria-label="Next"
        >
          <ChevronRight size={17} aria-hidden />
        </button>
        {anchor !== today && (
          <button
            type="button"
            className={styles.todayBtn}
            onClick={() => onAnchorChange(today)}
          >
            {t('timetableCalToday')}
          </button>
        )}
      </div>
    </div>
  );
}

// ── SlotCard ─────────────────────────────────────────────────────────────────

function SlotCard({ slot, onTap, compact }) {
  const empty =
    !slot ||
    slot.blocks.length === 0 ||
    (slot.blocks.length === 1 && slot.blocks[0].key === 'empty');
  return (
    <button
      type="button"
      className={[
        styles.slotCard,
        slot?.conflict ? styles.slotConflict : '',
        empty ? styles.slotEmpty : '',
        compact ? styles.slotCompact : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onTap}
    >
      {slot?.conflict && <span className={styles.conflictPip} aria-hidden />}
      {empty ? (
        <span className={styles.slotDash}>—</span>
      ) : (
        slot.blocks.map((b) => (
          <span key={b.key} className={styles.slotBlock}>
            <span className={styles.slotSubj}>{b.subject}</span>
            {b.detail && <span className={styles.slotMeta}>{b.detail}</span>}
          </span>
        ))
      )}
    </button>
  );
}

// ── Day timeline view ────────────────────────────────────────────────────────

function DayView({ anchor, periodsSlice, days, cfg, principalMobileSlot, openCell, t }) {
  const weekday = weekdayNameFromISODate(anchor);
  const isWorking = days.includes(weekday);

  return (
    <div className={styles.dayView}>
      {!isWorking ? (
        <div className={styles.noSchoolBox}>
          <div className={styles.noSchoolIcon}>📅</div>
          <p className={styles.noSchoolText}>{t('timetableCalNoSchool')}</p>
          <p className={styles.noSchoolSub}>{t('timetableCalNoSchoolSub')}</p>
        </div>
      ) : (
        <div className={styles.timeline}>
          {periodsSlice.map((p, idx) => {
            const times = PERIOD_TO_TIME[p.key];
            const slot = principalMobileSlot(weekday, p.key);
            return (
              <React.Fragment key={p.key}>
                <div className={styles.tlRow}>
                  <div className={styles.tlTime}>
                    {times ? (
                      <>
                        <span className={styles.tlTimeStart}>{fmt12h(times.start)}</span>
                        <span className={styles.tlTimeEnd}>{fmt12h(times.end)}</span>
                      </>
                    ) : (
                      <span className={styles.tlPeriodNum}>{idx + 1}</span>
                    )}
                  </div>
                  <div className={styles.tlLine}>
                    <div className={styles.tlDot} />
                    <div className={styles.tlConnector} />
                  </div>
                  <div className={styles.tlContent}>
                    <div className={styles.tlPeriodLabel}>
                      {t('timetablePeriodColumn')} {idx + 1}
                    </div>
                    <SlotCard slot={slot} onTap={() => openCell(weekday, p.key)} />
                  </div>
                </div>
                {idx + 1 === cfg.lunch_after_period && cfg.lunch_break_minutes > 0 && (
                  <div className={styles.tlBreak}>
                    <div className={styles.tlTime}>
                      <span className={styles.tlBreakTime}>{t('timetableBreakLabel')}</span>
                    </div>
                    <div className={styles.tlLine}>
                      <div className={styles.tlDotBreak} />
                      <div className={styles.tlConnector} />
                    </div>
                    <div className={styles.tlContent}>
                      <div className={styles.tlBreakLabel}>
                        {t('timetableBreakLabel')} · {cfg.lunch_break_minutes} min
                      </div>
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
      <p className={styles.recurringNote}>{t('timetableCalRecurring')}</p>
    </div>
  );
}

// ── Multi-day view (3-day + week) ────────────────────────────────────────────

function MultiDayView({ dates, periodsSlice, days, cfg, principalMobileSlot, openCell, t }) {
  const today = todayISODateLocal();

  return (
    <div className={styles.multiOuter}>
      <div className={styles.multiScroll}>
        <div className={styles.multiGrid} style={{ '--day-count': dates.length }}>
          {/* Corner spacer */}
          <div className={styles.multiCorner} />

          {/* Day-column headers */}
          {dates.map((iso) => {
            const d = new Date(`${iso}T12:00:00`);
            const isToday = iso === today;
            const isWorking = days.includes(weekdayNameFromISODate(iso));
            return (
              <div
                key={iso}
                className={[
                  styles.multiColHead,
                  isToday ? styles.multiColHeadToday : '',
                  !isWorking ? styles.multiColHeadOff : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={styles.multiColDow}>
                  {d.toLocaleDateString('en-US', { weekday: 'short' })}
                </span>
                <span className={`${styles.multiColNum} ${isToday ? styles.multiColNumToday : ''}`}>
                  {d.getDate()}
                </span>
              </div>
            );
          })}

          {/* Period rows */}
          {periodsSlice.map((p, idx) => {
            const times = PERIOD_TO_TIME[p.key];
            return (
              <React.Fragment key={p.key}>
                {/* Lunch break row inserted AFTER the period = lunch_after_period */}
                {idx > 0 && idx === cfg.lunch_after_period && cfg.lunch_break_minutes > 0 && (
                  <>
                    <div className={styles.multiTimeGutter} />
                    {dates.map((iso) => (
                      <div key={iso} className={styles.multiBreakCell}>
                        <span className={styles.multiBreakLabel}>{t('timetableBreakLabel')}</span>
                      </div>
                    ))}
                  </>
                )}

                {/* Time gutter */}
                <div className={styles.multiTimeGutter}>
                  <span className={styles.multiTimeText}>
                    {times ? fmt12h(times.start) : `P${idx + 1}`}
                  </span>
                </div>

                {/* Cells */}
                {dates.map((iso) => {
                  const weekday = weekdayNameFromISODate(iso);
                  const isWorking = days.includes(weekday);
                  const slot = isWorking ? principalMobileSlot(weekday, p.key) : null;
                  return (
                    <div
                      key={iso}
                      className={`${styles.multiCell} ${!isWorking ? styles.multiCellOff : ''}`}
                    >
                      {isWorking && (
                        <SlotCard slot={slot} onTap={() => openCell(weekday, p.key)} compact />
                      )}
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </div>
      <p className={styles.recurringNote}>{t('timetableCalRecurring')}</p>
    </div>
  );
}

// ── Month grid view ──────────────────────────────────────────────────────────

const DOW_HEADERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function MonthView({ anchor, days, periodsSlice, principalMobileSlot, onDayTap, t }) {
  const today = todayISODateLocal();
  const monthDays = useMemo(() => allDaysOfMonth(anchor), [anchor]);
  const firstOffset = useMemo(() => isoWeekdayMon(monthDays[0]), [monthDays]);

  // Count filled periods per working day (for dot indicators)
  const lessonCounts = useMemo(() => {
    const map = {};
    monthDays.forEach((iso) => {
      const wday = weekdayNameFromISODate(iso);
      if (!days.includes(wday)) { map[iso] = -1; return; }
      let n = 0;
      periodsSlice.forEach((p) => {
        const s = principalMobileSlot(wday, p.key);
        if (s.blocks.length > 0 && !(s.blocks.length === 1 && s.blocks[0].key === 'empty')) n++;
      });
      map[iso] = n;
    });
    return map;
  }, [monthDays, days, periodsSlice, principalMobileSlot]);

  return (
    <div className={styles.monthView}>
      <div className={styles.monthGrid}>
        {DOW_HEADERS.map((h, i) => (
          <div key={i} className={styles.monthDow}>{h}</div>
        ))}
        {Array.from({ length: firstOffset }).map((_, i) => (
          <div key={`lead-${i}`} className={styles.monthBlank} />
        ))}
        {monthDays.map((iso) => {
          const isToday = iso === today;
          const isSelected = iso === anchor;
          const count = lessonCounts[iso];
          const isWorking = count !== -1;
          const dayNum = new Date(`${iso}T12:00:00`).getDate();
          return (
            <button
              key={iso}
              type="button"
              className={[
                styles.monthDay,
                isToday ? styles.monthDayToday : '',
                isSelected ? styles.monthDaySelected : '',
                !isWorking ? styles.monthDayOff : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onDayTap(iso)}
            >
              <span className={styles.monthDayNum}>{dayNum}</span>
              {isWorking && count > 0 && (
                <div className={styles.monthDots}>
                  {Array.from({ length: Math.min(count, 5) }).map((_, i) => (
                    <span key={i} className={styles.monthDot} />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <p className={styles.recurringNote}>{t('timetableCalRecurring')}</p>
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

export default function PrincipalTimetableMobileCalendar({
  mobileCalView,
  viewAnchorDate,
  onViewChange,
  onAnchorChange,
  periodsSlice,
  days,
  cfg,
  principalMobileSlot,
  openCell,
  t,
}) {
  const visibleDates = useMemo(() => {
    if (mobileCalView === 'day') return [viewAnchorDate];
    if (mobileCalView === '3day')
      return [viewAnchorDate, isoAdd(viewAnchorDate, 1), isoAdd(viewAnchorDate, 2)];
    if (mobileCalView === 'week') {
      const mon = isoMonday(viewAnchorDate);
      return Array.from({ length: 7 }, (_, i) => isoAdd(mon, i));
    }
    return null;
  }, [mobileCalView, viewAnchorDate]);

  return (
    <div className={styles.root}>
      <CalendarToolbar
        view={mobileCalView}
        anchor={viewAnchorDate}
        onViewChange={onViewChange}
        onAnchorChange={onAnchorChange}
        t={t}
      />

      {mobileCalView === 'day' && (
        <DayView
          anchor={viewAnchorDate}
          periodsSlice={periodsSlice}
          days={days}
          cfg={cfg}
          principalMobileSlot={principalMobileSlot}
          openCell={openCell}
          t={t}
        />
      )}

      {(mobileCalView === '3day' || mobileCalView === 'week') && visibleDates && (
        <MultiDayView
          dates={visibleDates}
          periodsSlice={periodsSlice}
          days={days}
          cfg={cfg}
          principalMobileSlot={principalMobileSlot}
          openCell={openCell}
          t={t}
        />
      )}

      {mobileCalView === 'month' && (
        <MonthView
          anchor={viewAnchorDate}
          days={days}
          periodsSlice={periodsSlice}
          principalMobileSlot={principalMobileSlot}
          onDayTap={(iso) => {
            onAnchorChange(iso);
            onViewChange('day');
          }}
          t={t}
        />
      )}
    </div>
  );
}
