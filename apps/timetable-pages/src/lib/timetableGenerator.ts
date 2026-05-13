/**
 * Port of backend/school/timetable_generator.py — same JSON shapes as generate(config).
 */
import { MAX_TIMETABLE_PERIODS } from './timetableConstants';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };
export type Config = Record<string, JsonValue>;

const DEFAULT_DIFFICULTY: Record<string, string> = {
  math: 'hard',
  mathematics: 'hard',
  physics: 'hard',
  chemistry: 'hard',
  biology: 'medium',
  english: 'medium',
  urdu: 'medium',
  islamiyat: 'medium',
  'pakistan studies': 'medium',
  'social studies': 'medium',
  history: 'medium',
  geography: 'medium',
  arabic: 'medium',
  art: 'light',
  pe: 'light',
  'physical education': 'light',
  music: 'light',
  computer: 'medium',
  'computer science': 'medium',
  science: 'medium',
  principal: 'medium',
  'vice principal': 'medium',
};

export const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const PERIOD_LABELS = Array.from({ length: MAX_TIMETABLE_PERIODS }, (_, i) => `Period ${i + 1}`);

const FALLBACK_SUBJECT_KEYWORD_GROUPS: string[][] = [
  ['computer', 'information technology', 'software'],
  ['physical education', 'physical', ' p.e', 'pe ', 'pti', 'p.t', 'gym', 'sport'],
  ['science', 'biology', 'chemistry', 'physics', 'general science'],
  ['islamiyat', 'islamic', 'deeniyat'],
  ['urdu'],
  ['english'],
  ['mathematics', 'math', 'algebra'],
  ['library'],
  ['lab', 'laboratory', 'lab assistant'],
];

const SUBJECT_CANONICAL_RULES: [string, string[]][] = [
  ['computer science', ['computer science', 'ict', 'information technology', 'software']],
  [
    'physical education',
    ['physical education', 'physical training', 'physical ed', 'pti', 'gym', 'sports'],
  ],
  ['pakistan studies', ['pakistan studies', 'pak studies', 'pst']],
  ['social studies', ['social studies', 'social science']],
  ['general science', ['general science']],
  ['mathematics', ['mathematics', 'math', 'maths', 'algebra', 'geometry']],
  ['islamiyat', ['islamiyat', 'islamic studies', 'islamic', 'deeniyat']],
  ['arabic', ['arabic']],
  ['english', ['english', 'language arts']],
  ['urdu', ['urdu']],
  ['science', ['science', 'biology', 'chemistry', 'physics']],
  ['vice principal', ['vice principal', 'vice-principal']],
  ['principal', ['principal', 'head teacher', 'headteacher']],
];

function normalizeSubject(s: string | undefined | null): string {
  return (s ?? '').trim().toLowerCase();
}

function canonicalSubjectNorm(normSubj: string): string {
  if (!normSubj) return normSubj;
  for (const [canon, triggers] of SUBJECT_CANONICAL_RULES) {
    if (normSubj === canon) return canon;
    for (const tr of triggers) {
      const trn = normalizeSubject(tr);
      if (!trn) continue;
      if (normSubj === trn) return canon;
      if (trn.length >= 3 && normSubj.includes(trn)) return canon;
    }
  }
  return normSubj;
}

function normalizeStaffPk(tid: unknown): number | string | null {
  if (tid === null || tid === undefined) return null;
  if (typeof tid === 'number' && Number.isFinite(tid)) return tid;
  const n = parseInt(String(tid), 10);
  if (!Number.isNaN(n) && String(n) === String(tid)) return n;
  return tid as string;
}

type Teacher = Record<string, JsonValue>;

function dedupeTeachersById(teacherList: Teacher[]): Teacher[] {
  const seen = new Set<string | number>();
  const out: Teacher[] = [];
  for (const t of teacherList) {
    const tid = normalizeStaffPk(t.id);
    if (tid === null || seen.has(String(tid))) continue;
    seen.add(String(tid));
    out.push(t);
  }
  return out;
}

function staffSortKey(tid: unknown): [number, number | string] {
  const t = normalizeStaffPk(tid);
  if (t === null) return [1, ''];
  if (typeof t === 'number') return [0, t];
  return [2, String(t)];
}

export function periodLabelForIndex(period1based: number): string {
  const i = period1based - 1;
  if (i >= 0 && i < PERIOD_LABELS.length) return PERIOD_LABELS[i]!;
  return `Period ${period1based}`;
}

function subjectsFromTeachers(
  teachers: Teacher[],
  difficultyOverrides: Array<Record<string, JsonValue>> | null | undefined
): Array<{ name: string; difficulty: string }> {
  const seenCanon: Record<string, string> = {};
  for (const t of teachers) {
    const subj = String(t.subject ?? '').trim();
    if (!subj) continue;
    const canon = canonicalSubjectNorm(normalizeSubject(subj));
    const prev = seenCanon[canon];
    if (prev === undefined || subj.length > prev.length) seenCanon[canon] = subj;
  }
  const subjectNames = Object.values(seenCanon);
  const overrideMap: Record<string, string> = {};
  if (difficultyOverrides) {
    for (const s of difficultyOverrides) {
      const name = String(s.name ?? '').trim();
      if (!name) continue;
      const d = String(s.difficulty ?? 'medium').toLowerCase();
      const val = d === 'hard' || d === 'medium' || d === 'light' ? d : 'medium';
      const cnO = canonicalSubjectNorm(normalizeSubject(name));
      overrideMap[cnO] = val;
      overrideMap[normalizeSubject(name)] = val;
    }
  }
  const result: Array<{ name: string; difficulty: string }> = [];
  for (const name of subjectNames) {
    const cn = canonicalSubjectNorm(normalizeSubject(name));
    const norm = normalizeSubject(name);
    const diff =
      overrideMap[cn] ??
      overrideMap[norm] ??
      DEFAULT_DIFFICULTY[cn] ??
      DEFAULT_DIFFICULTY[norm] ??
      'medium';
    result.push({ name, difficulty: diff });
  }
  return result;
}

export function buildSlotSequence(
  periodsPerDay: number,
  shortBreakMinutes: number,
  lunchBreakMinutes: number,
  lunchAfterPeriod: number
): Array<{ type: string; period: number | null; label: string }> {
  const slots: Array<{ type: string; period: number | null; label: string }> = [];
  for (let p = 1; p <= periodsPerDay; p++) {
    slots.push({
      type: 'class',
      period: p,
      label: periodLabelForIndex(p),
    });
    if (p === lunchAfterPeriod) {
      slots.push({
        type: 'break',
        period: null,
        label: `Lunch (${lunchBreakMinutes} min)`,
      });
    } else if (p < periodsPerDay && shortBreakMinutes > 0) {
      slots.push({
        type: 'break',
        period: null,
        label: `Break (${shortBreakMinutes} min)`,
      });
    }
  }
  return slots;
}

type ClassRow = Record<string, JsonValue>;

function classPeriodsPerDay(cls: ClassRow, defaultPpd: number): number {
  let ppd = cls.periods_per_day;
  if (ppd === null || ppd === undefined) ppd = defaultPpd;
  return Math.min(MAX_TIMETABLE_PERIODS, Math.max(1, parseInt(String(ppd), 10)));
}

function weeklyLoadPerClass(
  classes: ClassRow[],
  subjects: Array<{ name: string; difficulty: string }>,
  weeklyLoad: Record<string, number> | null | undefined,
  defaultPeriodsPerDay: number,
  workingDays: number
): Map<string, string[]> {
  const subjectNames = subjects.map((s) => s.name).filter(Boolean);
  const result = new Map<string, string[]>();
  if (!subjectNames.length) return result;

  for (const cls of classes) {
    const key = `${cls.grade}||${cls.section ?? ''}`;
    const ppd = classPeriodsPerDay(cls, defaultPeriodsPerDay);
    const totalSlots = ppd * workingDays;

    if (weeklyLoad && typeof weeklyLoad === 'object') {
      const loadMap: Record<string, [string, number]> = {};
      for (const [k, v] of Object.entries(weeklyLoad)) {
        if (typeof v === 'number' && v > 0) loadMap[normalizeSubject(k)] = [k, v];
      }
      const weekList: string[] = [];
      for (const [, [name, count]] of Object.entries(loadMap)) {
        if (
          subjectNames.includes(name) ||
          subjectNames.some((s) => normalizeSubject(s) === normalizeSubject(name))
        ) {
          let displayName = name;
          for (const s of subjects) {
            if (normalizeSubject(s.name) === normalizeSubject(name)) {
              displayName = s.name;
              break;
            }
          }
          for (let c = 0; c < count; c++) weekList.push(displayName);
        }
      }
      result.set(key, weekList.length > totalSlots ? weekList.slice(0, totalSlots) : weekList);
      continue;
    }

    const n = subjectNames.length;
    const perSubject = Math.floor(totalSlots / n);
    const remainder = totalSlots % n;
    const weekList: string[] = [];
    for (let i = 0; i < subjectNames.length; i++) {
      const name = subjectNames[i]!;
      const count = perSubject + (i < remainder ? 1 : 0);
      for (let c = 0; c < count; c++) weekList.push(name);
    }
    result.set(key, weekList);
  }
  return result;
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/** Fisher–Yates matching CPython list.shuffle (randbelow trace for parity tests). */
function shuffleInPlaceFromRandbelowTrace(
  arr: unknown[],
  trace: [number, number][],
  traceRef: { i: number }
): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const pair = trace[traceRef.i++];
    if (!pair) throw new Error('randbelow trace exhausted');
    const [n, j] = pair;
    if (n !== i + 1) {
      throw new Error(`randbelow trace mismatch at step ${traceRef.i - 1}: expected n=${i + 1}, got ${n}`);
    }
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function distributeWeeklyToDays(
  weeklyList: string[],
  periodsPerDay: number,
  workingDays: number,
  defaultSubject: string | null | undefined,
  shuffleItems: (items: string[]) => void
): string[][] {
  const items = [...weeklyList];
  shuffleItems(items);
  const days: string[][] = Array.from({ length: workingDays }, () => []);
  for (let i = 0; i < items.length; i++) {
    days[i % workingDays]!.push(items[i]!);
  }
  const filler = weeklyList[0] ?? defaultSubject ?? undefined;
  for (let i = 0; i < workingDays; i++) {
    if (days[i]!.length > periodsPerDay) days[i] = days[i]!.slice(0, periodsPerDay);
    while (days[i]!.length < periodsPerDay) {
      if (filler !== undefined) days[i]!.push(filler);
      else break;
    }
  }
  return days;
}

function assignSubjectsToDay(
  periodsPerDay: number,
  subjectListToday: string[],
  subjectDifficulty: Record<string, string>,
  maxHardPerDay = 3
): (string | null)[] {
  const queue = [...subjectListToday];
  const result: (string | null)[] = [];
  let lastSubject: string | null = null;
  let consecutiveSame = 0;
  let hardCount = 0;

  for (let _ = 0; _ < periodsPerDay; _++) {
    if (!queue.length) {
      result.push(null);
      continue;
    }
    const candidates: Array<[number, number, string, string]> = [];
    for (let i = 0; i < Math.min(10, queue.length); i++) {
      const subj = queue[i]!;
      const diff = subjectDifficulty[normalizeSubject(subj)] ?? 'medium';
      if (diff === 'hard' && hardCount >= maxHardPerDay) continue;
      if (
        lastSubject &&
        diff === 'hard' &&
        subjectDifficulty[normalizeSubject(lastSubject)] === 'hard'
      )
        continue;
      if (subj === lastSubject && consecutiveSame >= 2) continue;
      let score = diff === 'hard' ? 3 : diff === 'medium' ? 2 : 1;
      if (diff === 'hard' && hardCount < 2) score += 10;
      candidates.push([score, i, subj, diff]);
    }
    let best: string;
    let diff: string;
    if (!candidates.length) {
      best = queue.shift()!;
      diff = subjectDifficulty[normalizeSubject(best)] ?? 'medium';
    } else {
      candidates.sort((a, b) => (b[0] !== a[0] ? b[0] - a[0] : a[1] - b[1]));
      [, , best, diff] = candidates[0]!;
      const idx = queue.indexOf(best);
      if (idx >= 0) queue.splice(idx, 1);
    }
    result.push(best);
    if (best) {
      if (best === lastSubject) consecutiveSame += 1;
      else consecutiveSame = 1;
      lastSubject = best;
      if (diff === 'hard') hardCount += 1;
    }
  }

  const pool = subjectListToday.filter(Boolean);
  const fb = pool[0] ?? null;
  if (fb) {
    for (let i = 0; i < result.length; i++) {
      if (!result[i]) result[i] = fb;
    }
  }
  return result;
}

function generateClassTimetables(
  classes: ClassRow[],
  subjects: Array<{ name: string; difficulty: string }>,
  workingDays: number,
  weeklyLoad: Record<string, number> | null | undefined,
  defaultPeriodsPerDay: number,
  shuffleItems: (items: string[]) => void
): Map<string, string[][]> {
  const subjectDifficulty: Record<string, string> = {};
  for (const s of subjects) {
    const name = s.name;
    if (name) {
      let d = (s.difficulty ?? 'medium').toLowerCase();
      if (d !== 'hard' && d !== 'medium' && d !== 'light') d = 'medium';
      subjectDifficulty[normalizeSubject(name)] = d;
    }
  }

  const weeklyPerClass = weeklyLoadPerClass(
    classes,
    subjects,
    weeklyLoad,
    defaultPeriodsPerDay,
    workingDays
  );
  const subjNamesAll = subjects.map((s) => s.name).filter(Boolean);
  const defaultSubject = subjNamesAll[0] ?? null;
  const result = new Map<string, string[][]>();

  for (const cls of classes) {
    const grade = cls.grade;
    const section = String(cls.section ?? '');
    const key = `${grade}||${section}`;
    const ppd = classPeriodsPerDay(cls, defaultPeriodsPerDay);
    const need = ppd * workingDays;
    const weekList = [...(weeklyPerClass.get(key) ?? [])];
    while (weekList.length < need && subjNamesAll.length) {
      weekList.push(subjNamesAll[0]!);
    }
    const dayLists = distributeWeeklyToDays(weekList, ppd, workingDays, defaultSubject, shuffleItems);
    const classDays: string[][] = [];
    for (const daySubjects of dayLists) {
      const row = daySubjects.slice(0, ppd);
      while (row.length < ppd) row.push(defaultSubject!);
      for (let i = 0; i < row.length; i++) {
        if (!row[i]) row[i] = defaultSubject!;
      }
      const assigned = assignSubjectsToDay(ppd, row, subjectDifficulty, 3);
      classDays.push(assigned as string[]);
    }
    result.set(key, classDays);
  }
  return result;
}

function teacherBySubject(teachers: Teacher[]): Map<string, Teacher[]> {
  const bySubj = new Map<string, Teacher[]>();
  const add = (cn: string, t: Teacher) => {
    const arr = bySubj.get(cn) ?? [];
    arr.push(t);
    bySubj.set(cn, arr);
  };
  for (const t of teachers) {
    const subj = String(t.subject ?? '').trim();
    if (subj) {
      const cn = canonicalSubjectNorm(normalizeSubject(subj));
      add(cn, t);
    }
    const role = String(t.timetable_role ?? 'subject_teacher')
      .trim()
      .toLowerCase();
    if (role === 'principal') add(canonicalSubjectNorm('principal'), t);
    else if (role === 'vice_principal') add(canonicalSubjectNorm('vice principal'), t);
  }
  for (const key of [...bySubj.keys()]) {
    bySubj.set(key, dedupeTeachersById(bySubj.get(key)!));
  }
  return bySubj;
}

function teacherWeeklyDailyCaps(
  t: Teacher,
  schoolPeriodsPerDay: number | null | undefined
): [number | null, number | null] {
  const role = String(t.timetable_role ?? 'subject_teacher').trim();
  const mw = t.max_weekly_teaching_periods;
  const md = t.max_daily_teaching_periods;
  let weeklyCap: number | null;
  if (mw !== null && mw !== undefined) weeklyCap = parseInt(String(mw), 10);
  else if (role === 'principal') weeklyCap = 2;
  else if (role === 'vice_principal') weeklyCap = 3;
  else if (role === 'other') weeklyCap = 0;
  else weeklyCap = null;

  let dailyCap: number | null;
  if (md !== null && md !== undefined) dailyCap = parseInt(String(md), 10);
  else if (role === 'subject_teacher') {
    if (schoolPeriodsPerDay !== null && schoolPeriodsPerDay !== undefined) {
      const sp = parseInt(String(schoolPeriodsPerDay), 10);
      dailyCap = Math.min(MAX_TIMETABLE_PERIODS, Math.max(5, sp));
    } else dailyCap = 5;
  } else if (role === 'principal' || role === 'vice_principal') dailyCap = 5;
  else dailyCap = weeklyCap === 0 ? 0 : 5;
  return [weeklyCap, dailyCap];
}

function parseJoiningDate(jd: JsonValue): Date | null {
  if (jd === null || jd === undefined) return null;
  if (jd instanceof Date) return jd;
  const s = String(jd).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(parseInt(m[1]!, 10), parseInt(m[2]!, 10) - 1, parseInt(m[3]!, 10));
}

function joiningBoost(t: Teacher): number {
  const d = parseJoiningDate(t.joining_date);
  if (!d) return 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = today.getTime() - d.getTime();
  const days = diffMs / (86400 * 1000);
  if (days >= 0 && days <= 90) return -1;
  return 0;
}

function fallbackPools(teachers: Teacher[]): Teacher[][] {
  const pools: Teacher[][] = [];
  for (const keywords of FALLBACK_SUBJECT_KEYWORD_GROUPS) {
    const pool: Teacher[] = [];
    for (const t of teachers) {
      const subj = normalizeSubject(String(t.subject ?? ''));
      if (keywords.some((kw) => subj.includes(kw))) pool.push(t);
    }
    const deduped = dedupeTeachersById(pool);
    if (deduped.length) pools.push(deduped);
  }
  return pools;
}

type Entry = {
  day: string;
  period: string;
  period_index: number;
  grade: JsonValue;
  section: string;
  subject: string;
  teacher_id: number | string | null;
  teacher_name: string;
};

function assignTeachers(
  classTimetables: Map<string, string[][]>,
  classes: ClassRow[],
  teachers: Teacher[],
  daysUsed: string[],
  schoolPeriodsPerDay: number | null | undefined
): [Entry[], string[]] {
  const teacherBySubj = teacherBySubject(teachers);
  const teacherUsed = new Map<string, Set<number | string>>();
  const usedKey = (day: string, periodLabel: string) => `${day}\0${periodLabel}`;
  const teacherLoad = new Map<string, number>();
  const teacherDayCount = new Map<string, number>();
  const weekKey = (tid: number | string | null, day: string) => `${String(tid)}\0${day}`;
  const teacherWeekCount = new Map<string, number>();

  const entries: Entry[] = [];
  const warnings: string[] = [];

  const canUse = (
    tid: number | string | null,
    day: string,
    weeklyCap: number | null,
    dailyCap: number | null
  ): boolean => {
    if (tid === null) return false;
    if (dailyCap !== null && (teacherDayCount.get(weekKey(tid, day)) ?? 0) >= dailyCap) return false;
    if (weeklyCap !== null && (teacherWeekCount.get(String(tid)) ?? 0) >= weeklyCap) return false;
    return true;
  };

  const pickBest = (candidateList: Teacher[], day: string, periodLabel: string): Teacher | null => {
    const usable: Teacher[] = [];
    for (const t of candidateList) {
      const tid = normalizeStaffPk(t.id);
      if (tid === null) continue;
      const set = teacherUsed.get(usedKey(day, periodLabel)) ?? new Set();
      if (set.has(tid)) continue;
      const [wc, dc] = teacherWeeklyDailyCaps(t, schoolPeriodsPerDay);
      if (!canUse(tid, day, wc, dc)) continue;
      usable.push(t);
    }
    if (!usable.length) return null;
    return usable.reduce((a, b) => {
      const ta = normalizeStaffPk(a.id);
      const tb = normalizeStaffPk(b.id);
      const la = teacherLoad.get(String(ta)) ?? 0;
      const lb = teacherLoad.get(String(tb)) ?? 0;
      if (la !== lb) return la < lb ? a : b;
      const ja = joiningBoost(a);
      const jb = joiningBoost(b);
      if (ja !== jb) return ja < jb ? a : b;
      const sa = staffSortKey(a.id);
      const sb = staffSortKey(b.id);
      return sa[0] !== sb[0] ? (sa[0] < sb[0] ? a : b) : (sa[1] < sb[1] ? a : b);
    });
  };

  const pickBestIgnorePeriodBusy = (candidateList: Teacher[], day: string): Teacher | null => {
    const usable: Teacher[] = [];
    for (const t of candidateList) {
      const tid = normalizeStaffPk(t.id);
      if (tid === null) continue;
      const [wc, dc] = teacherWeeklyDailyCaps(t, schoolPeriodsPerDay);
      if (!canUse(tid, day, wc, dc)) continue;
      usable.push(t);
    }
    if (!usable.length) return null;
    return usable.reduce((a, b) => {
      const ta = normalizeStaffPk(a.id);
      const tb = normalizeStaffPk(b.id);
      const la = teacherLoad.get(String(ta)) ?? 0;
      const lb = teacherLoad.get(String(tb)) ?? 0;
      if (la !== lb) return la < lb ? a : b;
      const ja = joiningBoost(a);
      const jb = joiningBoost(b);
      if (ja !== jb) return ja < jb ? a : b;
      const sa = staffSortKey(a.id);
      const sb = staffSortKey(b.id);
      return sa[0] !== sb[0] ? (sa[0] < sb[0] ? a : b) : (sa[1] < sb[1] ? a : b);
    });
  };

  const pickBestForce = (candidateList: Teacher[]): Teacher | null => {
    const usable: Teacher[] = [];
    for (const t of candidateList) {
      const tid = normalizeStaffPk(t.id);
      if (tid === null) continue;
      const role = String(t.timetable_role ?? 'subject_teacher')
        .trim()
        .toLowerCase();
      const [wc] = teacherWeeklyDailyCaps(t, schoolPeriodsPerDay);
      if (role === 'other' && wc === 0) continue;
      usable.push(t);
    }
    if (!usable.length) return null;
    return usable.reduce((a, b) => {
      const ta = normalizeStaffPk(a.id);
      const tb = normalizeStaffPk(b.id);
      const la = teacherLoad.get(String(ta)) ?? 0;
      const lb = teacherLoad.get(String(tb)) ?? 0;
      if (la !== lb) return la < lb ? a : b;
      const ja = joiningBoost(a);
      const jb = joiningBoost(b);
      if (ja !== jb) return ja < jb ? a : b;
      const sa = staffSortKey(a.id);
      const sb = staffSortKey(b.id);
      return sa[0] !== sb[0] ? (sa[0] < sb[0] ? a : b) : (sa[1] < sb[1] ? a : b);
    });
  };

  const pendingSlots: Array<[JsonValue, string, string, number, string]> = [];
  for (const cls of classes) {
    const grade = cls.grade;
    const section = String(cls.section ?? '');
    const key = `${grade}||${section}`;
    const dayLists = classTimetables.get(key) ?? [];
    for (let dayIdx = 0; dayIdx < dayLists.length; dayIdx++) {
      if (dayIdx >= daysUsed.length) break;
      const day = daysUsed[dayIdx]!;
      const daySlots = dayLists[dayIdx]!;
      for (let period1based = 0; period1based < daySlots.length; period1based++) {
        const subject = daySlots[period1based]!;
        if (!subject) continue;
        pendingSlots.push([grade, section, day, period1based + 1, subject]);
      }
    }
  }

  const specialistSupply = (subject: string): number => {
    const normSubj = normalizeSubject(subject);
    const canonSubj = canonicalSubjectNorm(normSubj);
    let byNorm = [...(teacherBySubj.get(canonSubj) ?? [])];
    if (!byNorm.length && canonSubj !== normSubj) byNorm = [...(teacherBySubj.get(normSubj) ?? [])];
    return byNorm.length;
  };

  pendingSlots.sort((a, b) => {
    const sa = specialistSupply(a[4]);
    const sb = specialistSupply(b[4]);
    const ka = sa === 0 ? 9999 : sa;
    const kb = sb === 0 ? 9999 : sb;
    if (ka !== kb) return ka - kb;
    if (a[2] !== b[2]) return String(a[2]).localeCompare(String(b[2]));
    if (a[3] !== b[3]) return a[3] - b[3];
    if (String(a[0]) !== String(b[0])) return String(a[0]).localeCompare(String(b[0]));
    return String(a[1]).localeCompare(String(b[1]));
  });

  for (const [grade, section, day, period1based, subject] of pendingSlots) {
    const periodLabel = periodLabelForIndex(period1based);
    const normSubj = normalizeSubject(subject);
    const canonSubj = canonicalSubjectNorm(normSubj);
    let byNorm = [...(teacherBySubj.get(canonSubj) ?? [])];
    if (!byNorm.length && canonSubj !== normSubj) byNorm = [...(teacherBySubj.get(normSubj) ?? [])];
    const exactSubj = byNorm.filter((t) => String(t.subject ?? '').trim() === subject);
    const candidates = exactSubj.length ? exactSubj : byNorm;
    let best = pickBest(candidates, day, periodLabel);
    if (best === null) {
      const loose = byNorm.filter(
        (t) => !teacherUsed.get(usedKey(day, periodLabel))?.has(normalizeStaffPk(t.id)!)
      );
      best = pickBest(loose, day, periodLabel);
    }
    if (best === null) {
      const exact = teachers.filter((t) => String(t.subject ?? '').trim() === subject);
      best = pickBest(exact, day, periodLabel);
    }
    if (best === null) {
      for (const pool of fallbackPools(teachers)) {
        best = pickBest(pool, day, periodLabel);
        if (best !== null) break;
      }
    }

    if (best === null) {
      const pool = dedupeTeachersById(teachers);
      best = pickBest(pool, day, periodLabel);
      if (best !== null) {
        warnings.push(
          `Coverage fallback: '${subject}' at ${day} ${periodLabel} (${grade}-${section}) ` +
            `assigned to ${String(best.name ?? 'staff')} (no specialist available).`
        );
      }
    }

    if (best === null) {
      const pool = dedupeTeachersById(teachers);
      best = pickBestIgnorePeriodBusy(pool, day);
      if (best !== null) {
        warnings.push(
          `Double-booking: ${String(best.name ?? 'staff')} at ${day} ${periodLabel} ` +
            `for '${subject}' (${grade}-${section}).`
        );
      }
    }

    if (best === null) {
      const pool = dedupeTeachersById(teachers);
      best = pickBestForce(pool);
      if (best !== null) {
        warnings.push(
          `Capacity override: ${String(best.name ?? 'staff')} for '${subject}' ` +
            `at ${day} ${periodLabel} (${grade}-${section}).`
        );
      }
    }

    if (best === null) {
      warnings.push(
        `No teacher available for subject '${subject}' at ${day} ${periodLabel} (class ${grade}-${section})`
      );
      continue;
    }
    const teacherId = normalizeStaffPk(best.id);
    const teacherName = String(best.name ?? '');
    const uk = usedKey(day, periodLabel);
    if (!teacherUsed.has(uk)) teacherUsed.set(uk, new Set());
    teacherUsed.get(uk)!.add(teacherId!);
    teacherLoad.set(String(teacherId), (teacherLoad.get(String(teacherId)) ?? 0) + 1);
    const wk = weekKey(teacherId, day);
    teacherDayCount.set(wk, (teacherDayCount.get(wk) ?? 0) + 1);
    teacherWeekCount.set(String(teacherId), (teacherWeekCount.get(String(teacherId)) ?? 0) + 1);
    entries.push({
      day,
      period: periodLabel,
      period_index: period1based,
      grade,
      section,
      subject,
      teacher_id: teacherId,
      teacher_name: teacherName,
    });
  }
  return [entries, warnings];
}

export type GenerateResult = {
  timetable: unknown[];
  by_class: Record<string, unknown>;
  entries: unknown[];
  warnings: string[];
  slot_sequence: unknown[];
};

export type GenerateOptions = {
  /** Uniform [0,1); used for shuffle when `randbelowTrace` is not set. */
  rng?: () => number;
  /**
   * CPython `Random._randbelow` pairs `[n, j]` from `scripts/dump_randbelow_trace.py`
   * for bit-identical parity with `random.seed(42)` + `generate(config)`.
   */
  randbelowTrace?: [number, number][];
};

/**
 * Main entry — same contract as Python `generate(config)`.
 * Uses `Math.random` for shuffle unless `options.randbelowTrace` or `options.rng` is set.
 */
export function generate(config: Config, options?: GenerateOptions): GenerateResult {
  const rng = options?.rng ?? Math.random;
  const trace = options?.randbelowTrace;
  const traceRef = { i: 0 };
  const shuffleItems = (items: string[]) => {
    if (trace) {
      shuffleInPlaceFromRandbelowTrace(items, trace, traceRef);
    } else {
      shuffleInPlace(items, rng);
    }
  };
  const defaultPeriods = Math.min(
    MAX_TIMETABLE_PERIODS,
    Math.max(1, parseInt(String(config.periods_per_day ?? 5), 10))
  );
  const shortBreak = Math.max(0, parseInt(String(config.short_break_minutes ?? 0), 10));
  const lunchBreak = Math.max(40, Math.min(50, parseInt(String(config.lunch_break_minutes ?? 40), 10)));
  const lunchAfter = Math.max(1, Math.min(defaultPeriods, parseInt(String(config.lunch_after_period ?? 4), 10)));
  const classes = (config.classes as ClassRow[]) ?? [];
  const teachers = (config.teachers as Teacher[]) ?? [];
  const weeklyLoad = config.weekly_load as Record<string, number> | undefined;
  const workingDays = Math.min(7, Math.max(1, parseInt(String(config.working_days ?? 5), 10)));
  const singleDay = String(config.day ?? '').trim();
  let daysUsed: string[];
  let workingDaysEff: number;
  if (singleDay && DAYS.includes(singleDay as (typeof DAYS)[number])) {
    daysUsed = [singleDay];
    workingDaysEff = 1;
  } else {
    daysUsed = [...DAYS.slice(0, workingDays)];
    workingDaysEff = workingDays;
  }

  const subjects = subjectsFromTeachers(
    teachers,
    config.subjects as Array<Record<string, JsonValue>> | undefined
  );
  if (!teachers.length) {
    return {
      timetable: [],
      by_class: {},
      entries: [],
      warnings: ['No teachers provided.'],
      slot_sequence: [],
    };
  }
  if (!subjects.length) {
    return {
      timetable: [],
      by_class: {},
      entries: [],
      warnings: ['No subjects found (teachers have no subject set).'],
      slot_sequence: [],
    };
  }

  let maxPpd = defaultPeriods;
  for (const cls of classes) {
    maxPpd = Math.max(maxPpd, classPeriodsPerDay(cls, defaultPeriods));
  }
  const lunchAfterGlobal = Math.max(
    1,
    Math.min(maxPpd, parseInt(String(config.lunch_after_period ?? lunchAfter), 10))
  );
  const slotSequence = buildSlotSequence(maxPpd, shortBreak, lunchBreak, lunchAfterGlobal);

  const classTimetables = generateClassTimetables(
    classes,
    subjects,
    workingDaysEff,
    weeklyLoad,
    defaultPeriods,
    shuffleItems
  );
  const [entries, warnings] = assignTeachers(
    classTimetables,
    classes,
    teachers,
    daysUsed,
    maxPpd
  );

  const byClass: Record<string, unknown> = {};
  for (const cls of classes) {
    const grade = cls.grade;
    const section = String(cls.section ?? '');
    const key = `${grade}||${section}`;
    const ppd = classPeriodsPerDay(cls, defaultPeriods);
    const clsSlotSequence = buildSlotSequence(
      ppd,
      shortBreak,
      lunchBreak,
      Math.min(ppd, lunchAfterGlobal)
    );
    const dayLists = classTimetables.get(key) ?? [];
    const classDays: unknown[] = [];
    for (let dayIdx = 0; dayIdx < dayLists.length; dayIdx++) {
      if (dayIdx >= daysUsed.length) break;
      const day = daysUsed[dayIdx]!;
      const daySlots = dayLists[dayIdx]!;
      const slots: unknown[] = [];
      let periodIdx = 0;
      for (const slot of clsSlotSequence) {
        if (slot.type === 'break') {
          slots.push({
            type: 'break',
            label: slot.label,
            period: slot.period,
          });
        } else {
          const subj = periodIdx < daySlots.length ? daySlots[periodIdx]! : null;
          const entry = entries.find(
            (e) =>
              e.grade === grade &&
              (e.section || '') === section &&
              e.day === day &&
              e.period_index === periodIdx + 1
          );
          slots.push({
            type: 'class',
            period: periodIdx + 1,
            label: slot.label,
            subject: subj,
            teacher_name: entry ? entry.teacher_name : null,
            teacher_id: entry ? entry.teacher_id : null,
          });
          periodIdx += 1;
        }
      }
      classDays.push({ day, slots });
    }
    byClass[`${grade}-${section}`] = classDays;
  }

  const timetableByDay: unknown[] = [];
  for (const day of daysUsed) {
    const daySlotsDisplay: unknown[] = [];
    for (const slot of slotSequence) {
      if (slot.type === 'break') {
        daySlotsDisplay.push({
          type: 'break',
          period: slot.period,
          label: slot.label,
        });
      } else {
        const period1 = slot.period!;
        const slotEntries = entries.filter((e) => e.day === day && e.period_index === period1);
        daySlotsDisplay.push({
          type: 'class',
          period: period1,
          label: slot.label,
          assignments: slotEntries.map((e) => ({
            grade: e.grade,
            section: e.section,
            subject: e.subject,
            teacher_name: e.teacher_name,
          })),
        });
      }
    }
    timetableByDay.push({ day, slots: daySlotsDisplay });
  }

  const flatEntries = entries.map((e) => ({
    teacher: e.teacher_id,
    grade: e.grade,
    section: e.section || '',
    subject: e.subject,
    day: e.day,
    period: e.period,
    room: '',
  }));

  return {
    timetable: timetableByDay,
    by_class: byClass,
    entries: flatEntries,
    warnings,
    slot_sequence: slotSequence,
  };
}
