/** Keep in sync with backend/school/timetable_constants.py */
export const MAX_TIMETABLE_PERIODS = 10;

export const TIMETABLE_PERIOD_CHOICES = Array.from({ length: MAX_TIMETABLE_PERIODS }, (_, i) => {
  const label = `Period ${i + 1}`;
  return [label, label] as const;
});
