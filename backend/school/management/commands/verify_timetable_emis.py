"""
Verify timetable for a school by EMIS code.
Reports principal, staff, classes, timetable entry counts, and per-day per-class period coverage.
Checks for: missing periods (class with empty slots), duplicate teacher in same period (double-book).

Usage:
  python manage.py verify_timetable_emis 280
  python manage.py verify_timetable_emis 280 --fix-empty   # optional: suggest regeneration
"""
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.contrib.auth.models import User

from notes.models import UserProfile
from school.models import TimeTable, Staff, Student


# Standard period order for "full" day
PERIOD_KEYS = [f"Period {i}" for i in range(1, 11)]


def get_principal_for_emis(emis_code):
    """Return User (principal) for this EMIS, or None."""
    emis = str(emis_code).strip()
    profile = UserProfile.objects.filter(emis_code=emis).first()
    if profile:
        return profile.user
    user = User.objects.filter(username=f"principal_{emis}").first()
    return user


class Command(BaseCommand):
    help = "Verify timetable for a school by EMIS code (e.g. 280)"

    def add_arguments(self, parser):
        parser.add_argument("emis", type=str, help="EMIS code of the school (e.g. 280)")
        parser.add_argument(
            "--fix-empty",
            action="store_true",
            help="Suggest regeneration if classes have empty periods",
        )

    def handle(self, *args, **options):
        emis_code = options["emis"]
        user = get_principal_for_emis(emis_code)
        if not user:
            self.stdout.write(
                self.style.ERROR(
                    f"School {emis_code}: No principal found (no UserProfile.emis_code={emis_code} and no user principal_{emis_code})"
                )
            )
            return

        self.stdout.write(self.style.SUCCESS(f"School {emis_code}: Principal = {user.username}"))

        # Staff (teaching)
        staff = list(Staff.objects.filter(user=user, category="Teaching").values("id", "name", "subject"))
        self.stdout.write(f"  Teaching staff: {len(staff)}")
        for s in staff[:15]:
            self.stdout.write(f"    - {s['name']} | {s['subject']}")
        if len(staff) > 15:
            self.stdout.write(f"    ... and {len(staff) - 15} more")

        # Classes from students
        classes = list(
            Student.objects.filter(user=user)
            .values("grade", "section")
            .distinct()
            .order_by("grade", "section")
        )
        classes = [(c["grade"], c.get("section") or "") for c in classes]
        self.stdout.write(f"  Classes (grade-section): {len(classes)}")
        for g, s in classes[:15]:
            self.stdout.write(f"    - {g} {s or '-'}")
        if len(classes) > 15:
            self.stdout.write(f"    ... and {len(classes) - 15} more")

        # Timetable entries
        entries = list(
            TimeTable.objects.filter(user=user).select_related("teacher").order_by("day", "period", "grade", "section")
        )
        self.stdout.write(f"  Timetable entries total: {len(entries)}")

        if not entries:
            self.stdout.write(self.style.WARNING(
                "  No timetable entries. Generate from the app (View/Edit or Generator tab)."))
            return

        # Group by day
        by_day = defaultdict(list)
        for e in entries:
            by_day[e.day].append(e)

        # Per day: check (grade, section) x period coverage and teacher double-book
        all_ok = True
        for day in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]:
            if day not in by_day:
                continue
            day_entries = by_day[day]
            class_periods = defaultdict(set)  # (grade, section) -> set of period
            teacher_period = set()  # (teacher_id, period) -> should be unique
            dup_teachers = []

            for e in day_entries:
                key = (e.grade, e.section or "")
                class_periods[key].add(e.period)
                tid = e.teacher_id if hasattr(e, "teacher_id") else (e.teacher.id if e.teacher else None)
                if tid:
                    tkey = (tid, e.period)
                    if tkey in teacher_period:
                        dup_teachers.append((e.teacher.name if e.teacher else tid, e.period))
                    teacher_period.add(tkey)

            self.stdout.write(f"  {day}: {len(day_entries)} entries")

            if dup_teachers:
                all_ok = False
                self.stdout.write(self.style.ERROR(f"    Duplicate teacher in same period: {dup_teachers[:5]}"))

            for (g, s) in sorted(class_periods.keys()):
                periods = class_periods[(g, s)]
                missing = [p for p in PERIOD_KEYS if p not in periods]
                n = len(periods)
                label = f"{g} {s or '-'}"
                if missing:
                    all_ok = False
                    self.stdout.write(
                        self.style.WARNING(f"    {label}: {n} periods filled, missing: {missing}")
                    )
                else:
                    self.stdout.write(f"    {label}: {n} periods (all filled)")

        if all_ok:
            self.stdout.write(self.style.SUCCESS(
                "  Verification: OK (all classes have periods filled; no double-book)"))
        else:
            self.stdout.write(
                self.style.WARNING(
                    "  Verification: issues found (empty periods or double-book). Use Generate Timetable / Sync All to regenerate."
                )
            )
