import {
  PERIODS,
  PERIOD_TO_TIME,
  BREAK_AFTER_PERIOD,
  BREAK_TIME,
  MAX_TIMETABLE_PERIODS,
} from '../../utils/timetablePeriods';

export const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
export const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export { PERIODS, PERIOD_TO_TIME, BREAK_AFTER_PERIOD, BREAK_TIME, MAX_TIMETABLE_PERIODS };

/** Largest period index N found in entry.period strings like "Period N". */
export function maxTeachingPeriodNumberFromEntries(entries) {
  let max = 0;
  if (!Array.isArray(entries)) return max;
  for (const e of entries) {
    const m = String(e?.period ?? '').match(/^Period\s+(\d+)$/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

/**
 * Teaching period columns: at least cfgPeriodsPerDay and at least max period seen in saved entries.
 */
export function periodsSliceForSchool(entries, cfgPeriodsPerDay, capPeriods) {
  const cap = capPeriods ?? MAX_TIMETABLE_PERIODS;
  const fromCfg = Math.max(1, Number(cfgPeriodsPerDay) || 5);
  const fromData = maxTeachingPeriodNumberFromEntries(entries);
  const n = Math.min(cap, Math.max(fromCfg, fromData || 0));
  return PERIODS.slice(0, n);
}

/** Stable pastel backgrounds for teacher rows (WCAG: always pair with text labels). */
export const TEACHER_SCHEDULE_ROW_PALETTE = [
  '#e3f2fd',
  '#fce4ec',
  '#e8f5e9',
  '#fff3e0',
  '#f3e5f5',
  '#e0f7fa',
  '#fffde7',
  '#efebe9',
  '#e8eaf6',
  '#ffebee',
  '#f1f8e9',
  '#e1bee7',
  '#b2ebf2',
  '#dcedc8',
  '#ffe0b2',
  '#c5cae9',
];

export function teacherScheduleRowBackground(staffId) {
  const n = Number(staffId);
  const i = Number.isFinite(n)
    ? Math.abs(Math.trunc(n)) % TEACHER_SCHEDULE_ROW_PALETTE.length
    : 0;
  return TEACHER_SCHEDULE_ROW_PALETTE[i];
}

/** Same teacher + day + period appears on more than one row → scheduling clash. */
export function buildTeacherPeriodDoubleBookingKeys(entries) {
  const counts = new Map();
  if (!Array.isArray(entries)) return new Set();
  entries.forEach((e) => {
    const tid = typeof e.teacher === 'object' && e.teacher?.id != null ? e.teacher.id : e.teacher;
    if (tid == null || tid === '') return;
    const k = `${tid}|${e.day}|${e.period}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  const out = new Set();
  counts.forEach((n, k) => {
    if (n > 1) out.add(k);
  });
  return out;
}

export function teacherPeriodIsDoubleBooked(doubleBookKeys, teacherId, day, periodKey) {
  if (!doubleBookKeys?.size) return false;
  return doubleBookKeys.has(`${teacherId}|${day}|${periodKey}`);
}

export function teacherHasDoubleBookingOnDay(doubleBookKeys, teacherId, day, periodKeys) {
  if (!doubleBookKeys?.size || !periodKeys?.length) return false;
  return periodKeys.some((pk) => doubleBookKeys.has(`${teacherId}|${day}|${pk}`));
}

/**
 * Teacher IDs that already have a row on this day+period (other classes).
 * Excludes entry ids in excludeEntryIds so the slot open in the editor does not block listing
 * that teacher as “free” when they only teach this cell.
 */
export function busyTeacherIdsElsewhereInSlot(entries, day, periodKey, excludeEntryIds = []) {
  const exclude = new Set(
    (excludeEntryIds || [])
      .map((id) => Number(id))
      .filter((n) => Number.isFinite(n) && n > 0)
  );
  const busy = new Set();
  if (!Array.isArray(entries)) return busy;
  for (const e of entries) {
    if (e.day !== day || e.period !== periodKey) continue;
    if (e.id != null && exclude.has(Number(e.id))) continue;
    const tid = typeof e.teacher === 'object' && e.teacher?.id != null ? e.teacher.id : e.teacher;
    if (tid != null && tid !== '') busy.add(String(tid));
  }
  return busy;
}

/** Format 24h "HH:mm" as "h:mm AM/PM" for display */
export function formatTimeAMPM(isoTime) {
  if (!isoTime || typeof isoTime !== 'string') return isoTime;
  const [h, m] = isoTime.trim().split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(h)) return isoTime;
  const hour = h % 12 || 12;
  const min = Number.isNaN(m) ? 0 : m;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hour}:${String(min).padStart(2, '0')} ${ampm}`;
}

/** Conflicts: same teacher assigned to more than one class in the same day + period */
export function buildTeacherConflictsFromEntries(entries, getTeacherNameFn) {
  const byKey = new Map();
  entries.forEach((entry) => {
    const teacherId = String(typeof entry.teacher === 'object' ? entry.teacher?.id : entry.teacher);
    const k = `${entry.day}|${entry.period}`;
    if (!byKey.has(k)) byKey.set(k, new Map());
    const byT = byKey.get(k);
    if (!byT.has(teacherId)) byT.set(teacherId, []);
    byT.get(teacherId).push(entry);
  });
  const conflicts = [];
  byKey.forEach((byT, k) => {
    const pipe = k.indexOf('|');
    const day = k.slice(0, pipe);
    const period = k.slice(pipe + 1);
    byT.forEach((ents) => {
      if (ents.length > 1) {
        conflicts.push({
          day,
          period,
          teacherName: getTeacherNameFn(ents[0]),
          teacherId: String(typeof ents[0].teacher === 'object' ? ents[0].teacher?.id : ents[0].teacher),
          count: ents.length,
          classesList: ents.map((e) => `${e.grade}${e.section ? `-${e.section}` : ''}`).join(', '),
          entries: ents,
        });
      }
    });
  });
  return conflicts;
}

export function findEntryTeacherDay(entries, teacherId, period, dayName) {
  return entries.find((entry) => {
    const tid = typeof entry.teacher === 'object' ? entry.teacher?.id : entry.teacher;
    return (
      entry.day === dayName &&
      String(tid) === String(teacherId) &&
      entry.period === period.key
    );
  });
}

export function findEntryByClassDay(entries, classItem, period, dayName) {
  return entries.find(
    (entry) =>
      entry.day === dayName &&
      entry.period === period.key &&
      entry.grade === classItem.grade &&
      (entry.section || '') === (classItem.section || '')
  );
}

/** Standard subjects shown in teacher edit dropdown (value = API/store, labelKey = translation key) */
export const STANDARD_SUBJECTS = [
  { value: 'English', labelKey: 'subjectEnglish' },
  { value: 'Urdu', labelKey: 'subjectUrdu' },
  { value: 'Mathematics', labelKey: 'subjectMath' },
  { value: 'Science', labelKey: 'subjectScience' },
  { value: 'Islamiat', labelKey: 'subjectIslamiat' },
  { value: 'Pakistan Studies', labelKey: 'subjectPakistanStudies' },
  { value: 'Physics', labelKey: 'subjectPhysics' },
  { value: 'Chemistry', labelKey: 'subjectChemistry' },
  { value: 'Biology', labelKey: 'subjectBiology' },
  { value: 'Computer Science', labelKey: 'subjectComputer' },
  { value: 'General', labelKey: 'subjectGeneral' },
];

export function formatClassLabel(grade, section) {
  const g = grade != null ? String(grade).trim() : '';
  const s = section != null ? String(section).trim() : '';
  if (!g && !s) return '-';
  return `${g}${s ? `-${s}` : ''}`;
}

export function buildTeacherTimelineSlots(entries, conflictEntryIds, periodsSlice = PERIODS) {
  const entriesByPeriod = new Map();
  (entries || []).forEach((entry) => {
    const periodKey = String(entry?.period || '');
    if (!periodKey) return;
    const list = entriesByPeriod.get(periodKey) || [];
    list.push(entry);
    entriesByPeriod.set(periodKey, list);
  });
  const slots = [];
  for (let i = 0; i < periodsSlice.length; i++) {
    const periodKey = periodsSlice[i].key;
    const periodEntries = entriesByPeriod.get(periodKey) || [];
    const timeRange = PERIOD_TO_TIME[periodKey];
    if (periodEntries.length > 0) {
      periodEntries.forEach((entry) => {
        const teacherName = typeof entry.teacher === 'object' && entry.teacher?.name ? entry.teacher.name : '';
        slots.push({
          type: 'class',
          entry,
          periodLabel: entry.period,
          timeRange: timeRange || null,
          subject: entry.subject || '',
          classLabel: formatClassLabel(entry.grade, entry.section),
          room: entry.room ? `Room ${entry.room}` : '',
          teacherName,
          isConflict: conflictEntryIds.has(entry.id),
        });
      });
    } else {
      slots.push({
        type: 'free',
        periodLabel: periodKey,
        label: 'freePeriod',
        timeRange: timeRange || null,
      });
    }
    if (periodKey === BREAK_AFTER_PERIOD) {
      slots.push({
        type: 'break',
        periodLabel: periodKey,
        label: 'timetableBreakLabel',
        timeRange: BREAK_TIME,
      });
    }
  }
  return slots;
}

/** Build export payload in same shape as generatedResult (by_class) from teacher entries by day. */
export function buildTeacherExportPayload(entriesByDay, teacherName, periodsSlice = PERIODS) {
  const daySlots = DAYS.map((day) => {
    const entries = entriesByDay[day] || [];
    const slots = [];
    for (let i = 0; i < periodsSlice.length; i++) {
      const periodKey = periodsSlice[i].key;
      const periodEntries = entries.filter((e) => e.period === periodKey);
      periodEntries.forEach((entry) => {
        const teacherNameFromEntry = typeof entry.teacher === 'object' && entry.teacher?.name ? entry.teacher.name : '';
        const classLabel = formatClassLabel(entry.grade, entry.section);
        slots.push({
          type: 'class',
          label: periodKey,
          subject: entry.subject || '-',
          teacher_name: teacherNameFromEntry || undefined,
          ...(classLabel && classLabel !== '-' ? { class_label: classLabel } : {}),
        });
      });
      if (periodKey === BREAK_AFTER_PERIOD) {
        slots.push({ type: 'break', label: 'timetableBreakLabel' });
      }
    }
    return { day, slots };
  });
  return { by_class: { [teacherName || 'My Schedule']: daySlots } };
}
