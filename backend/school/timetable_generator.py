"""
Timetable generator: produces class timetables from teachers (each teacher's
subject is the source of truth), classes, and periods per day, with configurable
breaks and difficulty-aware ordering.
"""

from collections import defaultdict

from .timetable_constants import MAX_TIMETABLE_PERIODS

# Default difficulty map for common subjects (when not overridden)
DEFAULT_DIFFICULTY = {
    "math": "hard", "mathematics": "hard", "physics": "hard", "chemistry": "hard",
    "biology": "medium", "english": "medium", "urdu": "medium", "islamiyat": "medium",
    "pakistan studies": "medium", "social studies": "medium",
    "history": "medium", "geography": "medium", "arabic": "medium",
    "art": "light", "pe": "light", "physical education": "light", "music": "light",
    "computer": "medium", "computer science": "medium", "science": "medium",
    "principal": "medium", "vice principal": "medium",
}

# Ordered Mon→Sun (matches typical school week + optional Sunday session).
DAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]
PERIOD_LABELS = [f"Period {i}" for i in range(1, MAX_TIMETABLE_PERIODS + 1)]

# When no teacher matches the class subject, try pools in this order (normalized substring match).
FALLBACK_SUBJECT_KEYWORD_GROUPS = [
    ("computer", "information technology", "software"),
    ("physical education", "physical", " p.e", "pe ", "pti", "p.t", "gym", "sport"),
    ("science", "biology", "chemistry", "physics", "general science"),
    ("islamiyat", "islamic", "deeniyat"),
    ("urdu",),
    ("english",),
    ("mathematics", "math", "algebra"),
    ("library",),
    ("lab", "laboratory", "lab assistant"),
]

# Map free-text subject labels (normalized) to one canonical key so "Math" matches "Mathematics".
# Order matters: more specific rules before generic ones (e.g. computer science before science).
SUBJECT_CANONICAL_RULES = [
    ("computer science", ("computer science", "ict", "information technology", "software")),
    (
        "physical education",
        ("physical education", "physical training", "physical ed", "pti", "gym", "sports"),
    ),
    ("pakistan studies", ("pakistan studies", "pak studies", "pst")),
    ("social studies", ("social studies", "social science")),
    ("general science", ("general science",)),
    ("mathematics", ("mathematics", "math", "maths", "algebra", "geometry")),
    ("islamiyat", ("islamiyat", "islamic studies", "islamic", "deeniyat")),
    ("arabic", ("arabic",)),
    ("english", ("english", "language arts")),
    ("urdu", ("urdu",)),
    ("science", ("science", "biology", "chemistry", "physics")),
    ("vice principal", ("vice principal", "vice-principal")),
    ("principal", ("principal", "head teacher", "headteacher")),
]


def _normalize_subject(s):
    return (s or "").strip().lower()


def _canonical_subject_norm(norm_subj):
    """
    Normalize varied staff/class subject spellings to one bucket for teacher lookup.
    ``norm_subj`` must already be _normalize_subject output.
    """
    if not norm_subj:
        return norm_subj
    for canon, triggers in SUBJECT_CANONICAL_RULES:
        if norm_subj == canon:
            return canon
        for tr in triggers:
            trn = _normalize_subject(tr)
            if not trn:
                continue
            if norm_subj == trn:
                return canon
            # substring (e.g. "math" in "mathematics", "physical" in "physical training")
            if len(trn) >= 3 and trn in norm_subj:
                return canon
    return norm_subj


def _normalize_staff_pk(tid):
    """Coerce staff id from API/config to int when numeric (avoids mixed str/int dict keys and sort errors)."""
    if tid is None:
        return None
    try:
        return int(tid)
    except (TypeError, ValueError):
        return tid


def _dedupe_teachers_by_id(teacher_list):
    seen = set()
    out = []
    for t in teacher_list:
        tid = _normalize_staff_pk(t.get("id"))
        if tid is None or tid in seen:
            continue
        seen.add(tid)
        out.append(t)
    return out


def _staff_sort_key(tid):
    """Stable comparable tie-breaker for pick_best (never compare str to int)."""
    tid = _normalize_staff_pk(tid)
    if tid is None:
        return (1, "")
    if isinstance(tid, int):
        return (0, tid)
    return (2, str(tid))


def period_label_for_index(period_1based):
    i = period_1based - 1
    if 0 <= i < len(PERIOD_LABELS):
        return PERIOD_LABELS[i]
    return f"Period {period_1based}"


def _subjects_from_teachers(teachers, difficulty_overrides=None):
    """
    Build subject list from teachers: each teacher's subject is the canonical subject.
    difficulty_overrides: optional list of {name, difficulty} to override defaults.
    Returns list of { "name": str, "difficulty": "hard"|"medium"|"light" }.
    """
    seen_canon = {}
    for t in teachers:
        subj = (t.get("subject") or "").strip()
        if not subj:
            continue
        canon = _canonical_subject_norm(_normalize_subject(subj))
        prev = seen_canon.get(canon)
        if prev is None or len(subj) > len(prev):
            seen_canon[canon] = subj  # prefer fuller label for display
    subject_names = list(seen_canon.values())
    override_map = {}
    if difficulty_overrides:
        for s in difficulty_overrides:
            name = (s.get("name") or "").strip()
            if name:
                d = (s.get("difficulty") or "medium").lower()
                val = d if d in ("hard", "medium", "light") else "medium"
                cn_o = _canonical_subject_norm(_normalize_subject(name))
                override_map[cn_o] = val
                override_map[_normalize_subject(name)] = val
    result = []
    for name in subject_names:
        cn = _canonical_subject_norm(_normalize_subject(name))
        norm = _normalize_subject(name)
        diff = (
            override_map.get(cn)
            or override_map.get(norm)
            or DEFAULT_DIFFICULTY.get(cn)
            or DEFAULT_DIFFICULTY.get(norm, "medium")
        )
        result.append({"name": name, "difficulty": diff})
    return result


def build_slot_sequence(periods_per_day, short_break_minutes, lunch_break_minutes, lunch_after_period):
    """
    Build the ordered list of slot descriptors for one day (teaching periods + breaks).
    Returns list of dicts: { "type": "class"|"break", "period": 1-based index or None, "label": ... }
    """
    slots = []
    for p in range(1, periods_per_day + 1):
        slots.append({
            "type": "class",
            "period": p,
            "label": period_label_for_index(p),
        })
        if p == lunch_after_period:
            slots.append({"type": "break", "period": None, "label": f"Lunch ({lunch_break_minutes} min)"})
        elif p < periods_per_day and short_break_minutes > 0:
            slots.append({"type": "break", "period": None, "label": f"Break ({short_break_minutes} min)"})
    return slots


def _class_periods_per_day(cls, default_ppd):
    ppd = cls.get("periods_per_day")
    if ppd is None:
        ppd = default_ppd
    return min(MAX_TIMETABLE_PERIODS, max(1, int(ppd)))


def _weekly_load_per_class(classes, subjects, weekly_load, default_periods_per_day, working_days):
    """
    Build per-class weekly requirement: list of subject names for the week.
    Each class may have its own periods_per_day; total_slots = ppd * working_days.
    """
    subject_names = [s.get("name") for s in subjects if s.get("name")]
    if not subject_names:
        return {}

    result = {}
    for cls in classes:
        key = (cls.get("grade"), cls.get("section") or "")
        ppd = _class_periods_per_day(cls, default_periods_per_day)
        total_slots = ppd * working_days

        if weekly_load:
            load_map = {_normalize_subject(k): (k, v) for k, v in weekly_load.items() if v > 0}
            week_list = []
            for norm_key, (name, count) in load_map.items():
                if name in subject_names or any(_normalize_subject(s) == norm_key for s in subject_names):
                    display_name = name
                    for s in subjects:
                        if _normalize_subject(s.get("name")) == norm_key:
                            display_name = s.get("name")
                            break
                    week_list.extend([display_name] * count)
            result[key] = week_list[:total_slots] if len(week_list) > total_slots else week_list
            continue

        n = len(subject_names)
        per_subject = total_slots // n
        remainder = total_slots % n
        week_list = []
        for i, name in enumerate(subject_names):
            count = per_subject + (1 if i < remainder else 0)
            week_list.extend([name] * count)
        result[key] = week_list

    return result


def _assign_subjects_to_day(periods_per_day, subject_list_today, subject_difficulty, max_hard_per_day=3):
    """
    Assign subjects to periods for one day for one class.
    subject_list_today: list of subject names to place (will be consumed).
    Returns list of length periods_per_day: [subject1, subject2, ...]
    """
    from collections import deque
    queue = deque(subject_list_today)
    result = []
    last_subject = None
    consecutive_same = 0
    hard_count = 0

    for _ in range(periods_per_day):
        if not queue:
            result.append(None)
            continue
        best = None
        candidates = []
        for i, subj in enumerate(queue):
            if i >= 10:
                break
            diff = subject_difficulty.get(_normalize_subject(subj), "medium")
            if diff == "hard" and hard_count >= max_hard_per_day:
                continue
            if last_subject and diff == "hard" and subject_difficulty.get(_normalize_subject(last_subject)) == "hard":
                continue
            if subj == last_subject and consecutive_same >= 2:
                continue
            score = (3 if diff == "hard" else 2 if diff == "medium" else 1)
            if diff == "hard" and hard_count < 2:
                score += 10
            candidates.append((score, i, subj, diff))
        if not candidates:
            subj = queue.popleft()
            diff = subject_difficulty.get(_normalize_subject(subj), "medium")
            best = subj
        else:
            candidates.sort(key=lambda x: (-x[0], x[1]))
            _, _, best, diff = candidates[0]
            queue.remove(best)
        result.append(best)
        if best:
            if best == last_subject:
                consecutive_same += 1
            else:
                consecutive_same = 1
            last_subject = best
            if diff == "hard":
                hard_count += 1

    # Never leave teaching periods empty — pad with any subject from this day's list or pool.
    pool = [x for x in subject_list_today if x]
    fb = pool[0] if pool else None
    if fb:
        for i, cell in enumerate(result):
            if not cell:
                result[i] = fb
    return result


def _distribute_weekly_to_days(weekly_list, periods_per_day, working_days, default_subject=None):
    from random import shuffle
    items = list(weekly_list)
    shuffle(items)
    days = [[] for _ in range(working_days)]
    for i, item in enumerate(items):
        days[i % working_days].append(item)
    filler = weekly_list[0] if weekly_list else default_subject
    for i in range(working_days):
        if len(days[i]) > periods_per_day:
            days[i] = days[i][:periods_per_day]
        while len(days[i]) < periods_per_day:
            days[i].append(filler)
    return days


def generate_class_timetables(classes, subjects, working_days, weekly_load, default_periods_per_day):
    """
    For each class, for each day, assign subjects to periods respecting rules.
    Returns: dict keyed by (grade, section) -> list of days, each day is list of period subjects.
    """
    subject_difficulty = {}
    for s in subjects:
        name = s.get("name")
        if name:
            subject_difficulty[_normalize_subject(name)] = (s.get("difficulty") or "medium").lower()
    for k in list(subject_difficulty.keys()):
        if subject_difficulty[k] not in ("hard", "medium", "light"):
            subject_difficulty[k] = "medium"

    weekly_per_class = _weekly_load_per_class(
        classes, subjects, weekly_load, default_periods_per_day, working_days
    )
    subj_names_all = [s.get("name") for s in subjects if s.get("name")]
    default_subject = subj_names_all[0] if subj_names_all else None
    result = {}
    for cls in classes:
        grade = cls.get("grade")
        section = cls.get("section") or ""
        key = (grade, section)
        ppd = _class_periods_per_day(cls, default_periods_per_day)
        need = ppd * working_days
        week_list = list(weekly_per_class.get(key, []))
        if len(week_list) < need:
            while len(week_list) < need and subj_names_all:
                week_list.append(subj_names_all[0])
        day_lists = _distribute_weekly_to_days(
            week_list, ppd, working_days, default_subject=default_subject
        )
        class_days = []
        for day_subjects in day_lists:
            # Guarantee ppd non-null subjects before difficulty assignment
            row = list(day_subjects[:ppd])
            while len(row) < ppd:
                row.append(default_subject)
            for i, cell in enumerate(row):
                if not cell:
                    row[i] = default_subject
            assigned = _assign_subjects_to_day(
                ppd,
                row,
                subject_difficulty,
                max_hard_per_day=3,
            )
            class_days.append(assigned)
        result[key] = class_days
    return result


def _teacher_by_subject(teachers):
    """teachers: list of dicts. Returns dict canonical_subject_norm -> list of teacher dicts."""
    by_subj = defaultdict(list)
    for t in teachers:
        subj = (t.get("subject") or "").strip()
        if subj:
            cn = _canonical_subject_norm(_normalize_subject(subj))
            by_subj[cn].append(t)
        role = (t.get("timetable_role") or "subject_teacher").strip().lower()
        if role == "principal":
            by_subj[_canonical_subject_norm("principal")].append(t)
        elif role == "vice_principal":
            by_subj[_canonical_subject_norm("vice principal")].append(t)
    for key in list(by_subj.keys()):
        by_subj[key] = _dedupe_teachers_by_id(by_subj[key])
    return by_subj


def _teacher_weekly_daily_caps(t, school_periods_per_day=None):
    """Returns (weekly_cap_or_none, daily_cap_or_None). None = no limit."""
    role = (t.get("timetable_role") or "subject_teacher").strip()
    mw = t.get("max_weekly_teaching_periods")
    md = t.get("max_daily_teaching_periods")
    if mw is not None:
        weekly_cap = int(mw)
    elif role == "principal":
        weekly_cap = 2
    elif role == "vice_principal":
        weekly_cap = 3
    elif role == "other":
        weekly_cap = 0
    else:
        weekly_cap = None

    if md is not None:
        daily_cap = int(md)
    elif role == "subject_teacher":
        # Default daily cap must fit the school's timetable depth so one teacher
        # can cover every period of their subject in a day when caps are unset.
        if school_periods_per_day is not None:
            sp = int(school_periods_per_day)
            daily_cap = min(MAX_TIMETABLE_PERIODS, max(5, sp))
        else:
            daily_cap = 5
    elif role in ("principal", "vice_principal"):
        daily_cap = 5
    else:
        daily_cap = 0 if weekly_cap == 0 else 5
    return weekly_cap, daily_cap


def _joining_boost(t):
    """Tie-break: prefer staff who joined in the last 90 days (newbie workload)."""
    from datetime import date, timedelta
    jd = t.get("joining_date")
    if not jd:
        return 0
    if hasattr(jd, "year"):
        d = jd
    else:
        try:
            from datetime import datetime
            d = datetime.strptime(str(jd)[:10], "%Y-%m-%d").date()
        except (ValueError, TypeError):
            return 0
    if date.today() - d <= timedelta(days=90):
        return -1  # lower sort key = preferred
    return 0


def _fallback_pools(teachers):
    """Ordered list of non-empty teacher pools for fallback assignment."""
    pools = []
    for keywords in FALLBACK_SUBJECT_KEYWORD_GROUPS:
        pool = []
        for t in teachers:
            subj = _normalize_subject(t.get("subject") or "")
            if any(kw in subj for kw in keywords):
                pool.append(t)
        pool = _dedupe_teachers_by_id(pool)
        if pool:
            pools.append(pool)
    return pools


def assign_teachers(class_timetables, classes, teachers, days_used, school_periods_per_day=None):
    """
    Assign teachers to each (class, day, period) subject slot with caps and fallbacks.

    school_periods_per_day: max periods per day used when deriving default daily caps
    for subject teachers (must align with generate() max_ppd).
    """
    teacher_by_subj = _teacher_by_subject(teachers)
    teacher_used = defaultdict(set)
    teacher_load = defaultdict(int)
    teacher_day_count = defaultdict(int)  # (tid, day) -> count
    teacher_week_count = defaultdict(int)

    entries = []
    warnings = []

    def can_use(tid, day, weekly_cap, daily_cap):
        if daily_cap is not None and teacher_day_count[(tid, day)] >= daily_cap:
            return False
        if weekly_cap is not None and teacher_week_count[tid] >= weekly_cap:
            return False
        return True

    def pick_best(candidate_list, day, period_label):
        usable = []
        for t in candidate_list:
            tid = _normalize_staff_pk(t.get("id"))
            if tid is None:
                continue
            if tid in teacher_used[(day, period_label)]:
                continue
            wc, dc = _teacher_weekly_daily_caps(t, school_periods_per_day)
            if not can_use(tid, day, wc, dc):
                continue
            usable.append(t)
        if not usable:
            return None
        return min(
            usable,
            key=lambda t: (
                teacher_load[_normalize_staff_pk(t.get("id"))],
                _joining_boost(t),
                _staff_sort_key(t.get("id")),
            ),
        )

    def pick_best_ignore_period_busy(candidate_list, day):
        """Prefer lowest-load teacher for this day, ignoring same-slot clashes (double-book)."""
        usable = []
        for t in candidate_list:
            tid = _normalize_staff_pk(t.get("id"))
            if tid is None:
                continue
            wc, dc = _teacher_weekly_daily_caps(t, school_periods_per_day)
            if not can_use(tid, day, wc, dc):
                continue
            usable.append(t)
        if not usable:
            return None
        return min(
            usable,
            key=lambda t: (
                teacher_load[_normalize_staff_pk(t.get("id"))],
                _joining_boost(t),
                _staff_sort_key(t.get("id")),
            ),
        )

    def pick_best_force(candidate_list):
        """Last resort: any teaching staff, ignoring weekly/daily caps (still skips timetable_role=other with cap 0)."""
        usable = []
        for t in candidate_list:
            tid = _normalize_staff_pk(t.get("id"))
            if tid is None:
                continue
            role = (t.get("timetable_role") or "subject_teacher").strip().lower()
            wc, _ = _teacher_weekly_daily_caps(t, school_periods_per_day)
            if role == "other" and wc == 0:
                continue
            usable.append(t)
        if not usable:
            return None
        return min(
            usable,
            key=lambda t: (
                teacher_load[_normalize_staff_pk(t.get("id"))],
                _joining_boost(t),
                _staff_sort_key(t.get("id")),
            ),
        )
    # concurrent slots consume them. Does not assign teachers outside subject/fallback rules.
    pending_slots = []
    for cls in classes:
        grade = cls.get("grade")
        section = cls.get("section") or ""
        key = (grade, section)
        day_lists = class_timetables.get(key, [])
        for day_idx, day_slots in enumerate(day_lists):
            if day_idx >= len(days_used):
                break
            day = days_used[day_idx]
            for period_1based, subject in enumerate(day_slots, start=1):
                if not subject:
                    continue
                pending_slots.append((grade, section, day, period_1based, subject))

    def _specialist_supply(subject):
        norm_subj = _normalize_subject(subject)
        canon_subj = _canonical_subject_norm(norm_subj)
        by_norm = list(teacher_by_subj.get(canon_subj, []))
        if not by_norm and canon_subj != norm_subj:
            by_norm = list(teacher_by_subj.get(norm_subj, []))
        return len(by_norm)

    pending_slots.sort(
        key=lambda item: (
            9999 if _specialist_supply(item[4]) == 0 else _specialist_supply(item[4]),
            item[2],
            item[3],
            str(item[0]),
            str(item[1]),
        )
    )

    for grade, section, day, period_1based, subject in pending_slots:
        period_label = period_label_for_index(period_1based)
        norm_subj = _normalize_subject(subject)
        canon_subj = _canonical_subject_norm(norm_subj)
        by_norm = list(teacher_by_subj.get(canon_subj, []))
        if not by_norm and canon_subj != norm_subj:
            by_norm = list(teacher_by_subj.get(norm_subj, []))
        exact_subj = [t for t in by_norm if (t.get("subject") or "").strip() == subject]
        candidates = exact_subj if exact_subj else by_norm
        best = pick_best(candidates, day, period_label)
        if best is None:
            loose = [
                t for t in by_norm
                if _normalize_staff_pk(t.get("id")) not in teacher_used[(day, period_label)]
            ]
            best = pick_best(loose, day, period_label)
        if best is None:
            exact = [t for t in teachers if (t.get("subject") or "").strip() == subject]
            best = pick_best(exact, day, period_label)
        if best is None:
            for pool in _fallback_pools(teachers):
                best = pick_best(pool, day, period_label)
                if best is not None:
                    break

        # Ensure every slot gets a teacher: general pool → double-book → ignore caps
        if best is None:
            pool = _dedupe_teachers_by_id(teachers)
            best = pick_best(pool, day, period_label)
            if best is not None:
                warnings.append(
                    f"Coverage fallback: '{subject}' at {day} {period_label} ({grade}-{section}) "
                    f"assigned to {best.get('name') or 'staff'} (no specialist available)."
                )

        if best is None:
            pool = _dedupe_teachers_by_id(teachers)
            best = pick_best_ignore_period_busy(pool, day)
            if best is not None:
                warnings.append(
                    f"Double-booking: {best.get('name') or 'staff'} at {day} {period_label} "
                    f"for '{subject}' ({grade}-{section})."
                )

        if best is None:
            pool = _dedupe_teachers_by_id(teachers)
            best = pick_best_force(pool)
            if best is not None:
                warnings.append(
                    f"Capacity override: {best.get('name') or 'staff'} for '{subject}' "
                    f"at {day} {period_label} ({grade}-{section})."
                )

        if best is None:
            warnings.append(
                f"No teacher available for subject '{subject}' at {day} {period_label} (class {grade}-{section})"
            )
            continue
        teacher_id = _normalize_staff_pk(best.get("id"))
        teacher_name = best.get("name") or ""
        teacher_used[(day, period_label)].add(teacher_id)
        teacher_load[teacher_id] += 1
        teacher_day_count[(teacher_id, day)] += 1
        teacher_week_count[teacher_id] += 1
        entries.append({
            "day": day,
            "period": period_label,
            "period_index": period_1based,
            "grade": grade,
            "section": section,
            "subject": subject,
            "teacher_id": teacher_id,
            "teacher_name": teacher_name,
        })
    return entries, warnings


def generate(config):
    """
    Main entry. config dict with:
      periods_per_day (school default), short_break_minutes, lunch_break_minutes, lunch_after_period,
      classes (each may include periods_per_day), teachers (may include timetable_role, caps, joining_date),
      optional: subjects (difficulty overrides only), weekly_load, working_days
    """
    default_periods = min(MAX_TIMETABLE_PERIODS, max(1, int(config.get("periods_per_day", 5))))
    short_break = max(0, int(config.get("short_break_minutes", 0)))
    lunch_break = max(40, min(50, int(config.get("lunch_break_minutes", 40))))
    lunch_after = max(1, min(default_periods, int(config.get("lunch_after_period", 4))))
    classes = config.get("classes") or []
    teachers = config.get("teachers") or []
    weekly_load = config.get("weekly_load")
    working_days = min(7, max(1, int(config.get("working_days", 5))))
    single_day = (config.get("day") or "").strip()
    if single_day and single_day in DAYS:
        days_used = [single_day]
        working_days_eff = 1
    else:
        days_used = DAYS[:working_days]
        working_days_eff = working_days

    subjects = _subjects_from_teachers(teachers, config.get("subjects"))
    if not teachers:
        return {
            "timetable": [],
            "by_class": {},
            "entries": [],
            "warnings": ["No teachers provided."],
            "slot_sequence": [],
        }
    if not subjects:
        return {
            "timetable": [],
            "by_class": {},
            "entries": [],
            "warnings": ["No subjects found (teachers have no subject set)."],
            "slot_sequence": [],
        }

    max_ppd = default_periods
    for cls in classes:
        max_ppd = max(max_ppd, _class_periods_per_day(cls, default_periods))
    lunch_after_global = max(1, min(max_ppd, int(config.get("lunch_after_period", lunch_after))))
    slot_sequence = build_slot_sequence(max_ppd, short_break, lunch_break, lunch_after_global)

    class_timetables = generate_class_timetables(
        classes, subjects, working_days_eff, weekly_load, default_periods
    )
    entries, warnings = assign_teachers(
        class_timetables, classes, teachers, days_used, school_periods_per_day=max_ppd
    )

    by_class = {}
    for cls in classes:
        grade = cls.get("grade")
        section = cls.get("section") or ""
        key = (grade, section)
        ppd = _class_periods_per_day(cls, default_periods)
        cls_slot_sequence = build_slot_sequence(ppd, short_break, lunch_break, min(ppd, lunch_after_global))
        day_lists = class_timetables.get(key, [])
        class_days = []
        for day_idx, day_slots in enumerate(day_lists):
            if day_idx >= len(days_used):
                break
            day = days_used[day_idx]
            slots = []
            period_idx = 0
            for slot in cls_slot_sequence:
                if slot["type"] == "break":
                    slots.append({
                        "type": "break",
                        "label": slot["label"],
                        "period": slot["period"],
                    })
                else:
                    subj = day_slots[period_idx] if period_idx < len(day_slots) else None
                    entry = next(
                        (
                            e for e in entries
                            if e["grade"] == grade
                            and (e["section"] or "") == section
                            and e["day"] == day
                            and e["period_index"] == period_idx + 1
                        ),
                        None,
                    )
                    slots.append({
                        "type": "class",
                        "period": period_idx + 1,
                        "label": slot["label"],
                        "subject": subj,
                        "teacher_name": entry["teacher_name"] if entry else None,
                        "teacher_id": entry["teacher_id"] if entry else None,
                    })
                    period_idx += 1
            class_days.append({"day": day, "slots": slots})
        by_class[key] = class_days

    timetable_by_day = []
    for day in days_used:
        day_slots_display = []
        for slot in slot_sequence:
            if slot["type"] == "break":
                day_slots_display.append({
                    "type": "break",
                    "period": slot["period"],
                    "label": slot["label"],
                })
            else:
                period_1 = slot["period"]
                slot_entries = [e for e in entries if e["day"] == day and e["period_index"] == period_1]
                day_slots_display.append({
                    "type": "class",
                    "period": period_1,
                    "label": slot["label"],
                    "assignments": [
                        {"grade": e["grade"], "section": e["section"],
                         "subject": e["subject"], "teacher_name": e["teacher_name"]}
                        for e in slot_entries
                    ],
                })
        timetable_by_day.append({"day": day, "slots": day_slots_display})

    flat_entries = [
        {
            "teacher": e["teacher_id"],
            "grade": e["grade"],
            "section": e["section"] or "",
            "subject": e["subject"],
            "day": e["day"],
            "period": e["period"],
            "room": "",
        }
        for e in entries
    ]

    return {
        "timetable": timetable_by_day,
        "by_class": {f"{g}-{s}": v for (g, s), v in by_class.items()},
        "entries": flat_entries,
        "warnings": warnings,
        "slot_sequence": slot_sequence,
    }
