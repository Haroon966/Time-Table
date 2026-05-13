import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from '../TimeTable.module.css';

const EMPTY_BUSY_IDS = new Set();

/** Staff pk or synthetic principal_<userId> from merged staff API list. */
function timetableTeacherPayloadFromSelect(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (s.startsWith('principal_')) return s;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function entryTeacherId(e) {
  if (!e) return '';
  const tid = typeof e.teacher === 'object' && e.teacher?.id != null ? e.teacher.id : e.teacher;
  return tid != null ? String(tid) : '';
}

/**
 * Modal to create/edit timetable rows for one (day × period × scope).
 * context.entries — API timetable rows (0 = create, 1+ = edit rows).
 */
export default function PrincipalTimetableCellEditor({
  open,
  context,
  teachers,
  staffAvailabilityRoster = [],
  busyTeacherIdsElsewhere = EMPTY_BUSY_IDS,
  freeTeachers = [],
  teacherOptionLabel,
  onClose,
  onSaveRow,
  onDeleteRow,
  saving,
  errorText,
  t,
}) {
  const closeBtnRef = useRef(null);
  const [createTeacherId, setCreateTeacherId] = useState('');
  const [createSubject, setCreateSubject] = useState('');

  useEffect(() => {
    if (!open || !context) return;
    const first = context.entries?.[0];
    const tid = entryTeacherId(first);
    setCreateTeacherId(tid || '');
    setCreateSubject(first?.subject || '');
  }, [open, context]);

  useEffect(() => {
    if (!open) return undefined;
    closeBtnRef.current?.focus();
    const onEsc = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  const teacherOptions = useMemo(() => {
    const base = staffAvailabilityRoster.length > 0 ? staffAvailabilityRoster : teachers;
    const free = [];
    const busy = [];
    base.forEach((te) => {
      const tid = String(te.id);
      if (busyTeacherIdsElsewhere.has(tid)) {
        busy.push(te);
      } else {
        free.push(te);
      }
    });
    return [...free, ...busy];
  }, [staffAvailabilityRoster, teachers, busyTeacherIdsElsewhere]);

  if (!open || !context) return null;

  const { day, periodKey, periodLabel, grade, section, entries = [] } = context;
  const classLabel =
    grade != null ? `${grade}${section ? `-${section}` : ''}` : '';

  const freeCount = freeTeachers.length;
  const busyCount = Math.max(0, staffAvailabilityRoster.length - freeCount);
  const createTeacherBusy = createTeacherId && busyTeacherIdsElsewhere.has(String(createTeacherId));

  const handleCreate = async () => {
    const gradeTrimmed = String(grade ?? '').trim();
    const sectionTrimmed = String(section ?? '').trim().slice(0, 10);
    const teacherVal = timetableTeacherPayloadFromSelect(createTeacherId);
    if (teacherVal == null || !gradeTrimmed || createTeacherBusy) return;
    await onSaveRow(null, {
      teacher: teacherVal,
      grade: gradeTrimmed,
      section: sectionTrimmed,
      subject: (createSubject || '').trim() || 'General',
      day: String(day ?? '').trim(),
      period: periodKey,
      room: '',
    });
  };

  return (
    <div
      className={styles.ttCellEditorOverlay}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={styles.ttCellEditorDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tt-cell-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.ttCellEditorHeader}>
          <h2 id="tt-cell-editor-title" className={styles.ttCellEditorTitle}>
            {t('timetableCellEditorTitle')}
          </h2>
          <button
            type="button"
            className={styles.ttCellEditorClose}
            onClick={onClose}
            aria-label={t('cancel')}
            ref={closeBtnRef}
          >
            ×
          </button>
        </div>
        <p className={styles.ttCellEditorMeta}>
          <strong>{day}</strong> · {periodLabel || periodKey}
          {classLabel ? (
            <>
              {' · '}
              <strong>{classLabel}</strong>
            </>
          ) : null}
        </p>

        <div className={styles.ttCellEditorFreePanel}>
          <div className={styles.ttCellEditorFreeHeading}>
            <span>{t('timetableCellEditorAvailabilityTitle')}</span>
            <span className={styles.ttCellEditorFreeCount} aria-live="polite">
              ({freeCount} {t('timetableCellEditorAvailabilityFreeShort')} · {busyCount}{' '}
              {t('timetableCellEditorAvailabilityBusyShort')})
            </span>
          </div>
          <p className={styles.ttCellEditorFreeHint}>{t('timetableCellEditorAvailabilityLegend')}</p>
          {freeTeachers.length === 0 ? (
            <p className={styles.ttHelpMuted}>{t('timetableCellEditorNoStaffRoster')}</p>
          ) : (
            <ul className={`${styles.ttCellEditorFreeList} ${styles.ttCellEditorAvailList}`}>
              {freeTeachers.map((te) => (
                <li
                  key={te.id}
                  className={styles.ttCellEditorAvailLiFree}
                  title={t('timetableCellEditorAvailTooltipFree')}
                >
                  {teacherOptionLabel(te)}
                </li>
              ))}
            </ul>
          )}
        </div>

        {errorText ? (
          <p className={styles.ttErrorText} role="alert">
            {errorText}
          </p>
        ) : null}

        {entries.length === 0 && grade == null ? (
          <div className={styles.ttCellEditorBlock}>
            <p className={styles.ttHelpMuted}>{t('timetableCellEditorTeacherViewAddHint')}</p>
            <button type="button" className={styles.ttCellEditorBtnGhost} onClick={onClose}>
              {t('cancel')}
            </button>
          </div>
        ) : null}

        {entries.length === 0 && grade != null ? (
          <div className={styles.ttCellEditorBlock}>
            <p className={styles.ttHelpMuted}>{t('timetableCellEditorCreateHint')}</p>
            <label className={styles.ttCellEditorLabel} htmlFor="tt-ce-teacher">
              {t('timetableSelectTeacher')}
            </label>
            <select
              id="tt-ce-teacher"
              className={styles.ttInput}
              value={createTeacherId}
              onChange={(e) => setCreateTeacherId(e.target.value)}
            >
              <option value="">{t('timetablePickTeacher')}</option>
              {teacherOptions.map((te) => (
                <option key={te.id} value={String(te.id)}>
                  {teacherOptionLabel(te)}
                  {busyTeacherIdsElsewhere.has(String(te.id))
                    ? ` - ${t('timetableTeacherBusySuffix')}`
                    : ''}
                </option>
              ))}
            </select>
            {createTeacherBusy ? (
              <p className={styles.ttErrorText} role="alert">
                {t('timetableTeacherBusyWarning')}
              </p>
            ) : null}
            <label className={styles.ttCellEditorLabel} htmlFor="tt-ce-subject">
              {t('timetableSubject')}
            </label>
            <input
              id="tt-ce-subject"
              className={styles.ttInput}
              value={createSubject}
              onChange={(e) => setCreateSubject(e.target.value)}
              placeholder={t('timetableSubjectPlaceholder')}
            />
            <div className={styles.ttCellEditorActions}>
              <button
                type="button"
                className={styles.ttSaveGeneratedBtn}
                disabled={
                  saving ||
                  timetableTeacherPayloadFromSelect(createTeacherId) == null ||
                  createTeacherBusy
                }
                onClick={handleCreate}
              >
                {saving ? t('loading') : t('timetableCellSave')}
              </button>
              <button type="button" className={styles.ttCellEditorBtnGhost} onClick={onClose}>
                {t('cancel')}
              </button>
            </div>
          </div>
        ) : null}

        {entries.map((entry) => (
          <EditorRow
            key={entry.id}
            entry={entry}
            teacherOptions={teacherOptions}
            teacherOptionLabel={teacherOptionLabel}
            busyTeacherIdsElsewhere={busyTeacherIdsElsewhere}
            onSaveRow={onSaveRow}
            onDeleteRow={onDeleteRow}
            saving={saving}
            t={t}
          />
        ))}

        {entries.length > 0 ? (
          <div className={styles.ttCellEditorFooter}>
            <button type="button" className={styles.ttCellEditorBtnGhost} onClick={onClose}>
              {t('cancel')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EditorRow({
  entry,
  teacherOptions,
  teacherOptionLabel,
  busyTeacherIdsElsewhere,
  onSaveRow,
  onDeleteRow,
  saving,
  t,
}) {
  const [teacherId, setTeacherId] = useState(() => entryTeacherId(entry));
  const [subject, setSubject] = useState(() => entry.subject || '');
  const [room, setRoom] = useState(() => entry.room || '');

  useEffect(() => {
    setTeacherId(entryTeacherId(entry));
    setSubject(entry.subject || '');
    setRoom(entry.room || '');
  }, [entry]);

  const save = async () => {
    const teacherVal = timetableTeacherPayloadFromSelect(teacherId);
    if (teacherVal == null) return;
    const isCurrentTeacher = String(teacherVal) === String(entryTeacherId(entry));
    if (!isCurrentTeacher && busyTeacherIdsElsewhere.has(String(teacherVal))) return;
    await onSaveRow(entry.id, {
      teacher: teacherVal,
      subject: (subject || '').trim() || 'General',
      room: (room || '').trim(),
    });
  };
  const selectedBusy =
    teacherId &&
    busyTeacherIdsElsewhere.has(String(teacherId)) &&
    String(teacherId) !== String(entryTeacherId(entry));

  return (
    <div className={styles.ttCellEditorBlock}>
      <div className={styles.ttCellEditorRowTitle}>
        {t('timetableCellEditorRowLabel')} #{entry.id}{' '}
        <span className={styles.ttHelpMuted}>
          ({entry.grade}
          {entry.section ? `-${entry.section}` : ''})
        </span>
      </div>
      <label className={styles.ttCellEditorLabel} htmlFor={`tt-ce-t-${entry.id}`}>
        {t('timetableSelectTeacher')}
      </label>
      <select
        id={`tt-ce-t-${entry.id}`}
        className={styles.ttInput}
        value={teacherId}
        onChange={(e) => setTeacherId(e.target.value)}
      >
        {teacherOptions.map((te) => (
          <option key={te.id} value={String(te.id)}>
            {teacherOptionLabel(te)}
            {busyTeacherIdsElsewhere.has(String(te.id)) ? ` - ${t('timetableTeacherBusySuffix')}` : ''}
          </option>
        ))}
      </select>
      {selectedBusy ? (
        <p className={styles.ttErrorText} role="alert">
          {t('timetableTeacherBusyWarning')}
        </p>
      ) : null}
      <label className={styles.ttCellEditorLabel} htmlFor={`tt-ce-s-${entry.id}`}>
        {t('timetableSubject')}
      </label>
      <input
        id={`tt-ce-s-${entry.id}`}
        className={styles.ttInput}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <label className={styles.ttCellEditorLabel} htmlFor={`tt-ce-r-${entry.id}`}>
        {t('timetableRoom')}
      </label>
      <input
        id={`tt-ce-r-${entry.id}`}
        className={styles.ttInput}
        value={room}
        onChange={(e) => setRoom(e.target.value)}
      />
      <div className={styles.ttCellEditorActions}>
        <button
          type="button"
          className={styles.ttSaveGeneratedBtn}
          disabled={saving || timetableTeacherPayloadFromSelect(teacherId) == null || selectedBusy}
          onClick={save}
        >
          {saving ? t('loading') : t('timetableCellSave')}
        </button>
        <button
          type="button"
          className={styles.ttCellEditorBtnDanger}
          disabled={saving}
          onClick={() => onDeleteRow(entry.id)}
        >
          {t('timetableCellDelete')}
        </button>
      </div>
    </div>
  );
}
