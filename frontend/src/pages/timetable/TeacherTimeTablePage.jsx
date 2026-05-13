import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../../context/LanguageContext';
import { useTranslation } from '../../utils/translations';
import { staffAPI, timetableAPI, trackEvent } from '../../services/api';
import { exportTimetableTxt, exportTimetablePdf } from '../../utils/timetableExport';
import {
  weekdayNameFromISODate,
  todayISODateLocal,
} from '../../utils/timetablePeriods';
import {
  PERIODS,
  MAX_TIMETABLE_PERIODS,
  buildTeacherTimelineSlots,
  buildTeacherExportPayload,
  DAYS,
  maxTeachingPeriodNumberFromEntries,
  formatClassLabel,
} from './timetableUtils';
import TeacherTimetableView from './TeacherTimetableView';
import { useAuth } from '../../context/AuthContext';

export default function TeacherTimeTablePage() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { t } = useTranslation(language);
  const queryClient = useQueryClient();

  const [operationalDate, setOperationalDate] = useState(todayISODateLocal);
  const selectedDay = useMemo(() => weekdayNameFromISODate(operationalDate), [operationalDate]);
  const masterDayParam = useMemo(() => (DAYS.includes(selectedDay) ? selectedDay : null), [selectedDay]);

  const { data: teachers = [], isLoading: teachersLoading } = useQuery({
    queryKey: ['timetable-teachers', { category: 'Teaching' }],
    queryFn: async () => {
      const response = await staffAPI.getAll({ category: 'Teaching' });
      const data = response.data;
      return Array.isArray(data) ? data : (data?.results ?? []);
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const matchedTeacher = useMemo(() => {
    if (!teachers.length) return null;
    const profileStaffId = user?.staff_id ?? user?.staff?.id ?? null;
    if (profileStaffId != null) {
      const byId = teachers.find((te) => String(te.id) === String(profileStaffId));
      if (byId) return byId;
    }
    const authUserId = user?.id ?? user?.user_id ?? null;
    if (authUserId != null) {
      const byUserId = teachers.find((te) => {
        const teacherUserId = te?.user_id ?? te?.teacher_user_id ?? te?.user?.id ?? null;
        return teacherUserId != null && String(teacherUserId) === String(authUserId);
      });
      if (byUserId) return byUserId;
    }
    const username = String(user?.username || '').trim().toLowerCase();
    if (username) {
      const byUsername = teachers.find((te) => {
        const teacherUsername = String(te?.username || te?.user?.username || '').trim().toLowerCase();
        return teacherUsername && teacherUsername === username;
      });
      if (byUsername) return byUsername;
    }
    const fullName = String(user?.name || user?.full_name || '').trim().toLowerCase();
    const byName = fullName && teachers.find((te) => {
      const teacherName = String(te?.name || '').trim().toLowerCase();
      return teacherName && teacherName === fullName;
    });
    if (byName) return byName;
    // Never fall back to first teacher record; this can show someone else's timetable.
    return null;
  }, [
    teachers,
    user?.id,
    user?.user_id,
    user?.staff_id,
    user?.staff?.id,
    user?.username,
    user?.name,
    user?.full_name,
  ]);

  const myStaffId = matchedTeacher?.id ?? null;

  const { data: schoolDefaults } = useQuery({
    queryKey: ['timetable-school-defaults'],
    queryFn: async () => {
      const response = await timetableAPI.getSchoolDefaultsCurrent();
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const subjectOptions = useMemo(
    () => [...new Set(teachers.map((te) => te.subject).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b))),
    [teachers]
  );

  const { data: teacherEntries = [], isLoading: teacherTimetableLoading } = useQuery({
    queryKey: ['timetable', 'teacher', myStaffId, masterDayParam],
    queryFn: async () => {
      const response = await timetableAPI.getAll({ day: masterDayParam, teacher: myStaffId });
      const data = response.data;
      return Array.isArray(data) ? data : (data?.results ?? []);
    },
    enabled: !!myStaffId && !!masterDayParam,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const maxPeriodFromEntries = useMemo(
    () => maxTeachingPeriodNumberFromEntries(teacherEntries),
    [teacherEntries]
  );

  const teacherPeriodsSlice = useMemo(() => {
    const cap = schoolDefaults?.max_timetable_periods ?? MAX_TIMETABLE_PERIODS;
    const fromDefaults = Math.max(1, schoolDefaults?.default_periods_per_day ?? 5);
    const n = Math.min(cap, Math.max(fromDefaults, maxPeriodFromEntries || 0));
    return PERIODS.slice(0, n);
  }, [
    schoolDefaults?.max_timetable_periods,
    schoolDefaults?.default_periods_per_day,
    maxPeriodFromEntries,
  ]);

  const { data: teacherDailyData } = useQuery({
    queryKey: ['timetable', 'daily', operationalDate, 'teacher'],
    queryFn: async () => {
      const response = await timetableAPI.getDaily(operationalDate);
      return response.data;
    },
    enabled: !!operationalDate,
    staleTime: 60 * 1000,
    retry: false,
  });

  const { teacherConflictEntryIds, teacherConflictCount, teacherConflictPeerMap } = useMemo(() => {
    const byPeriod = new Map();
    teacherEntries.forEach((entry) => {
      const period = entry.period;
      if (!byPeriod.has(period)) byPeriod.set(period, []);
      byPeriod.get(period).push(entry);
    });
    const ids = new Set();
    const peerMap = new Map();
    let count = 0;
    byPeriod.forEach((periodGroup) => {
      if (periodGroup.length > 1) {
        count += 1;
        periodGroup.forEach((e) => ids.add(e.id));
        periodGroup.forEach((entry) => {
          const others = periodGroup
            .filter((x) => x.id !== entry.id)
            .map((x) => formatClassLabel(x.grade, x.section))
            .filter(Boolean);
          if (others.length) peerMap.set(entry.id, [...new Set(others)].join(', '));
        });
      }
    });
    return { teacherConflictEntryIds: ids, teacherConflictCount: count, teacherConflictPeerMap: peerMap };
  }, [teacherEntries]);

  const teacherEntriesForTimeline = useMemo(() => {
    if (!teacherDailyData?.entries?.length) return teacherEntries;
    const dailyById = new Map(teacherDailyData.entries.map((e) => [e.id, e]));
    return teacherEntries.map((e) => {
      const d = dailyById.get(e.id);
      if (!d) return e;
      const effName = d.effective_teacher_name || (typeof e.teacher === 'object' ? e.teacher?.name : '');
      if (typeof e.teacher === 'object' && e.teacher) {
        return { ...e, teacher: { ...e.teacher, name: effName } };
      }
      return {
        ...e,
        teacher: { id: d.effective_teacher_id, name: effName },
      };
    });
  }, [teacherEntries, teacherDailyData]);

  const teacherTimelineSlots = useMemo(
    () =>
      buildTeacherTimelineSlots(
        teacherEntriesForTimeline,
        teacherConflictEntryIds,
        teacherPeriodsSlice
      ),
    [teacherEntriesForTimeline, teacherConflictEntryIds, teacherPeriodsSlice]
  );

  const hasTeachingSlots = useMemo(
    () => teacherTimelineSlots.some((slot) => slot.type === 'class'),
    [teacherTimelineSlots]
  );

  const [editingTeacherEntry, setEditingTeacherEntry] = useState(null);
  const [teacherEditRoom, setTeacherEditRoom] = useState('');
  const [teacherEditSubject, setTeacherEditSubject] = useState('');
  const [teacherExportLoading, setTeacherExportLoading] = useState(false);
  const [resolvedSnackOpen, setResolvedSnackOpen] = useState(false);
  const prevConflictRef = useRef(null);

  const timetableLoading = teachersLoading || teacherTimetableLoading;

  useEffect(() => {
    prevConflictRef.current = null;
  }, [masterDayParam, myStaffId]);

  useEffect(() => {
    if (!resolvedSnackOpen) return undefined;
    const id = setTimeout(() => setResolvedSnackOpen(false), 4200);
    return () => clearTimeout(id);
  }, [resolvedSnackOpen]);

  useEffect(() => {
    if (timetableLoading || !masterDayParam || !myStaffId) return;
    const prev = prevConflictRef.current;
    if (prev !== null && prev > 0 && teacherConflictCount === 0) {
      setResolvedSnackOpen(true);
    }
    prevConflictRef.current = teacherConflictCount;
  }, [teacherConflictCount, timetableLoading, masterDayParam, myStaffId]);

  const teacherSaveMutation = useMutation({
    mutationFn: async ({ id, data }) => timetableAPI.update(id, data),
    onSuccess: () => {
      if (masterDayParam) {
        queryClient.invalidateQueries({ queryKey: ['timetable', 'teacher', myStaffId, masterDayParam] });
      }
      queryClient.invalidateQueries({ queryKey: ['timetable', 'daily'] });
      setEditingTeacherEntry(null);
      setTeacherEditRoom('');
      setTeacherEditSubject('');
      trackEvent('form_submit', 'timetable_teacher_edit');
    },
    onError: (err) => {
      console.error('Teacher timetable edit error:', err);
    },
  });

  const handleTeacherEditEntry = useCallback((entry) => {
    setEditingTeacherEntry(entry);
    setTeacherEditRoom(entry.room || '');
    setTeacherEditSubject(entry.subject || '');
  }, []);

  const handleTeacherCloseEdit = useCallback(() => {
    setEditingTeacherEntry(null);
    setTeacherEditRoom('');
    setTeacherEditSubject('');
    teacherSaveMutation.reset();
  }, [teacherSaveMutation]);

  const handleTeacherSaveEdit = useCallback(
    (id, data) => {
      teacherSaveMutation.mutate({ id, data });
    },
    [teacherSaveMutation]
  );

  const handleTeacherExport = useCallback(
    async (format) => {
      if (!myStaffId) return;
      setTeacherExportLoading(true);
      try {
        const entriesByDay = {};
        for (const day of DAYS) {
          const response = await timetableAPI.getAll({ day, teacher: myStaffId });
          const data = response.data;
          entriesByDay[day] = Array.isArray(data) ? data : (data?.results ?? []);
        }
        const teacherName = matchedTeacher?.name || teachers[0]?.name || 'My Schedule';
        const payload = buildTeacherExportPayload(entriesByDay, teacherName, teacherPeriodsSlice);
        const safeName = (teacherName || 'timetable').replace(/\s+/g, '-');
        if (format === 'pdf') {
          const mobileOptimized =
            typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
          await exportTimetablePdf(payload, `${safeName}-timetable.pdf`, {
            schoolLogoDataUrl: user?.school_picture ?? null,
            timetableRowKind: 'teacher',
            mobileOptimized,
            labels: {
              classPrefix: t('timetableExportClassPrefix'),
              weeklyTimetable: t('timetableExportWeeklyTimetable'),
              periodWord: t('timetableExportPeriodsWord'),
              dayWord: t('timetableExportDaysWord'),
              breakLabel: t('timetableBreakLabel'),
              generatedOn: t('timetableExportGeneratedOn'),
              generatedBy: t('timetableExportGeneratedBy'),
            },
            metadata: {
              generatedBy: user?.username || '',
            },
          });
        } else {
          exportTimetableTxt(payload, `${safeName}-timetable.txt`, {
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
        trackEvent('form_submit', 'timetable_teacher_export');
      } catch (err) {
        console.error('Teacher timetable export error:', err);
      } finally {
        setTeacherExportLoading(false);
      }
    },
    [myStaffId, teachers, teacherPeriodsSlice, user?.school_picture, user?.username, t, matchedTeacher?.name]
  );

  const saveError = (() => {
    const err = teacherSaveMutation.error;
    if (!err) return '';
    const data = err.response?.data;
    if (data && typeof data.detail === 'string') return data.detail;
    if (data && Array.isArray(data.detail)) {
      return data.detail.map((d) => (typeof d === 'string' ? d : d?.msg || JSON.stringify(d))).join(', ');
    }
    return err.message || '';
  })();

  return (
    <TeacherTimetableView
      timelineSlots={teacherTimelineSlots}
      conflictCount={teacherConflictCount}
      resolvedSnackOpen={resolvedSnackOpen}
      selectedDay={selectedDay}
      operationalDate={operationalDate}
      setOperationalDate={setOperationalDate}
      loading={timetableLoading}
      t={t}
      editingEntry={editingTeacherEntry}
      editRoom={teacherEditRoom}
      editSubject={teacherEditSubject}
      subjectOptions={subjectOptions}
      onEditRoomChange={setTeacherEditRoom}
      onEditSubjectChange={setTeacherEditSubject}
      onEditEntry={handleTeacherEditEntry}
      onCloseEdit={handleTeacherCloseEdit}
      onSaveEdit={handleTeacherSaveEdit}
      isSaving={teacherSaveMutation.isLoading}
      saveError={saveError}
      onExport={handleTeacherExport}
      exportLoading={teacherExportLoading}
      teacherName={matchedTeacher?.name}
      noStaffMatch={!myStaffId && !teachersLoading}
      hasTeachingSlots={hasTeachingSlots}
      conflictPeerClassByEntryId={teacherConflictPeerMap}
    />
  );
}
