"""Shared timetable limits (keep in sync with TimeTable.PERIOD_CHOICES and generator)."""

MAX_TIMETABLE_PERIODS = 10

TIMETABLE_PERIOD_CHOICES = tuple(
    (f"Period {i}", f"Period {i}") for i in range(1, MAX_TIMETABLE_PERIODS + 1)
)

# Staff.source_user_id marker for an auto-created row representing the principal on timetable UIs.
PRINCIPAL_SELF_STAFF_SOURCE_USER_ID = "principal_self"
