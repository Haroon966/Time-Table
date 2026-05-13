/** Keep in sync with backend MAX_TIMETABLE_PERIODS (10). */
export const MAX_TIMETABLE_PERIODS = 10;

export const PERIODS = Array.from({ length: MAX_TIMETABLE_PERIODS }, (_, i) => {
  const n = i + 1;
  const key = `Period ${n}`;
  return { label: key, key };
});

export const PERIOD_TO_TIME = {
  'Period 1': { start: '08:00', end: '08:45' },
  'Period 2': { start: '08:50', end: '09:35' },
  'Period 3': { start: '09:40', end: '10:25' },
  'Period 4': { start: '10:50', end: '11:35' },
  'Period 5': { start: '11:40', end: '12:25' },
  'Period 6': { start: '12:30', end: '13:15' },
  'Period 7': { start: '13:20', end: '14:05' },
  'Period 8': { start: '14:10', end: '14:55' },
  'Period 9': { start: '15:00', end: '15:45' },
  'Period 10': { start: '15:50', end: '16:35' },
};

export const BREAK_AFTER_PERIOD = 'Period 3';
export const BREAK_TIME = { start: '10:25', end: '10:45' };

const JS_WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayNameFromISODate(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') return 'Monday';
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 'Monday';
  return JS_WEEKDAY[d.getDay()];
}

export function todayISODateLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Mon-first ordered week including Sunday (index 6). Keep in sync with timetableUtils DAYS. */
const ORDERED_SCHOOL_WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** Move isoDate to the same weekday within the same calendar week (Mon–Sun week, Mon first). */
export function shiftISODateToWeekday(isoDate, targetDayName) {
  const dayIndex = ORDERED_SCHOOL_WEEKDAYS.indexOf(targetDayName);
  if (dayIndex < 0 || !isoDate || typeof isoDate !== 'string') return isoDate;
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const js = d.getDay();
  const fromMonday = js === 0 ? 6 : js - 1;
  const delta = dayIndex - fromMonday;
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
