import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertTriangle, Download, ChevronDown } from 'lucide-react';
import Layout from '../../components/Layout';
import styles from '../TimeTable.module.css';
import { staffAPI, timetableAPI, trackEvent } from '../../services/api';
import {
  buildLivePrincipalTimetableExport,
  exportTimetablePdf,
  exportTimetableTxt,
} from '../../utils/timetableExport';
import { fetchStudentsRosterQuery } from '../../hooks/useQueries';
import { useLanguage } from '../../context/LanguageContext';
import { useTranslation } from '../../utils/translations';
import { useConfirm } from '../../components/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import {
  DAYS,
  periodsSliceForSchool,
  teacherScheduleRowBackground,
  buildTeacherPeriodDoubleBookingKeys,
  teacherPeriodIsDoubleBooked,
  teacherHasDoubleBookingOnDay,
  busyTeacherIdsElsewhereInSlot,
  MAX_TIMETABLE_PERIODS,
} from './timetableUtils';
import { usePrincipalTimetableEntries } from './usePrincipalTimetableEntries';
import { invalidateTimetableQueries } from './invalidateTimetableQueries';
import PrincipalTimetableCellEditor from './PrincipalTimetableCellEditor';
import PrincipalTimetableMobileCalendar from './PrincipalTimetableMobileCalendar';
import { todayISODateLocal } from '../../utils/timetablePeriods';

function entryTeacherIdRaw(entry) {
  if (!entry) return null;
  const tid =
    typeof entry.teacher === 'object' && entry.teacher?.id != null ? entry.teacher.id : entry.teacher;
  return tid != null && tid !== '' ? tid : null;
}

function classLabelToParts(selectedClassSafe, classes) {
  const c = classes.find(
    (x) => `${x.grade}${x.section ? `-${x.section}` : ''}` === selectedClassSafe
  );
  if (!c) return null;
  const grade = String(c.grade ?? '').trim();
  if (!grade) return null;
  const section = String(c.section ?? '').trim().slice(0, 10);
  return { grade, section };
}

const DEFAULT_CFG = Object.freeze({
  periods_per_day: 7,
  lunch_after_period: 4,
  lunch_break_minutes: 40,
  working_days: 5,
  short_break_minutes: 0,
});

const SCHEDULE_CFG_STORAGE_PREFIX = 'myschool.principalTimetable.scheduleCfg.';
const MOBILE_CAL_VIEW_PREFIX = 'myschool.principalTimetable.mobileCalView.';

function readMobileCalView(username) {
  if (typeof window === 'undefined') return 'day';
  try {
    const v = window.localStorage.getItem(`${MOBILE_CAL_VIEW_PREFIX}${username || 'anon'}`);
    if (v === 'day' || v === '3day' || v === 'week' || v === 'month') return v;
  } catch { /* ignore */ }
  return 'day';
}

function writeMobileCalView(username, view) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${MOBILE_CAL_VIEW_PREFIX}${username || 'anon'}`, view);
  } catch { /* ignore */ }
}

function getScheduleCfgStorageKey(username) {
  // Scope per-username so different accounts on the same device don't clobber settings.
  return `${SCHEDULE_CFG_STORAGE_PREFIX}${username || 'anon'}`;
}

function readStoredScheduleCfg(storageKey) {
  if (typeof window === 'undefined' || !storageKey) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      periods_per_day: Number(parsed.periods_per_day) || DEFAULT_CFG.periods_per_day,
      lunch_after_period: Number(parsed.lunch_after_period) || DEFAULT_CFG.lunch_after_period,
      lunch_break_minutes: Number(parsed.lunch_break_minutes) || DEFAULT_CFG.lunch_break_minutes,
      working_days: Number(parsed.working_days) || DEFAULT_CFG.working_days,
      short_break_minutes: Number.isFinite(Number(parsed.short_break_minutes))
        ? Number(parsed.short_break_minutes)
        : DEFAULT_CFG.short_break_minutes,
    };
  } catch {
    return null;
  }
}

function writeStoredScheduleCfg(storageKey, cfg) {
  if (typeof window === 'undefined' || !storageKey) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(cfg));
  } catch {
    /* quota / private mode — ignore */
  }
}

function clearStoredScheduleCfg(storageKey) {
  if (typeof window === 'undefined' || !storageKey) return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    /* ignore */
  }
}

export default function PrincipalTimeTableRedesign() {
  const queryClient = useQueryClient();
  const { language } = useLanguage();
  const { t } = useTranslation(language);
  const confirm = useConfirm();
  const { user, hasFeature } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const storageKey = useMemo(
    () => getScheduleCfgStorageKey(user?.username),
    [user?.username]
  );

  const [activeTab, setActiveTab] = useState('setup');
  const [viewBy, setViewBy] = useState('class');
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [selectedSchoolDay, setSelectedSchoolDay] = useState(DAYS[0]);
  const [mobileCalView, setMobileCalView] = useState(() => readMobileCalView(user?.username));
  const [viewAnchorDate, setViewAnchorDate] = useState(() => todayISODateLocal());
  const [cfg, setCfg] = useState(() => {
    const stored = readStoredScheduleCfg(getScheduleCfgStorageKey(user?.username));
    return stored ? { ...DEFAULT_CFG, ...stored } : { ...DEFAULT_CFG };
  });
  const [cfgFromDevice, setCfgFromDevice] = useState(() =>
    Boolean(readStoredScheduleCfg(getScheduleCfgStorageKey(user?.username)))
  );
  const [previewData, setPreviewData] = useState(null);
  const [legendFilter, setLegendFilter] = useState('');
  const [cellEditor, setCellEditor] = useState(null);
  const [cellEditorError, setCellEditorError] = useState('');
  const [inlineNotice, setInlineNotice] = useState(null);
  const [principalExportMenuOpen, setPrincipalExportMenuOpen] = useState(false);
  const [principalExportLoading, setPrincipalExportLoading] = useState(false);
  const principalExportMenuRef = useRef(null);
  const payloadBaseRef = useRef(null);
  const defaultsSyncedRef = useRef(false);
  const cfgPersistMountRef = useRef(true);

  const { data: teachers = [], isLoading: teachersLoading } = useQuery({
    queryKey: ['timetable-teachers', 'all-pages', { category: 'Teaching' }],
    queryFn: async () => {
      const aggregated = [];
      let page = 1;
      for (;;) {
        const res = await staffAPI.getAll({ category: 'Teaching', page: String(page) });
        const data = res.data;
        if (Array.isArray(data)) {
          aggregated.push(...data);
          break;
        }
        const batch = data?.results ?? [];
        aggregated.push(...batch);
        if (!data?.next || batch.length === 0) break;
        page += 1;
        if (page > 500) break;
      }
      return aggregated;
    },
  });

  const { data: classes = [], isLoading: classesLoading } = useQuery({
    queryKey: ['timetable-classes'],
    queryFn: async () => {
      const students = await fetchStudentsRosterQuery(queryClient);
      const classMap = new Map();
      students.forEach((student) => {
        const grade = String(student.grade ?? '').trim();
        if (!grade) return;
        const section = String(student.section ?? '').trim().slice(0, 10);
        const key = `${grade}-${section}`;
        if (!classMap.has(key)) {
          classMap.set(key, { grade, section });
        }
      });
      return [...classMap.values()];
    },
  });

  const { data: schoolDefaults, isLoading: schoolDefaultsLoading } = useQuery({
    queryKey: ['timetable-school-defaults'],
    queryFn: async () => {
      const response = await timetableAPI.getSchoolDefaultsCurrent();
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const googleCalEnabled = Boolean(hasFeature && hasFeature('timetable_google_calendar'));

  const { data: bellSchedule, isLoading: bellScheduleLoading } = useQuery({
    queryKey: ['timetable-bell-schedule'],
    queryFn: async () => {
      const response = await timetableAPI.getBellScheduleCurrent();
      return response.data;
    },
    staleTime: 60 * 1000,
    retry: false,
  });

  const { data: gcalStatus, isLoading: gcalStatusLoading } = useQuery({
    queryKey: ['timetable-google-calendar-status'],
    queryFn: async () => {
      const response = await timetableAPI.getGoogleCalendarStatus();
      return response.data;
    },
    enabled: googleCalEnabled,
    staleTime: 30 * 1000,
    retry: false,
  });

  const [bellDraft, setBellDraft] = useState({});
  const [tzDraft, setTzDraft] = useState('Asia/Karachi');

  useEffect(() => {
    if (!bellSchedule) return;
    setBellDraft({ ...(bellSchedule.period_bounds || {}) });
    setTzDraft(bellSchedule.timezone || 'Asia/Karachi');
  }, [bellSchedule]);

  useEffect(() => {
    const g = searchParams.get('google_calendar');
    if (!g) return;
    if (g === 'connected') {
      setInlineNotice({ type: 'success', message: t('timetableGoogleConnected') });
      queryClient.invalidateQueries({ queryKey: ['timetable-google-calendar-status'] });
    } else if (g === 'error' || g === 'no_refresh') {
      setInlineNotice({ type: 'error', message: t('requestFailed') });
    }
    const next = new URLSearchParams(searchParams);
    next.delete('google_calendar');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, queryClient, t]);

  const saveBellMutation = useMutation({
    mutationFn: (payload) => timetableAPI.patchBellScheduleCurrent(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timetable-bell-schedule'] });
      setInlineNotice({ type: 'success', message: t('timetableBellSaved') });
    },
    onError: (err) => {
      const d = err.response?.data;
      const msg =
        (typeof d?.detail === 'string' && d.detail) ||
        (d && typeof d === 'object' ? JSON.stringify(d) : err.message);
      setInlineNotice({ type: 'error', message: msg || t('requestFailed') });
    },
  });

  const syncGoogleMutation = useMutation({
    mutationFn: () => timetableAPI.postGoogleCalendarSync({ lang: language === 'ur' ? 'ur' : 'en' }),
    onSuccess: (res) => {
      const r = res.data;
      if (r?.queued) {
        setInlineNotice({ type: 'success', message: t('timetableGoogleSyncQueued') });
      } else {
        setInlineNotice({
          type: r?.result?.ok === false ? 'error' : 'success',
          message:
            r?.result?.ok === false
              ? (Array.isArray(r.result.errors) && r.result.errors[0]) || t('requestFailed')
              : t('timetableGoogleSyncDone'),
        });
      }
    },
    onError: (err) => {
      const d = err.response?.data;
      const msg = (typeof d?.detail === 'string' && d.detail) || err.message;
      setInlineNotice({ type: 'error', message: msg || t('requestFailed') });
    },
  });

  const disconnectGoogleMutation = useMutation({
    mutationFn: () => timetableAPI.postGoogleCalendarDisconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timetable-google-calendar-status'] });
      setInlineNotice({ type: 'success', message: t('timetableGoogleDisconnected') });
    },
    onError: () => setInlineNotice({ type: 'error', message: t('requestFailed') }),
  });

  useEffect(() => {
    if (defaultsSyncedRef.current || !schoolDefaults) return;
    defaultsSyncedRef.current = true;
    // If the user has a saved local copy on this device, keep it instead of overwriting
    // with server defaults — that's the whole point of "save settings on device".
    if (cfgFromDevice) return;
    const cap = schoolDefaults.max_timetable_periods ?? MAX_TIMETABLE_PERIODS;
    const ppd = Math.min(cap, Math.max(1, schoolDefaults.default_periods_per_day ?? 7));
    // Suppress the very next write so applying server defaults doesn't mark the
    // settings as "saved on this device" until the user actually edits something.
    cfgPersistMountRef.current = true;
    setCfg((c) => ({
      ...c,
      periods_per_day: ppd,
      working_days: Math.min(7, Math.max(1, schoolDefaults.working_days ?? c.working_days)),
      lunch_break_minutes: schoolDefaults.lunch_break_minutes ?? c.lunch_break_minutes,
      lunch_after_period: Math.min(
        ppd,
        Math.max(1, schoolDefaults.lunch_after_period ?? c.lunch_after_period)
      ),
      short_break_minutes: schoolDefaults.short_break_minutes ?? c.short_break_minutes ?? 0,
    }));
  }, [schoolDefaults, cfgFromDevice]);

  useEffect(() => {
    // Skip the very first run so the write effect doesn't race the schoolDefaults sync
    // for users who don't yet have a stored copy.
    if (cfgPersistMountRef.current) {
      cfgPersistMountRef.current = false;
      return;
    }
    writeStoredScheduleCfg(storageKey, cfg);
    setCfgFromDevice(true);
  }, [cfg, storageKey]);

  // Persist the calendar view choice so it survives navigation.
  useEffect(() => {
    writeMobileCalView(user?.username, mobileCalView);
  }, [mobileCalView, user?.username]);

  const capPeriods = schoolDefaults?.max_timetable_periods ?? MAX_TIMETABLE_PERIODS;

  const { data: classConfigs = [] } = useQuery({
    queryKey: ['timetable-class-configs'],
    queryFn: async () => {
      const response = await timetableAPI.getClassConfigs();
      const data = response.data;
      return Array.isArray(data) ? data : (data?.results ?? []);
    },
    staleTime: 2 * 60 * 1000,
    retry: false,
  });

  const classPeriodMap = useMemo(() => {
    const m = new Map();
    classConfigs.forEach((c) => m.set(`${c.grade}|${c.section || ''}`, c));
    return m;
  }, [classConfigs]);

  const { data: entries = [], isLoading: entriesLoading } = usePrincipalTimetableEntries({
    timeScope: 'week',
    masterDayParam: null,
  });

  const { data: conflictsResponse } = useQuery({
    queryKey: ['timetable', 'conflicts', 'principal'],
    queryFn: async () => {
      const res = await timetableAPI.getConflicts();
      return res.data;
    },
    staleTime: 60 * 1000,
    retry: false,
  });

  const conflictsList = useMemo(
    () => conflictsResponse?.conflicts ?? [],
    [conflictsResponse]
  );
  const conflictCount = conflictsList.length;

  const buildGeneratePayload = useCallback(() => {
    const globalPpd = Math.min(capPeriods, Math.max(1, Number(cfg.periods_per_day) || 5));
    const lunchAfter = Math.min(globalPpd, Math.max(1, Number(cfg.lunch_after_period) || 4));
    const lunchBreak = Math.min(50, Math.max(40, Number(cfg.lunch_break_minutes) || 40));
    const workingDays = Math.min(7, Math.max(1, Number(cfg.working_days) || 5));
    const classesPayload = classes.map((c) => {
      const k = `${c.grade}|${c.section || ''}`;
      const row = classPeriodMap.get(k);
      const per = row?.periods_per_day;
      return {
        grade: c.grade,
        section: c.section || '',
        periods_per_day: per != null ? Math.max(Number(per) || globalPpd, globalPpd) : globalPpd,
      };
    });
    const teachersPayload = teachers.map((te) => ({
      id: te.id,
      name: te.name,
      subject: te.subject || '',
      timetable_role: te.timetable_role,
      max_weekly_teaching_periods: te.max_weekly_teaching_periods,
      max_daily_teaching_periods: te.max_daily_teaching_periods,
      joining_date: te.joining_date,
    }));
    return {
      periods_per_day: globalPpd,
      lunch_break_minutes: lunchBreak,
      lunch_after_period: lunchAfter,
      working_days: workingDays,
      short_break_minutes: Math.max(0, Number(cfg.short_break_minutes) || 0),
      classes: classesPayload,
      teachers: teachersPayload,
    };
  }, [capPeriods, cfg, classes, classPeriodMap, teachers]);

  const previewMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await timetableAPI.generate({ ...payload, save: false });
      return res.data;
    },
    onSuccess: (data) => {
      setPreviewData({ warnings: Array.isArray(data?.warnings) ? data.warnings : [] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await timetableAPI.generate({ ...payload, save: true });
      await timetableAPI.putSchoolDefaultsCurrent({
        default_periods_per_day: payload.periods_per_day,
        working_days: payload.working_days,
        lunch_break_minutes: payload.lunch_break_minutes,
        lunch_after_period: payload.lunch_after_period,
        short_break_minutes: payload.short_break_minutes ?? 0,
      });
      return res.data;
    },
    onSuccess: () => {
      invalidateTimetableQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['timetable-school-defaults'] });
      queryClient.invalidateQueries({ queryKey: ['timetable', 'conflicts', 'principal'] });
      setPreviewData(null);
      payloadBaseRef.current = null;
      setActiveTab('timetable');
    },
  });

  const handleGeneratePreview = async () => {
    const ok = await confirm({
      title: t('timeTable'),
      description: t('timetableGenerateReplaceWarning'),
    });
    if (!ok) return;
    const payload = buildGeneratePayload();
    payloadBaseRef.current = payload;
    setPreviewData(null);
    previewMutation.mutate(payload);
  };

  const handleSaveGenerated = () => {
    const base = payloadBaseRef.current;
    if (!base) return;
    saveMutation.mutate(base);
  };

  const handleResetScheduleSettings = useCallback(() => {
    const sd = schoolDefaults;
    const cap = sd?.max_timetable_periods ?? MAX_TIMETABLE_PERIODS;
    const ppd = Math.min(
      cap,
      Math.max(1, sd?.default_periods_per_day ?? DEFAULT_CFG.periods_per_day)
    );
    const next = {
      periods_per_day: ppd,
      working_days: Math.min(7, Math.max(1, sd?.working_days ?? DEFAULT_CFG.working_days)),
      lunch_break_minutes: sd?.lunch_break_minutes ?? DEFAULT_CFG.lunch_break_minutes,
      lunch_after_period: Math.min(
        ppd,
        Math.max(1, sd?.lunch_after_period ?? DEFAULT_CFG.lunch_after_period)
      ),
      short_break_minutes: sd?.short_break_minutes ?? DEFAULT_CFG.short_break_minutes,
    };
    clearStoredScheduleCfg(storageKey);
    // Skip the next persistence run so we don't re-save what we just cleared.
    cfgPersistMountRef.current = true;
    setCfg(next);
    setCfgFromDevice(false);
  }, [schoolDefaults, storageKey]);

  const handleClassPeriodBlur = async (classItem, rawValue) => {
    const globalPpd = Math.min(capPeriods, Math.max(1, Number(cfg.periods_per_day) || 5));
    const v = Math.min(capPeriods, Math.max(1, parseInt(rawValue, 10) || globalPpd));
    const k = `${classItem.grade}|${classItem.section || ''}`;
    const existing = classPeriodMap.get(k);
    try {
      if (existing?.id != null) {
        await timetableAPI.updateClassConfig(existing.id, { periods_per_day: v });
      } else {
        await timetableAPI.createClassConfig({
          grade: classItem.grade,
          section: classItem.section || '',
          periods_per_day: v,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['timetable-class-configs'] });
      setInlineNotice({ type: 'success', message: t('timetableClassPeriodSaved') });
    } catch (err) {
      console.error('Class timetable config save failed', err);
      setInlineNotice({ type: 'error', message: t('timetableClassPeriodSaveFailed') });
    }
  };

  const classNames = useMemo(
    () => classes.map((c) => `${c.grade}${c.section ? `-${c.section}` : ''}`),
    [classes]
  );

  const days = useMemo(() => DAYS.slice(0, cfg.working_days), [cfg.working_days]);

  useEffect(() => {
    if (!days.includes(selectedSchoolDay)) {
      setSelectedSchoolDay(days[0] || DAYS[0]);
    }
  }, [days, selectedSchoolDay]);

  const periodsSlice = useMemo(
    () => periodsSliceForSchool(entries, cfg.periods_per_day, capPeriods),
    [entries, cfg.periods_per_day, capPeriods]
  );

  /** Same period columns as the weekly grid for every class in exports (see plan). */
  const periodsForClassExport = useCallback(() => periodsSlice, [periodsSlice]);

  const selectedClassSafe = selectedClass || classNames[0] || '';
  const selectedTeacherIdSafe =
    selectedTeacher || (teachers[0]?.id != null ? String(teachers[0].id) : '');

  const teacherOptionLabel = useMemo(() => {
    return (te) => {
      const dup = teachers.filter((x) => x.name === te.name).length > 1;
      return dup ? `${te.name} (#${te.id})` : te.name;
    };
  }, [teachers]);

  /** Teaching staff on roster plus any staff referenced only on saved timetable rows (edge cases). */
  const timetableStaffRoster = useMemo(() => {
    const byId = new Map(teachers.map((s) => [String(s.id), s]));
    entries.forEach((e) => {
      const tch = e?.teacher;
      if (tch && typeof tch === 'object' && tch.id != null && !byId.has(String(tch.id))) {
        byId.set(String(tch.id), {
          id: tch.id,
          name: tch.name || `Staff #${tch.id}`,
        });
      }
    });
    return [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [teachers, entries]);

  const cellEditorBusyTeacherIdsElsewhere = useMemo(() => {
    if (!cellEditor?.day || !cellEditor?.periodKey) return new Set();
    const excludeIds = (cellEditor.entries || []).map((e) => e.id).filter((id) => id != null);
    return busyTeacherIdsElsewhereInSlot(
      entries,
      cellEditor.day,
      cellEditor.periodKey,
      excludeIds
    );
  }, [cellEditor, entries]);

  const cellEditorFreeTeachers = useMemo(
    () =>
      timetableStaffRoster.filter((te) => !cellEditorBusyTeacherIdsElsewhere.has(String(te.id))),
    [timetableStaffRoster, cellEditorBusyTeacherIdsElsewhere]
  );

  const workloadLabelForId = useMemo(() => {
    return (teacherId) => {
      const te = teachers.find((x) => String(x.id) === String(teacherId));
      if (!te) return String(teacherId);
      return teacherOptionLabel(te);
    };
  }, [teachers, teacherOptionLabel]);

  const teacherNameById = useMemo(() => {
    const map = new Map();
    teachers.forEach((te) => map.set(String(te.id), te.name));
    return map;
  }, [teachers]);

  const getTeacherNameForExport = useCallback(
    (entry) => {
      if (!entry) return '';
      if (typeof entry.teacher === 'object' && entry.teacher?.name) return entry.teacher.name;
      const tid = typeof entry.teacher === 'object' ? entry.teacher?.id : entry.teacher;
      return teacherNameById.get(String(tid)) || '';
    },
    [teacherNameById]
  );

  const doubleBookKeys = useMemo(() => buildTeacherPeriodDoubleBookingKeys(entries), [entries]);

  const classDayPeriodEntriesMap = useMemo(() => {
    const map = new Map();
    entries.forEach((e) => {
      const cls = `${e.grade}${e.section ? `-${e.section}` : ''}`;
      const k = `${cls}|${e.day}|${e.period}`;
      const prev = map.get(k) || [];
      map.set(k, [...prev, e]);
    });
    return map;
  }, [entries]);

  const teacherDayPeriodEntriesMap = useMemo(() => {
    const map = new Map();
    entries.forEach((e) => {
      const tid =
        typeof e.teacher === 'object' && e.teacher?.id != null
          ? String(e.teacher.id)
          : String(e.teacher ?? '');
      if (!tid) return;
      const key = `${tid}|${e.day}|${e.period}`;
      const prev = map.get(key) || [];
      map.set(key, [...prev, e]);
    });
    return map;
  }, [entries]);

  const schoolDayCellMap = useMemo(() => {
    const m = new Map();
    entries.forEach((e) => {
      if (e.day !== selectedSchoolDay) return;
      const tid =
        typeof e.teacher === 'object' && e.teacher?.id != null
          ? String(e.teacher.id)
          : String(e.teacher ?? '');
      if (!tid) return;
      const key = `${tid}|${e.period}`;
      const prev = m.get(key) || [];
      m.set(key, [...prev, e]);
    });
    return m;
  }, [entries, selectedSchoolDay]);

  const conflictKeysForSchoolDay = useMemo(() => {
    const s = new Set();
    conflictsList.forEach((c) => {
      if (c.day === selectedSchoolDay && c.teacher_id != null && c.period) {
        s.add(`${c.teacher_id}|${c.period}`);
      }
    });
    return s;
  }, [conflictsList, selectedSchoolDay]);

  const sortedTeachersForSchoolDay = useMemo(
    () => [...teachers].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [teachers]
  );

  // Build a "<class>|<period>" -> entries[] map filtered to the selected school day,
  // so the per-class school-day table can render one row per class with teacher-colored cells.
  const schoolDayClassCellMap = useMemo(() => {
    const m = new Map();
    entries.forEach((e) => {
      if (e.day !== selectedSchoolDay) return;
      const cls = `${e.grade}${e.section ? `-${e.section}` : ''}`;
      if (!cls) return;
      const key = `${cls}|${e.period}`;
      const prev = m.get(key) || [];
      m.set(key, [...prev, e]);
    });
    return m;
  }, [entries, selectedSchoolDay]);

  const sortedClassesForSchoolDay = useMemo(() => {
    return [...classes].sort((a, b) => {
      const gA = String(a.grade || '');
      const gB = String(b.grade || '');
      const numA = parseInt(gA, 10);
      const numB = parseInt(gB, 10);
      const bothNumeric = !Number.isNaN(numA) && !Number.isNaN(numB);
      if (bothNumeric && numA !== numB) return numA - numB;
      const gradeCmp = gA.localeCompare(gB);
      if (gradeCmp !== 0) return gradeCmp;
      return String(a.section || '').localeCompare(String(b.section || ''));
    });
  }, [classes]);

  const workload = useMemo(() => {
    const counts = {};
    teachers.forEach((te) => {
      counts[String(te.id)] = 0;
    });
    entries.forEach((e) => {
      const tid =
        typeof e.teacher === 'object' && e.teacher?.id != null
          ? String(e.teacher.id)
          : String(e.teacher ?? '');
      if (tid) counts[tid] = (counts[tid] || 0) + 1;
    });
    return counts;
  }, [entries, teachers]);

  const loading =
    teachersLoading || classesLoading || schoolDefaultsLoading || bellScheduleLoading;

  const globalPpdUi = Math.min(capPeriods, Math.max(1, Number(cfg.periods_per_day) || 5));

  const requiredBellKeys = useMemo(() => {
    if (Array.isArray(bellSchedule?.required_period_keys) && bellSchedule.required_period_keys.length) {
      return bellSchedule.required_period_keys;
    }
    const n = Math.min(capPeriods, globalPpdUi);
    return [...Array(n)].map((_, i) => `Period ${i + 1}`);
  }, [bellSchedule, capPeriods, globalPpdUi]);

  const handleBellFieldChange = useCallback((periodKey, field, value) => {
    setBellDraft((prev) => ({
      ...prev,
      [periodKey]: { ...(prev[periodKey] || {}), [field]: value },
    }));
  }, []);

  const handleSaveBellSchedule = useCallback(() => {
    saveBellMutation.mutate({ period_bounds: bellDraft, timezone: tzDraft });
  }, [bellDraft, tzDraft, saveBellMutation]);

  const handleConnectGoogle = useCallback(async () => {
    try {
      const res = await timetableAPI.getGoogleCalendarAuthorizeUrl();
      const url = res.data?.authorization_url;
      if (url) window.location.assign(url);
    } catch {
      setInlineNotice({ type: 'error', message: t('requestFailed') });
    }
  }, [t]);

  const maxWorkload = Math.max(...Object.values(workload), 1);

  const filteredLegendTeachers = useMemo(() => {
    const q = legendFilter.trim().toLowerCase();
    return sortedTeachersForSchoolDay.filter((te) =>
      q ? String(te.name).toLowerCase().includes(q) : true
    );
  }, [sortedTeachersForSchoolDay, legendFilter]);

  const periodLabelForKey = useCallback(
    (periodKey) => {
      const i = periodsSlice.findIndex((p) => p.key === periodKey);
      return i >= 0 ? String(i + 1) : periodKey;
    },
    [periodsSlice]
  );

  const cellMutation = useMutation({
    mutationFn: async ({ op, id, payload }) => {
      if (op === 'create') return timetableAPI.create(payload);
      if (op === 'patch') return timetableAPI.patch(id, payload);
      if (op === 'delete') return timetableAPI.delete(id);
      throw new Error('Invalid timetable mutation');
    },
    onSuccess: () => {
      invalidateTimetableQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['timetable-teachers'] });
      setCellEditorError('');
      setCellEditor(null);
    },
    onError: (err) => {
      const d = err.response?.data;
      let msg =
        (typeof d?.detail === 'string' && d.detail) ||
        (typeof err.message === 'string' && err.message) ||
        '';
      if (!msg && d && typeof d === 'object') {
        msg = Object.entries(d)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
          .join('; ');
      }
      setCellEditorError(msg || 'Request failed');
      setInlineNotice({ type: 'error', message: msg || t('requestFailed') });
    },
  });

  const handleCellSaveRow = useCallback(
    async (entryId, patchOrFull) => {
      setCellEditorError('');
      try {
        if (entryId == null) {
          await cellMutation.mutateAsync({ op: 'create', payload: patchOrFull });
        } else {
          await cellMutation.mutateAsync({ op: 'patch', id: entryId, payload: patchOrFull });
        }
        setInlineNotice({ type: 'success', message: t('timetableCellSaveSuccess') });
      } catch {
        /* surfaced via onError */
      }
    },
    [cellMutation, t]
  );

  const handleCellDeleteRow = useCallback(
    async (entryId) => {
      const ok = await confirm({
        title: t('timetableCellDeleteConfirmTitle'),
        description: t('timetableCellDeleteConfirmBody'),
        variant: 'danger',
      });
      if (!ok) return;
      setCellEditorError('');
      try {
        await cellMutation.mutateAsync({ op: 'delete', id: entryId });
        setInlineNotice({ type: 'success', message: t('timetableCellDeleteSuccess') });
      } catch {
        /* onError */
      }
    },
    [cellMutation, confirm, t]
  );

  const openClassTimetableCell = useCallback(
    (day, periodKey) => {
      const parts = classLabelToParts(selectedClassSafe, classes);
      if (!parts?.grade) return;
      setCellEditorError('');
      setCellEditor({
        day,
        periodKey,
        periodLabel: periodLabelForKey(periodKey),
        grade: parts.grade,
        section: parts.section,
        entries: classDayPeriodEntriesMap.get(`${selectedClassSafe}|${day}|${periodKey}`) || [],
      });
    },
    [selectedClassSafe, classes, classDayPeriodEntriesMap, periodLabelForKey]
  );

  const openTeacherTimetableCell = useCallback(
    (day, periodKey) => {
      const entriesList =
        teacherDayPeriodEntriesMap.get(`${selectedTeacherIdSafe}|${day}|${periodKey}`) || [];
      setCellEditorError('');
      setCellEditor({
        day,
        periodKey,
        periodLabel: periodLabelForKey(periodKey),
        grade: null,
        section: null,
        entries: entriesList,
      });
    },
    [selectedTeacherIdSafe, teacherDayPeriodEntriesMap, periodLabelForKey]
  );

  const openSchoolDayTeacherCell = useCallback(
    (periodKey, entriesList) => {
      setCellEditorError('');
      setCellEditor({
        day: selectedSchoolDay,
        periodKey,
        periodLabel: periodLabelForKey(periodKey),
        grade: null,
        section: null,
        entries: entriesList,
      });
    },
    [selectedSchoolDay, periodLabelForKey]
  );

  const openSchoolDayClassCell = useCallback(
    (periodKey, classItem, entriesList) => {
      const grade = String(classItem?.grade ?? '').trim();
      const section = String(classItem?.section ?? '').trim().slice(0, 10);
      if (!grade) return;
      setCellEditorError('');
      setCellEditor({
        day: selectedSchoolDay,
        periodKey,
        periodLabel: periodLabelForKey(periodKey),
        grade,
        section,
        entries: entriesList,
      });
    },
    [selectedSchoolDay, periodLabelForKey]
  );

  const openCell = useCallback(
    (day, periodKey) => {
      if (viewBy === 'class') {
        openClassTimetableCell(day, periodKey);
      } else {
        openTeacherTimetableCell(day, periodKey);
      }
    },
    [viewBy, openClassTimetableCell, openTeacherTimetableCell]
  );

  const principalMobileSlot = (day, periodKey) => {
    if (viewBy === 'class') {
      const list = classDayPeriodEntriesMap.get(`${selectedClassSafe}|${day}|${periodKey}`) || [];
      const multiSlot = list.length > 1;
      const blocks =
        list.length === 0
          ? [{ key: 'empty', subject: '-', detail: '' }]
          : list.map((e, i) => {
              const teacherName =
                typeof e.teacher === 'object'
                  ? e.teacher?.name
                  : teacherNameById.get(String(e.teacher));
              const tid = entryTeacherIdRaw(e);
              return {
                key: `${e.id}-${i}`,
                subject: e.subject || '-',
                detail: teacherName || '',
                teacherConflict:
                  tid != null && teacherPeriodIsDoubleBooked(doubleBookKeys, tid, day, periodKey),
              };
            });
      const teacherConflict = blocks.some((b) => b.teacherConflict);
      return {
        conflict: multiSlot || teacherConflict,
        blocks,
      };
    }
    const entriesList =
      teacherDayPeriodEntriesMap.get(`${selectedTeacherIdSafe}|${day}|${periodKey}`) || [];
    if (entriesList.length === 0) {
      return { conflict: false, blocks: [{ key: 'empty', subject: '-', detail: '' }] };
    }
    const multi = entriesList.length > 1;
    const tid0 = entryTeacherIdRaw(entriesList[0]);
    const crossConflict =
      tid0 != null && teacherPeriodIsDoubleBooked(doubleBookKeys, tid0, day, periodKey);
    return {
      conflict: multi || crossConflict,
      blocks: entriesList.map((e, i) => {
        const cls = `${e.grade}${e.section ? `-${e.section}` : ''}`;
        return { key: `${e.id}-${i}`, subject: e.subject || '-', detail: cls };
      }),
    };
  };

  const handlePrincipalExport = useCallback(
    async (kind) => {
      const stamp = new Date().toISOString().slice(0, 10);
      let viewByMode;
      let classRows = [];
      let teacherRows = [];
      let fileSlug;

      if (kind === 'all-classes-pdf' || kind === 'all-classes-txt') {
        viewByMode = 'class';
        classRows = sortedClassesForSchoolDay;
        fileSlug = 'classes';
      } else if (kind === 'all-teachers-pdf' || kind === 'all-teachers-txt') {
        viewByMode = 'teacher';
        teacherRows = sortedTeachersForSchoolDay;
        fileSlug = 'teachers';
      } else if (kind === 'current-class-pdf' || kind === 'current-class-txt') {
        viewByMode = 'class';
        const parts = classLabelToParts(selectedClassSafe, classes);
        if (parts) classRows = [{ grade: parts.grade, section: parts.section }];
        fileSlug = `class-${(selectedClassSafe || 'unknown').replace(/[^\w.-]+/g, '_')}`;
      } else if (kind === 'current-teacher-pdf' || kind === 'current-teacher-txt') {
        viewByMode = 'teacher';
        const te = teachers.find((x) => String(x.id) === String(selectedTeacherIdSafe));
        if (te) teacherRows = [te];
        const nm = te?.name || selectedTeacherIdSafe || 'teacher';
        fileSlug = `teacher-${String(nm).replace(/\s+/g, '-').replace(/[^\w.-]+/g, '_')}`;
      } else {
        return;
      }

      if (viewByMode === 'class' && classRows.length === 0) return;
      if (viewByMode === 'teacher' && teacherRows.length === 0) return;

      const ext = kind.endsWith('pdf') ? 'pdf' : 'txt';
      const filename = `timetable-${fileSlug}-${stamp}.${ext}`;

      setPrincipalExportLoading(true);
      try {
        const payload = buildLivePrincipalTimetableExport({
          viewBy: viewByMode,
          timeScope: 'week',
          masterDayParam: null,
          days,
          classRows,
          teacherRows,
          entries,
          periodsForClass: periodsForClassExport,
          teacherPeriodsSlice: periodsSlice,
          getTeacherName: getTeacherNameForExport,
          labels: {
            break: t('timetableBreakLabel'),
          },
        });
        if (ext === 'pdf') {
          await exportTimetablePdf(payload, filename, {
            schoolLogoDataUrl: user?.school_picture ?? null,
            timetableRowKind: viewByMode === 'teacher' ? 'teacher' : 'class',
            labels: {
              classPrefix: t('timetableExportClassPrefix'),
              weeklyTimetable: t('timetableExportWeeklyTimetable'),
              periodWord: t('timetableExportPeriodsWord'),
              dayWord: t('timetableExportDaysWord'),
              breakLabel: t('timetableBreakLabel'),
              generatedOn: t('timetableExportGeneratedOn'),
              generatedBy: t('timetableExportGeneratedBy'),
              schoolName: t('school'),
            },
            metadata: {
              generatedBy: user?.username || '',
            },
          });
        } else {
          exportTimetableTxt(payload, filename, {
            labels: {
              classPrefix: t('timetableExportClassPrefix'),
              breakLabel: t('timetableBreakLabel'),
              generatedOn: t('timetableExportGeneratedOn'),
              generatedBy: t('timetableExportGeneratedBy'),
            },
            metadata: {
              generatedBy: user?.username || '',
            },
          });
        }
        trackEvent('form_submit', 'timetable_principal_export');
      } catch (err) {
        console.error('Principal timetable export failed', err);
      } finally {
        setPrincipalExportLoading(false);
        setPrincipalExportMenuOpen(false);
      }
    },
    [
      sortedClassesForSchoolDay,
      sortedTeachersForSchoolDay,
      selectedClassSafe,
      selectedTeacherIdSafe,
      classes,
      teachers,
      days,
      entries,
      periodsSlice,
      periodsForClassExport,
      getTeacherNameForExport,
      user?.school_picture,
      user?.username,
      t,
    ]
  );

  useEffect(() => {
    if (!principalExportMenuOpen) return;
    const close = (e) => {
      if (principalExportMenuRef.current && !principalExportMenuRef.current.contains(e.target)) {
        setPrincipalExportMenuOpen(false);
      }
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [principalExportMenuOpen]);

  if (loading) {
    return (
      <Layout title={t('timeTable')}>
        <div
          className={styles.loadingState}
          role="status"
          aria-busy="true"
          aria-live="polite"
        >
          <Loader2 className={styles.loaderIcon} aria-hidden />
          <span>{t('timetableRedesignLoading')}</span>
        </div>
      </Layout>
    );
  }

  const canExportAllClasses = sortedClassesForSchoolDay.length > 0;
  const canExportAllTeachers = sortedTeachersForSchoolDay.length > 0;
  const canExportCurrentClass = Boolean(classLabelToParts(selectedClassSafe, classes));
  const canExportCurrentTeacher = Boolean(
    teachers.some((x) => String(x.id) === String(selectedTeacherIdSafe))
  );

  const principalExportBar = (
    <div className={styles.teacherExportWrap} ref={principalExportMenuRef}>
      <button
        type="button"
        className={styles.teacherExportBtn}
        onClick={() => setPrincipalExportMenuOpen((prev) => !prev)}
        aria-expanded={principalExportMenuOpen}
        aria-haspopup="true"
        aria-label={t('timetablePrincipalExportAria')}
        disabled={principalExportLoading}
      >
        {principalExportLoading ? (
          <Loader2 size={18} className={styles.spin} aria-hidden />
        ) : (
          <Download size={18} aria-hidden />
        )}
        <span>{t('export')}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {principalExportMenuOpen && (
        <div className={styles.teacherExportDropdown} role="menu">
          <div className={styles.principalExportDropdownSection} role="presentation">
            {t('timetableExportSectionAll')}
          </div>
          <button
            type="button"
            className={styles.teacherExportDropdownItem}
            role="menuitem"
            disabled={!canExportAllClasses}
            onClick={() => handlePrincipalExport('all-classes-pdf')}
          >
            {t('timetableExportAllClassesPdf')}
          </button>
          <button
            type="button"
            className={styles.teacherExportDropdownItem}
            role="menuitem"
            disabled={!canExportAllClasses}
            onClick={() => handlePrincipalExport('all-classes-txt')}
          >
            {t('timetableExportAllClassesTxt')}
          </button>
          <button
            type="button"
            className={styles.teacherExportDropdownItem}
            role="menuitem"
            disabled={!canExportAllTeachers}
            onClick={() => handlePrincipalExport('all-teachers-pdf')}
          >
            {t('timetableExportAllTeachersPdf')}
          </button>
          <button
            type="button"
            className={styles.teacherExportDropdownItem}
            role="menuitem"
            disabled={!canExportAllTeachers}
            onClick={() => handlePrincipalExport('all-teachers-txt')}
          >
            {t('timetableExportAllTeachersTxt')}
          </button>
          {activeTab === 'timetable' ? (
            <>
              <div className={styles.principalExportDropdownSection} role="presentation">
                {t('timetableExportSectionCurrent')}
              </div>
              {viewBy === 'class' ? (
                <>
                  <button
                    type="button"
                    className={styles.teacherExportDropdownItem}
                    role="menuitem"
                    disabled={!canExportCurrentClass}
                    onClick={() => handlePrincipalExport('current-class-pdf')}
                  >
                    {t('timetableExportCurrentClassPdf')}
                  </button>
                  <button
                    type="button"
                    className={styles.teacherExportDropdownItem}
                    role="menuitem"
                    disabled={!canExportCurrentClass}
                    onClick={() => handlePrincipalExport('current-class-txt')}
                  >
                    {t('timetableExportCurrentClassTxt')}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.teacherExportDropdownItem}
                    role="menuitem"
                    disabled={!canExportCurrentTeacher}
                    onClick={() => handlePrincipalExport('current-teacher-pdf')}
                  >
                    {t('timetableExportCurrentTeacherPdf')}
                  </button>
                  <button
                    type="button"
                    className={styles.teacherExportDropdownItem}
                    role="menuitem"
                    disabled={!canExportCurrentTeacher}
                    onClick={() => handlePrincipalExport('current-teacher-txt')}
                  >
                    {t('timetableExportCurrentTeacherTxt')}
                  </button>
                </>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );

  return (
    <Layout title={t('timeTable')} breadcrumbRight={principalExportBar}>
      <div className={styles.timeTable}>
        <h1 className={styles.title}>{t('timetableRedesignTitle')}</h1>
        <p className={styles.subtitle}>{t('timetableRedesignSubtitle')}</p>
        {inlineNotice ? (
          <p
            className={inlineNotice.type === 'error' ? styles.ttErrorText : styles.ttSuccessText}
            role="status"
          >
            {inlineNotice.message}
          </p>
        ) : null}

        {conflictCount > 0 && (
          <div className={styles.ttConflictBanner} role="status">
            <AlertTriangle className={styles.ttConflictBannerIcon} aria-hidden />
            <div>
              <strong>{t('timetableConflicts')}</strong>
              <p className={styles.ttConflictBannerText}>
                {t('timetableConflictsIntro')} ({conflictCount})
              </p>
            </div>
            <button
              type="button"
              className={styles.ttConflictBannerBtn}
              onClick={() => setActiveTab('schoolday')}
            >
              {t('timetableConflictsReview')}
            </button>
          </div>
        )}

        <div className={styles.ttTabs} role="tablist" aria-label={t('timeTable')}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'setup'}
            id="tt-tab-setup"
            className={activeTab === 'setup' ? styles.ttTabActive : styles.ttTab}
            onClick={() => setActiveTab('setup')}
          >
            {t('timetableTabSetup')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'timetable'}
            id="tt-tab-timetable"
            className={activeTab === 'timetable' ? styles.ttTabActive : styles.ttTab}
            onClick={() => setActiveTab('timetable')}
          >
            {t('timetableTabTimetableView')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'schoolday'}
            id="tt-tab-schoolday"
            className={activeTab === 'schoolday' ? styles.ttTabActive : styles.ttTab}
            onClick={() => setActiveTab('schoolday')}
          >
            {t('timetableTabSchoolDay')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'workload'}
            id="tt-tab-workload"
            className={activeTab === 'workload' ? styles.ttTabActive : styles.ttTab}
            onClick={() => setActiveTab('workload')}
          >
            {t('timetableTabWorkload')}
          </button>
        </div>

        {activeTab === 'setup' && (
          <section className={styles.ttSection} role="tabpanel" aria-labelledby="tt-tab-setup">
            <div className={styles.ttStatsGrid}>
              <div className={styles.ttStatCard}>
                <strong>{teachers.length}</strong>
                <span>{t('timetableStatTeachers')}</span>
              </div>
              <div className={styles.ttStatCard}>
                <strong>{classNames.length}</strong>
                <span>{t('timetableStatClasses')}</span>
              </div>
              <div className={styles.ttStatCard}>
                <strong>{new Set(teachers.map((te) => te.subject).filter(Boolean)).size}</strong>
                <span>{t('timetableStatSubjects')}</span>
              </div>
              <div className={styles.ttStatCard}>
                <strong>{globalPpdUi * cfg.working_days}</strong>
                <span>{t('timetableStatSlotsWeek')}</span>
              </div>
            </div>

            <div className={styles.ttCard}>
              <h3>{t('timetableBellScheduleTitle')}</h3>
              <p className={styles.ttHelpMuted}>{t('timetableBellScheduleHelp')}</p>
              <div className={styles.ttSubjectRow}>
                <label htmlFor="tt-bell-tz">{t('timetableBellTimezone')}</label>
                <input
                  id="tt-bell-tz"
                  className={styles.ttInput}
                  value={tzDraft}
                  onChange={(e) => setTzDraft(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t('timetableBellTimezone')}
                />
              </div>
              <div className={styles.ttTableWrap}>
                <table className={styles.ttCompactTable}>
                  <thead>
                    <tr>
                      <th scope="col">{t('timetablePeriodColumn')}</th>
                      <th scope="col">Start</th>
                      <th scope="col">End</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requiredBellKeys.map((pk) => (
                      <tr key={pk}>
                        <td>{pk}</td>
                        <td>
                          <input
                            type="text"
                            className={styles.ttInputSmall}
                            value={(bellDraft[pk] && bellDraft[pk].start) || ''}
                            onChange={(e) => handleBellFieldChange(pk, 'start', e.target.value)}
                            placeholder="08:00"
                            inputMode="numeric"
                            aria-label={`${pk} start`}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            className={styles.ttInputSmall}
                            value={(bellDraft[pk] && bellDraft[pk].end) || ''}
                            onChange={(e) => handleBellFieldChange(pk, 'end', e.target.value)}
                            placeholder="08:45"
                            inputMode="numeric"
                            aria-label={`${pk} end`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.ttGenerateActions}>
                <button
                  type="button"
                  className={styles.ttSaveGeneratedBtn}
                  disabled={saveBellMutation.isPending}
                  onClick={handleSaveBellSchedule}
                >
                  {t('timetableBellSave')}
                </button>
              </div>
            </div>

            {googleCalEnabled ? (
              <div className={styles.ttCard}>
                <h3>{t('timetableGoogleCalendarTitle')}</h3>
                <p className={styles.ttHelpMuted}>{t('timetableGoogleCalendarHelp')}</p>
                {gcalStatusLoading ? (
                  <p className={styles.ttHelpMuted}>{t('loading')}</p>
                ) : !gcalStatus?.oauth_configured ? (
                  <p className={styles.ttHelpMuted}>{t('timetableGoogleNotConfigured')}</p>
                ) : !gcalStatus?.connected ? (
                  <div className={styles.ttGenerateActions}>
                    <button
                      type="button"
                      className={styles.ttSaveGeneratedBtn}
                      onClick={handleConnectGoogle}
                    >
                      {t('timetableGoogleConnect')}
                    </button>
                  </div>
                ) : (
                  <>
                    {gcalStatus.organizer_email ? (
                      <p className={styles.ttHelpMuted}>
                        {gcalStatus.organizer_email}
                      </p>
                    ) : null}
                    <div className={styles.ttGenerateActions}>
                      <button
                        type="button"
                        className={styles.ttSaveGeneratedBtn}
                        disabled={syncGoogleMutation.isPending}
                        onClick={() => syncGoogleMutation.mutate()}
                      >
                        {t('timetableGoogleSync')}
                      </button>
                      <button
                        type="button"
                        className={styles.ttLinkButton}
                        style={{ marginLeft: 'var(--spacing-md)' }}
                        disabled={disconnectGoogleMutation.isPending}
                        onClick={() => disconnectGoogleMutation.mutate()}
                      >
                        {t('timetableGoogleDisconnect')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : null}

            <div className={styles.ttSetupGrid}>
              <div className={styles.ttCard}>
                <h3>{t('timetableTeachersFetched')}</h3>
                <p className={styles.ttHelpMuted}>{t('timetableTeacherEmailCalendarHint')}</p>
                <div className={styles.ttChipsArea}>
                  {teachers.map((te) => (
                    <span key={te.id} className={styles.ttChipBlue}>
                      {te.name} ({te.subject || 'General'})
                    </span>
                  ))}
                </div>
              </div>
              <div className={styles.ttCard}>
                <h3>{t('timetableClassesFetched')}</h3>
                <div className={styles.ttChipsArea}>
                  {classNames.map((name) => (
                    <span key={name} className={styles.ttChipGreen}>
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.ttCard}>
              <h3>{t('timetableClassPeriodsTitle')}</h3>
              <p className={styles.ttHelpMuted}>{t('timetableClassPeriodsHelp')}</p>
              <div className={styles.ttTableWrap}>
                <table className={styles.ttCompactTable}>
                  <thead>
                    <tr>
                      <th scope="col">{t('timetableSelectClass')}</th>
                      <th scope="col">{t('labelPeriodsPerDay')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classes.map((c) => {
                      const k = `${c.grade}|${c.section || ''}`;
                      const row = classPeriodMap.get(k);
                      const defaultVal =
                        row?.periods_per_day != null ? row.periods_per_day : globalPpdUi;
                      return (
                        <tr key={k}>
                          <td>{`${c.grade}${c.section ? `-${c.section}` : ''}`}</td>
                          <td>
                            <input
                              type="number"
                              className={styles.ttInputSmall}
                              min={1}
                              max={capPeriods}
                              defaultValue={defaultVal}
                              key={`${k}-${defaultVal}`}
                              aria-label={`${t('labelPeriodsPerDay')} ${k}`}
                              onBlur={(e) => handleClassPeriodBlur(c, e.target.value)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={styles.ttCard}>
              <h3>{t('timetableScheduleSettings')}</h3>
              <p className={styles.ttHelpMuted}>{t('timetableRegenerateHint')}</p>
              <p className={styles.ttHelpMuted} aria-live="polite">
                {cfgFromDevice
                  ? t('timetableSettingsSavedOnDevice')
                  : t('timetableSettingsUsingSchoolDefaults')}
                {cfgFromDevice && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className={styles.ttLinkButton}
                      onClick={handleResetScheduleSettings}
                    >
                      {t('timetableResetScheduleSettings')}
                    </button>
                  </>
                )}
              </p>
              <div className={styles.ttSubjectRow}>
                <label htmlFor="tt-working-days">{t('labelWorkingDaysPerWeek')}</label>
                <select
                  id="tt-working-days"
                  className={styles.ttInput}
                  value={Math.min(7, Math.max(1, cfg.working_days))}
                  onChange={(e) =>
                    setCfg((p) => ({
                      ...p,
                      working_days: Math.min(7, Math.max(1, Number(e.target.value) || 5)),
                    }))
                  }
                  aria-label={t('labelWorkingDaysPerWeek')}
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <label htmlFor="tt-periods-per-day">{t('labelPeriodsPerDay')}</label>
                <input
                  id="tt-periods-per-day"
                  className={styles.ttInputSmall}
                  type="number"
                  min={1}
                  max={capPeriods}
                  value={cfg.periods_per_day}
                  onChange={(e) =>
                    setCfg((p) => ({
                      ...p,
                      periods_per_day: Math.min(
                        capPeriods,
                        Math.max(1, parseInt(e.target.value, 10) || p.periods_per_day)
                      ),
                    }))
                  }
                />
                <label htmlFor="tt-lunch-min">{t('lunchBreakMin')}</label>
                <input
                  id="tt-lunch-min"
                  className={styles.ttInputSmall}
                  type="number"
                  min={40}
                  max={50}
                  value={cfg.lunch_break_minutes}
                  onChange={(e) =>
                    setCfg((p) => ({
                      ...p,
                      lunch_break_minutes: Math.min(
                        50,
                        Math.max(40, parseInt(e.target.value, 10) || 40)
                      ),
                    }))
                  }
                />
                <label htmlFor="tt-lunch-after">{t('lunchAfterPeriod')}</label>
                <input
                  id="tt-lunch-after"
                  className={styles.ttInputSmall}
                  type="number"
                  min={1}
                  max={globalPpdUi}
                  value={Math.min(globalPpdUi, cfg.lunch_after_period)}
                  onChange={(e) =>
                    setCfg((p) => ({
                      ...p,
                      lunch_after_period: Math.min(
                        Math.min(capPeriods, Math.max(1, Number(p.periods_per_day) || 5)),
                        Math.max(1, parseInt(e.target.value, 10) || 4)
                      ),
                    }))
                  }
                />
                <label htmlFor="tt-short-break">{t('timetableShortBreakMinutes')}</label>
                <input
                  id="tt-short-break"
                  className={styles.ttInputSmall}
                  type="number"
                  min={0}
                  max={60}
                  value={cfg.short_break_minutes}
                  onChange={(e) =>
                    setCfg((p) => ({
                      ...p,
                      short_break_minutes: Math.max(0, parseInt(e.target.value, 10) || 0),
                    }))
                  }
                />
              </div>
              <div className={styles.ttGenerateActions}>
                <button
                  type="button"
                  className={styles.generateButton}
                  onClick={handleGeneratePreview}
                  disabled={
                    previewMutation.isPending ||
                    saveMutation.isPending ||
                    teachers.length === 0 ||
                    classes.length === 0
                  }
                >
                  {previewMutation.isPending ? t('timetableGenerating') : t('timetablePreviewGenerate')}
                </button>
              </div>

              {previewMutation.isError && (
                <p className={styles.ttErrorText} role="alert">
                  {t('generateError')}
                </p>
              )}

              {previewData && (
                <div className={styles.ttPreviewPanel}>
                  <h4>{t('timetablePreviewTitle')}</h4>
                  {previewData.warnings?.length > 0 ? (
                    <ul className={styles.ttWarningsList}>
                      {previewData.warnings.map((w, i) => (
                        <li key={`${i}-${w}`}>{w}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.ttHelpMuted}>{t('timetablePreviewNoWarnings')}</p>
                  )}
                  <button
                    type="button"
                    className={styles.ttSaveGeneratedBtn}
                    onClick={handleSaveGenerated}
                    disabled={saveMutation.isPending || !payloadBaseRef.current}
                  >
                    {saveMutation.isPending ? t('timetableSaving') : t('saveToTimetable')}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'timetable' && (
          <section className={styles.ttSection} role="tabpanel" aria-labelledby="tt-tab-timetable">
            {entriesLoading && (
              <p className={styles.ttHelpMuted} aria-live="polite">
                {t('loading')}
              </p>
            )}
            <div className={styles.ttSubjectRow} role="group" aria-label={t('timetableTabTimetableView')}>
              <button
                type="button"
                className={viewBy === 'class' ? styles.ttTabActive : styles.ttTab}
                onClick={() => setViewBy('class')}
              >
                {t('timetableByClass')}
              </button>
              <button
                type="button"
                className={viewBy === 'teacher' ? styles.ttTabActive : styles.ttTab}
                onClick={() => setViewBy('teacher')}
              >
                {t('timetableByTeacher')}
              </button>
              {viewBy === 'class' ? (
                <select
                  className={styles.ttInput}
                  value={selectedClassSafe}
                  onChange={(e) => setSelectedClass(e.target.value)}
                  aria-label={t('timetableSelectClass')}
                >
                  {classNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className={styles.ttInput}
                  value={selectedTeacherIdSafe}
                  onChange={(e) => setSelectedTeacher(e.target.value)}
                  aria-label={t('timetableSelectTeacher')}
                >
                  {teachers.map((te) => (
                    <option key={te.id} value={String(te.id)}>
                      {teacherOptionLabel(te)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <p className={styles.ttHelpMuted}>{t('timetableClickToEdit')}</p>

            <div className={styles.ttCalendarMobile}>
              <PrincipalTimetableMobileCalendar
                mobileCalView={mobileCalView}
                viewAnchorDate={viewAnchorDate}
                onViewChange={setMobileCalView}
                onAnchorChange={setViewAnchorDate}
                periodsSlice={periodsSlice}
                days={days}
                cfg={cfg}
                principalMobileSlot={principalMobileSlot}
                openCell={openCell}
                t={t}
              />
            </div>

            <div className={`${styles.timetableScrollWrap} ${styles.ttPrincipalTableDesktop}`}>
              <table className={styles.timetableTable}>
                <thead>
                  <tr>
                    <th className={styles.ttThSticky} scope="col">
                      {t('timetablePeriodColumn')}
                    </th>
                    {days.map((d) => (
                      <th key={d} className={styles.ttThDay} scope="col">
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {periodsSlice.map((periodObj, idx) => (
                    <React.Fragment key={periodObj.key}>
                      <tr>
                        <th className={styles.ttTdPeriod} scope="row">
                          {idx + 1}
                        </th>
                        {days.map((day) => {
                          if (viewBy === 'class') {
                            const list =
                              classDayPeriodEntriesMap.get(
                                `${selectedClassSafe}|${day}|${periodObj.key}`
                              ) || [];
                            const multi = list.length > 1;
                            const teacherConflict = list.some((e) => {
                              const tid = entryTeacherIdRaw(e);
                              return (
                                tid != null &&
                                teacherPeriodIsDoubleBooked(doubleBookKeys, tid, day, periodObj.key)
                              );
                            });
                            const tdConflict = multi || teacherConflict;
                            return (
                              <td key={`${day}-${periodObj.key}`} className={styles.ttTd}>
                                <button
                                  type="button"
                                  className={`${styles.ttTdEditableBtn} ${tdConflict ? styles.ttTdConflictTeacher : ''}`}
                                  onClick={() => openClassTimetableCell(day, periodObj.key)}
                                >
                                  {tdConflict && (
                                    <span className={styles.conflictCellBadge}>
                                      {t('timetableConflictBadge')}
                                    </span>
                                  )}
                                  {list.length === 0 ? (
                                    <>
                                      <div className={styles.entrySubject}>-</div>
                                      <div className={styles.entryRoom} />
                                    </>
                                  ) : (
                                    list.map((entry) => {
                                      const teacherName =
                                        typeof entry.teacher === 'object'
                                          ? entry.teacher?.name
                                          : teacherNameById.get(String(entry.teacher));
                                      return (
                                        <div key={entry.id}>
                                          <div className={styles.entrySubject}>
                                            {entry.subject || '-'}
                                          </div>
                                          <div className={styles.entryRoom}>{teacherName || ''}</div>
                                        </div>
                                      );
                                    })
                                  )}
                                </button>
                              </td>
                            );
                          }
                          const entriesList =
                            teacherDayPeriodEntriesMap.get(
                              `${selectedTeacherIdSafe}|${day}|${periodObj.key}`
                            ) || [];
                          const multi = entriesList.length > 1;
                          const tid0 = entryTeacherIdRaw(entriesList[0]);
                          const crossConflict =
                            tid0 != null &&
                            teacherPeriodIsDoubleBooked(doubleBookKeys, tid0, day, periodObj.key);
                          const tdConflict = multi || crossConflict;
                          return (
                            <td key={`${day}-${periodObj.key}`} className={styles.ttTd}>
                              {entriesList.length === 0 ? (
                                <button
                                  type="button"
                                  className={styles.ttTdEditableBtn}
                                  onClick={() => openTeacherTimetableCell(day, periodObj.key)}
                                >
                                  <div className={styles.ttTdEmptySlot} aria-hidden>
                                    —
                                  </div>
                                  <div className={styles.ttTdHintText}>
                                    {t('timetableTeacherViewAddHint')}
                                  </div>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className={`${styles.ttTdEditableBtn} ${tdConflict ? styles.ttTdConflictTeacher : ''}`}
                                  onClick={() => openTeacherTimetableCell(day, periodObj.key)}
                                >
                                  {tdConflict && (
                                    <span className={styles.conflictCellBadge}>
                                      {t('timetableConflictBadge')}
                                    </span>
                                  )}
                                  {entriesList.map((e) => {
                                    const cls = `${e.grade}${e.section ? `-${e.section}` : ''}`;
                                    return (
                                      <div key={e.id}>
                                        <div className={styles.entrySubject}>{e.subject || '-'}</div>
                                        <div className={styles.entryRoom}>{cls}</div>
                                      </div>
                                    );
                                  })}
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      {idx + 1 === cfg.lunch_after_period && (
                        <tr className={styles.breakRow}>
                          <td colSpan={days.length + 1} className={styles.breakRowCell}>
                            {t('timetableBreakLabel')}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'schoolday' && (
          <section className={styles.ttSection} role="tabpanel" aria-labelledby="tt-tab-schoolday">
            <div className={styles.ttSubjectRow}>
              <label htmlFor="tt-school-day">{t('timetableSchoolDayPick')}</label>
              <select
                id="tt-school-day"
                className={styles.ttInput}
                value={selectedSchoolDay}
                onChange={(e) => setSelectedSchoolDay(e.target.value)}
              >
                {days.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <p className={styles.ttHelpMuted}>{t('timetableSchoolDayIntro')}</p>

            <details className={styles.ttLegendDetails}>
              <summary>{t('timetableTeacherColorLegend')}</summary>
              <input
                type="search"
                className={styles.ttInput}
                placeholder={t('timetableLegendFilter')}
                value={legendFilter}
                onChange={(e) => setLegendFilter(e.target.value)}
                aria-label={t('timetableLegendFilter')}
              />
              <div className={styles.ttLegendChips}>
                {filteredLegendTeachers.map((te) => (
                  <span key={te.id} className={styles.ttLegendChip}>
                    <span
                      className={styles.ttLegendSwatch}
                      style={{ background: teacherScheduleRowBackground(te.id) }}
                      aria-hidden
                    />
                    {teacherOptionLabel(te)}
                  </span>
                ))}
              </div>
            </details>

            <h3 className={styles.ttSchoolDaySectionTitle}>
              {t('timetableSchoolDayByTeacherTitle')}
            </h3>
            <div className={`${styles.timetableScrollWrap} ${styles.ttSchoolDayTableWrap}`}>
              <table className={styles.ttSchoolDayTable}>
                <thead>
                  <tr>
                    <th scope="col" className={styles.ttSchoolDayThTeacher}>
                      {t('timetableStatTeachers')}
                    </th>
                    {periodsSlice.map((p, i) => (
                      <th key={p.key} scope="col" className={styles.ttSchoolDayThPeriod}>
                        {i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedTeachersForSchoolDay.map((te) => {
                    const rowBg = teacherScheduleRowBackground(te.id);
                    const rowConflict = teacherHasDoubleBookingOnDay(
                      doubleBookKeys,
                      te.id,
                      selectedSchoolDay,
                      periodsSlice.map((p) => p.key)
                    );
                    return (
                      <tr
                        key={te.id}
                        className={rowConflict ? styles.ttSchoolDayTrConflict : undefined}
                        style={{ background: rowBg }}
                      >
                        <th scope="row" className={styles.ttSchoolDayRowHead}>
                          {teacherOptionLabel(te)}
                        </th>
                        {periodsSlice.map((periodObj) => {
                          const cellKey = `${te.id}|${periodObj.key}`;
                          const cellEntries = schoolDayCellMap.get(cellKey) || [];
                          const teacherPeriodClash = cellEntries.some((e) => {
                            const tid = entryTeacherIdRaw(e);
                            return (
                              tid != null &&
                              teacherPeriodIsDoubleBooked(doubleBookKeys, tid, selectedSchoolDay, periodObj.key)
                            );
                          });
                          const multi =
                            cellEntries.length > 1 ||
                            conflictKeysForSchoolDay.has(cellKey) ||
                            teacherPeriodClash;
                          return (
                            <td
                              key={periodObj.key}
                              className={
                                multi
                                  ? `${styles.ttSchoolDayTd} ${styles.ttSchoolDayTdClash} ${styles.ttSchoolDayTdEditable}`
                                  : `${styles.ttSchoolDayTd} ${styles.ttSchoolDayTdEditable}`
                              }
                            >
                              <button
                                type="button"
                                className={styles.ttSchoolDayCellBtn}
                                onClick={() => openSchoolDayTeacherCell(periodObj.key, cellEntries)}
                              >
                                {multi && (
                                  <span className={styles.ttSchoolDayClashBadge}>
                                    <AlertTriangle size={14} aria-hidden />
                                    {t('timetableDoubleBooking')}
                                  </span>
                                )}
                                {cellEntries.length === 0 ? (
                                  <span className={styles.ttSchoolDayEmpty}>—</span>
                                ) : (
                                  cellEntries.map((e) => {
                                    const cls = `${e.grade}${e.section ? `-${e.section}` : ''}`;
                                    return (
                                      <div key={e.id} className={styles.ttSchoolDayCellBlock}>
                                        <div className={styles.entrySubject}>{e.subject || '-'}</div>
                                        <div className={styles.entryRoom}>{cls}</div>
                                      </div>
                                    );
                                  })
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <h3 className={styles.ttSchoolDaySectionTitle}>
              {t('timetableSchoolDayByClassTitle')}
            </h3>
            <p className={styles.ttHelpMuted}>{t('timetableSchoolDayByClassIntro')}</p>
            <div className={`${styles.timetableScrollWrap} ${styles.ttSchoolDayTableWrap}`}>
              <table className={styles.ttSchoolDayTable}>
                <thead>
                  <tr>
                    <th scope="col" className={styles.ttSchoolDayThTeacher}>
                      {t('timetableStatClasses')}
                    </th>
                    {periodsSlice.map((p, i) => (
                      <th key={p.key} scope="col" className={styles.ttSchoolDayThPeriod}>
                        {i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedClassesForSchoolDay.map((c) => {
                    const className = `${c.grade}${c.section ? `-${c.section}` : ''}`;
                    return (
                      <tr key={className}>
                        <th scope="row" className={styles.ttSchoolDayRowHead}>
                          {className}
                        </th>
                        {periodsSlice.map((periodObj) => {
                          const cellKey = `${className}|${periodObj.key}`;
                          const cellEntries = schoolDayClassCellMap.get(cellKey) || [];
                          const teacherPeriodClash = cellEntries.some((e) => {
                            const tid = entryTeacherIdRaw(e);
                            return (
                              tid != null &&
                              teacherPeriodIsDoubleBooked(doubleBookKeys, tid, selectedSchoolDay, periodObj.key)
                            );
                          });
                          const multi = cellEntries.length > 1 || teacherPeriodClash;
                          if (cellEntries.length === 0) {
                            return (
                              <td
                                key={periodObj.key}
                                className={`${styles.ttSchoolDayTd} ${styles.ttSchoolDayTdEditable}`}
                              >
                                <button
                                  type="button"
                                  className={styles.ttSchoolDayCellBtn}
                                  onClick={() => openSchoolDayClassCell(periodObj.key, c, [])}
                                >
                                  <span className={styles.ttSchoolDayEmpty}>—</span>
                                </button>
                              </td>
                            );
                          }
                          if (cellEntries.length === 1 && !teacherPeriodClash) {
                            const e = cellEntries[0];
                            const tid =
                              typeof e.teacher === 'object' && e.teacher?.id != null
                                ? e.teacher.id
                                : e.teacher;
                            const teacherName =
                              typeof e.teacher === 'object'
                                ? e.teacher?.name
                                : teacherNameById.get(String(e.teacher));
                            return (
                              <td
                                key={periodObj.key}
                                className={`${styles.ttSchoolDayTd} ${styles.ttSchoolDayTdEditable}`}
                                style={{ background: teacherScheduleRowBackground(tid) }}
                              >
                                <button
                                  type="button"
                                  className={styles.ttSchoolDayCellBtn}
                                  onClick={() =>
                                    openSchoolDayClassCell(periodObj.key, c, cellEntries)
                                  }
                                >
                                  <div className={styles.ttSchoolDayCellBlock}>
                                    <div className={styles.entrySubject}>{e.subject || '-'}</div>
                                    <div className={styles.entryRoom}>{teacherName || ''}</div>
                                  </div>
                                </button>
                              </td>
                            );
                          }
                          return (
                            <td
                              key={periodObj.key}
                              className={`${styles.ttSchoolDayTd} ${styles.ttSchoolDayTdClash} ${styles.ttSchoolDayTdEditable}`}
                            >
                              <button
                                type="button"
                                className={styles.ttSchoolDayCellBtn}
                                onClick={() =>
                                  openSchoolDayClassCell(periodObj.key, c, cellEntries)
                                }
                              >
                                <span className={styles.ttSchoolDayClashBadge}>
                                  <AlertTriangle size={14} aria-hidden />
                                  {multi ? t('timetableDoubleBooking') : t('timetableConflictBadge')}
                                </span>
                                {cellEntries.map((e) => {
                                  const tid =
                                    typeof e.teacher === 'object' && e.teacher?.id != null
                                      ? e.teacher.id
                                      : e.teacher;
                                  const teacherName =
                                    typeof e.teacher === 'object'
                                      ? e.teacher?.name
                                      : teacherNameById.get(String(e.teacher));
                                  return (
                                    <div
                                      key={e.id}
                                      className={styles.ttSchoolDayCellBlock}
                                      style={{ background: teacherScheduleRowBackground(tid) }}
                                    >
                                      <div className={styles.entrySubject}>{e.subject || '-'}</div>
                                      <div className={styles.entryRoom}>{teacherName || ''}</div>
                                    </div>
                                  );
                                })}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'workload' && (
          <section className={styles.ttSection} role="tabpanel" aria-labelledby="tt-tab-workload">
            <div className={styles.ttCard}>
              {Object.entries(workload).map(([teacherId, count], wlIdx) => {
                const lblId = `tt-wl-name-${wlIdx}`;
                return (
                  <div key={teacherId} className={styles.ttWorkloadRow}>
                    <span id={lblId}>{workloadLabelForId(teacherId)}</span>
                    <div
                      className={styles.ttWorkloadBar}
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={maxWorkload}
                      aria-valuenow={count}
                      aria-labelledby={lblId}
                    >
                      <div
                        className={styles.ttWorkloadFill}
                        style={{ width: `${Math.round((count / maxWorkload) * 100)}%` }}
                      />
                    </div>
                    <strong aria-hidden="true">{count}</strong>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <PrincipalTimetableCellEditor
          open={Boolean(cellEditor)}
          context={cellEditor}
          teachers={teachers}
          staffAvailabilityRoster={timetableStaffRoster}
          busyTeacherIdsElsewhere={cellEditorBusyTeacherIdsElsewhere}
          freeTeachers={cellEditorFreeTeachers}
          teacherOptionLabel={teacherOptionLabel}
          onClose={() => {
            setCellEditor(null);
            setCellEditorError('');
          }}
          onSaveRow={handleCellSaveRow}
          onDeleteRow={handleCellDeleteRow}
          saving={cellMutation.isPending}
          errorText={cellEditorError}
          t={t}
        />
      </div>
    </Layout>
  );
}
