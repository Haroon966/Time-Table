# Class assignment vs timetable (access model)

This note captures how two mechanisms interact for teachers. It matches the behaviour implemented in `school` as of the class-assignment rollout.

## ClassAssignment (academic year gate)

- **Purpose:** Decide whether a teacher may access **school-scoped student data** and **exam result list/summary** APIs for the **current** academic year.
- **Rule:** If the user is in the Teacher group and a row exists in `AcademicYear` with `is_current=True`, the teacher must have at least one **active** `ClassAssignment` (`deleted_at` null, `is_active=True`) for that year. Otherwise the backend returns **empty** querysets for those reads (not HTTP 403), and the frontend may redirect via `RequireTeacherClassAssignment` + `status-for-teacher`.
- **If no year is current:** Blocking is **off** (legacy-compatible); `status-for-teacher` returns `blocked: false` when `current_academic_year` is null.

## TimeTable (subject / class lattice for mutations)

- **Purpose:** Resolve which **grade, section, and subject** rows a teacher may use when **creating, updating, or deleting** exam results (and related checks). Implementation uses timetable rows matched by school EMIS and teacher identity (email / name), not the `ClassAssignment` grade list.
- **Implication:** A teacher can be unblocked for **read** APIs via `ClassAssignment` but still fail mutation checks if they have no matching timetable rows, or the reverse mismatch can occur in edge cases. Product follow-up may align these (e.g. require both, or drive allowed grades from assignments).

## Frontend route guard (audit)

All teacher-facing SPA routes under **`/students`** and **`/results`** (including nested paths such as bulk entry and student report card) are wrapped with `RequireTeacherClassAssignment` alongside `RequireFeature`. Other teacher routes (e.g. dashboard, attendance, timetable) intentionally do not use this gate; they do not replace the backend checks above for student/results APIs.
