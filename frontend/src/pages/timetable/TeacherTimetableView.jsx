import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar,
  Loader2,
  Download,
  MoreVertical,
  Coffee,
  AlertTriangle,
  Info,
  Pencil,
  X,
  Save,
  ChevronDown,
  CheckCircle2,
} from 'lucide-react';
import Layout from '../../components/Layout';
import styles from '../TimeTable.module.css';
import { shiftISODateToWeekday } from '../../utils/timetablePeriods';
import {
  DAYS,
  DAYS_SHORT,
  formatTimeAMPM,
  STANDARD_SUBJECTS,
} from './timetableUtils';

export default function TeacherTimetableView({
  timelineSlots,
  conflictCount,
  resolvedSnackOpen,
  selectedDay,
  operationalDate,
  setOperationalDate,
  loading,
  t,
  editingEntry,
  editRoom,
  editSubject,
  subjectOptions,
  onEditRoomChange,
  onEditSubjectChange,
  onEditEntry,
  onCloseEdit,
  onSaveEdit,
  isSaving,
  saveError,
  onExport,
  exportLoading,
  teacherName,
  noStaffMatch,
  hasTeachingSlots,
  conflictPeerClassByEntryId,
}) {
  const [openMenuId, setOpenMenuId] = useState(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const exportMenuRef = useRef(null);

  useEffect(() => {
    if (openMenuId == null) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenuId(null);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [openMenuId]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleClickOutside = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportMenuOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!editingEntry) return;
    const handleEscape = (e) => {
      if (e.key === 'Escape') onCloseEdit();
    };
    document.addEventListener('keydown', handleEscape);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = prevOverflow;
    };
  }, [editingEntry, onCloseEdit]);

  const handleEditClick = (slot) => {
    setOpenMenuId(null);
    if (slot.entry) onEditEntry(slot.entry);
  };

  const handleSaveEdit = () => {
    if (!editingEntry) return;
    const teacherId = typeof editingEntry.teacher === 'object' ? editingEntry.teacher?.id : editingEntry.teacher;
    onSaveEdit(editingEntry.id, {
      teacher: teacherId,
      grade: editingEntry.grade,
      section: editingEntry.section || '',
      subject: (editSubject ?? editingEntry.subject ?? '').trim(),
      day: editingEntry.day,
      period: editingEntry.period,
      room: editRoom.trim(),
    });
  };

  const breadcrumbExport = onExport ? (
    <div className={styles.teacherExportWrap} ref={exportMenuRef}>
      <button
        type="button"
        className={styles.teacherExportBtn}
        onClick={() => setExportMenuOpen((prev) => !prev)}
        aria-expanded={exportMenuOpen}
        aria-haspopup="true"
        aria-label={t('export') || 'Export'}
        disabled={exportLoading}
      >
        {exportLoading ? <Loader2 size={18} className={styles.spin} aria-hidden /> : <Download size={18} aria-hidden />}
        <span>{t('export') || 'Export'}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {exportMenuOpen && (
        <div className={styles.teacherExportDropdown} role="menu">
          <button
            type="button"
            className={styles.teacherExportDropdownItem}
            role="menuitem"
            onClick={() => { onExport('txt'); setExportMenuOpen(false); }}
          >
            {t('exportTxt') || 'Export TXT'}
          </button>
          <button
            type="button"
            className={styles.teacherExportDropdownItem}
            role="menuitem"
            onClick={() => { onExport('pdf'); setExportMenuOpen(false); }}
          >
            {t('exportPdf') || 'Export PDF'}
          </button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
    <Layout title={t('timetable')} breadcrumbRight={breadcrumbExport}>
      <div className={styles.teacherTimetablePage}>
        <header className={styles.teacherHeader}>
          <div className={styles.operationalDateRow}>
            <div className={styles.teacherHeaderIdentity}>
              <strong>{teacherName || t('timeTable')}</strong>
              <span>{selectedDay}</span>
            </div>
            <label className={styles.operationalDateLabel}>
              <span>{t('operationalDate') || 'Date'}</span>
              <input
                type="date"
                className={styles.operationalDateInput}
                value={operationalDate}
                onChange={(e) => setOperationalDate(e.target.value)}
              />
            </label>
          </div>
          <div className={styles.teacherDayToggle} role="tablist" aria-label={t('selectDay') || 'Select day'}>
            {DAYS.map((day, i) => (
              <button
                key={day}
                type="button"
                role="tab"
                aria-selected={selectedDay === day}
                className={selectedDay === day ? `${styles.teacherDayBtn} ${styles.teacherDayBtnActive}` : styles.teacherDayBtn}
                onClick={() => setOperationalDate(shiftISODateToWeekday(operationalDate, day))}
              >
                {t('day' + (DAYS_SHORT[i] || day.slice(0, 3))) || DAYS_SHORT[i] || day.slice(0, 3)}
              </button>
            ))}
          </div>
        </header>
        <main className={styles.teacherMain}>
          {!DAYS.includes(selectedDay) && (
            <p className={styles.nonSchoolDayHint} role="status">
              {t('pickSchoolWeekday') || 'Pick a Monday–Saturday date to view your timetable.'}
            </p>
          )}
          {DAYS.includes(selectedDay) && conflictCount > 0 && !loading && !noStaffMatch && (
            <div className={styles.ttConflictBanner} role="alert" aria-live="polite">
              <AlertTriangle className={styles.ttConflictBannerIcon} aria-hidden />
              <div>
                <strong>{t('teacherTimetableConflictBannerTitle')}</strong>
                <p className={styles.ttConflictBannerText}>
                  {t('teacherTimetableConflictBannerBody')}{' '}
                  <strong>({conflictCount})</strong>
                </p>
              </div>
            </div>
          )}
          <div className={styles.teacherScheduleHeader}>
            <h2 className={styles.teacherScheduleTitle}>{t('scheduleDetails') || 'Schedule Details'}</h2>
          </div>
          <p className={styles.teacherTimetableReadingHint}>{t('teacherTimetableMobileHint')}</p>
          {loading ? (
            <div className={styles.loadingState} role="status" aria-live="polite">
              <Loader2 className={styles.loaderIcon} aria-hidden />
              {t('loading') || 'Loading...'}
            </div>
          ) : noStaffMatch ? (
            <div className={styles.teacherEmptyState} role="alert">
              {t('teacherNoStaffMatch') || 'Your account could not be matched to a staff record. Please contact the principal.'}
            </div>
          ) : !hasTeachingSlots ? (
            <div className={styles.teacherEmptyState} role="status">
              {t('noClassesScheduled') || 'No classes scheduled for this day.'}
            </div>
          ) : (
            <div className={styles.teacherTimeline}>
              <div className={styles.teacherTimelineLine} aria-hidden />
              {timelineSlots.map((slot, idx) => (
                <div key={slot.type === 'break' ? `break-${idx}` : slot.type === 'free' ? `free-${slot.periodLabel}-${idx}` : `entry-${slot.entry?.id ?? idx}`} className={styles.teacherTimelineItem}>
                  {slot.type === 'break' ? (
                    <>
                      <div className={styles.teacherCardBreak}>
                        <Coffee className={styles.teacherBreakIcon} aria-hidden />
                        <p className={styles.teacherBreakLabel}>
                          {slot.periodLabel} · {t(slot.label)}
                          {slot.timeRange && (
                            <span className={styles.teacherBreakTimeRange}>
                              {' '}({formatTimeAMPM(slot.timeRange.start)}–{formatTimeAMPM(slot.timeRange.end)})
                            </span>
                          )}
                        </p>
                      </div>
                      <div className={`${styles.teacherTimelineDot} ${styles.teacherTimelineDotBreak}`} aria-hidden />
                    </>
                  ) : slot.type === 'free' ? (
                    <>
                      <div className={styles.teacherCardFree}>
                        <p className={styles.teacherCardFreeLabel}>
                          {slot.periodLabel}
                          {slot.timeRange && (
                            <span className={styles.teacherCardTimeRange}>
                              {' · '}{formatTimeAMPM(slot.timeRange.start)}–{formatTimeAMPM(slot.timeRange.end)}
                            </span>
                          )}
                        </p>
                        <p className={styles.teacherCardFreeSub}>{t(slot.label)}</p>
                      </div>
                      <div className={`${styles.teacherTimelineDot} ${styles.teacherTimelineDotBreak}`} aria-hidden />
                    </>
                  ) : (
                    <>
                      <div className={slot.isConflict ? styles.teacherCardConflict : styles.teacherCard}>
                        <div className={styles.teacherCardRow}>
                          <div className={styles.teacherCardBody}>
                            <p className={slot.isConflict ? `${styles.teacherCardTime} ${styles.teacherCardTimeConflict}` : styles.teacherCardTime}>
                              {slot.periodLabel}
                              {slot.timeRange && (
                                <span className={styles.teacherCardTimeRange}>
                                  {' · '}{formatTimeAMPM(slot.timeRange.start)}–{formatTimeAMPM(slot.timeRange.end)}
                                </span>
                              )}
                            </p>
                            <p className={styles.teacherCardSubject}>{slot.subject}</p>
                            <div className={styles.teacherCardMeta}>
                              <span className={styles.teacherCardMetaIcon} aria-hidden><Calendar size={10} /></span>
                              <span>{slot.classLabel}</span>
                              {slot.room && (
                                <>
                                  <span aria-hidden>•</span>
                                  <span>{slot.room}</span>
                                </>
                              )}
                            </div>
                            {slot.isConflict && slot.entry && (
                              <div className={styles.teacherConflictDivider}>
                                <div className={styles.teacherConflictMessage}>
                                  <Info className={styles.teacherConflictMessageIcon} aria-hidden />
                                  <span>
                                    {t('teacherDoubleBooked') || 'Teacher is double-booked with'} {slot.classLabel}
                                    {slot.entry?.id && conflictPeerClassByEntryId?.get(slot.entry.id)
                                      ? ` (${conflictPeerClassByEntryId.get(slot.entry.id)})`
                                      : ''}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className={styles.teacherCardMenuWrap} ref={openMenuId === slot.entry?.id ? menuRef : null}>
                            <button
                              type="button"
                              className={styles.teacherCardMenuBtn}
                              aria-label={t('options') || 'Options'}
                              aria-expanded={openMenuId === slot.entry?.id}
                              aria-haspopup="true"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId((prev) => (prev === slot.entry?.id ? null : slot.entry?.id ?? null));
                              }}
                            >
                              <MoreVertical size={20} />
                            </button>
                            {openMenuId === slot.entry?.id && (
                              <div className={styles.teacherCardDropdown} role="menu">
                                <button
                                  type="button"
                                  className={styles.teacherCardDropdownItem}
                                  role="menuitem"
                                  onClick={() => handleEditClick(slot)}
                                >
                                  <Pencil size={16} aria-hidden />
                                  {t('edit') || 'Edit'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div
                        className={`${styles.teacherTimelineDot} ${slot.isConflict ? styles.teacherTimelineDotConflict : styles.teacherTimelineDotNormal}`}
                        aria-hidden
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {editingEntry && (
        <div
          className={styles.teacherEditModalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="teacher-edit-modal-title"
          onClick={onCloseEdit}
        >
          <div className={styles.teacherEditModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.teacherEditModalHeader}>
              <h2 id="teacher-edit-modal-title" className={styles.teacherEditModalTitle}>
                {t('editEntry') || 'Edit entry'}
              </h2>
              <button type="button" className={styles.teacherEditModalClose} aria-label={t('close') || 'Close'} onClick={onCloseEdit}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.teacherEditModalBody}>
              <div className={styles.teacherEditModalRow}>
                <label htmlFor="teacher-edit-subject" className={styles.teacherEditModalLabel}>{t('subject') || 'Subject'}</label>
                <select
                  id="teacher-edit-subject"
                  className={styles.teacherEditModalInput}
                  value={editSubject ?? editingEntry?.subject ?? ''}
                  onChange={(e) => onEditSubjectChange(e.target.value)}
                  autoFocus
                >
                  <option value="">{t('selectSubject') || 'Select subject'}</option>
                  {STANDARD_SUBJECTS.map((s) => (
                    <option key={s.value} value={s.value}>{t(s.labelKey) || s.value}</option>
                  ))}
                  {[...new Set([...(editingEntry?.subject ? [editingEntry.subject] : []), ...(subjectOptions || [])])]
                    .filter((sub) => sub && !STANDARD_SUBJECTS.some((s) => s.value === sub))
                    .sort((a, b) => String(a).localeCompare(String(b)))
                    .map((sub) => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                </select>
              </div>
              <div className={styles.teacherEditModalRow}>
                <span className={styles.teacherEditModalLabel}>{t('class') || 'Class'}</span>
                <div className={styles.teacherEditModalReadOnly}>
                  {[editingEntry.grade, editingEntry.section].filter(Boolean).join(' ') || '—'} · {editingEntry.period || '—'}
                </div>
              </div>
              <div className={styles.teacherEditModalRow}>
                <label htmlFor="teacher-edit-room" className={styles.teacherEditModalLabel}>{t('room') || 'Room'}</label>
                <input
                  id="teacher-edit-room"
                  type="text"
                  className={styles.teacherEditModalInput}
                  value={editRoom}
                  onChange={(e) => onEditRoomChange(e.target.value)}
                  placeholder={t('roomPlaceholder') || 'e.g. 302'}
                />
              </div>
              {saveError && (
                <div className={styles.error} style={{ marginTop: 8 }} role="alert">
                  {saveError}
                </div>
              )}
              <div className={styles.teacherEditModalActions}>
                <button type="button" className={styles.cancelButton} onClick={onCloseEdit} disabled={isSaving}>
                  {t('cancel') || 'Cancel'}
                </button>
                <button type="button" className={styles.saveButton} onClick={handleSaveEdit} disabled={isSaving}>
                  {isSaving ? <Loader2 className={styles.spin} size={18} aria-hidden /> : <Save size={18} aria-hidden />}
                  {isSaving ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
    {resolvedSnackOpen && (
      <div
        className={styles.teacherConflictResolvedSnack}
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 size={20} className={styles.teacherConflictResolvedSnackIcon} aria-hidden />
        <span>{t('teacherTimetableConflictsResolved')}</span>
      </div>
    )}
    </>
  );
}
