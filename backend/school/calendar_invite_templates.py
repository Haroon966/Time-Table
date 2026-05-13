"""Title and description text for Google Calendar timetable invites (en / ur)."""

APP_URL = 'https://myschool.niete.pk'
APP_NAME_EN = 'MySchool'
APP_NAME_UR = 'مائی اسکول'


def class_label(grade: str, section: str) -> str:
    g = (grade or '').strip()
    s = (section or '').strip()
    if not g:
        return ''
    if s:
        return f'{g}-{s}'
    return g


def build_summary(grade: str, section: str, subject: str) -> str:
    """Event title: class name — subject."""
    cls = class_label(grade, section)
    subj = (subject or '').strip() or 'Subject'
    if cls:
        return f'{cls} — {subj}'
    return subj


def _support_block_en(principal_name: str, principal_phone: str, coach_hint: str) -> str:
    lines = []
    if principal_name:
        lines.append(f'Principal: {principal_name}')
    if principal_phone:
        lines.append(f'Contact: {principal_phone}')
    hint = (coach_hint or '').strip()
    if hint:
        lines.append(f'Coach / support: {hint}')
    if not lines:
        lines.append('If you notice a mistake, please contact your principal or coach.')
    else:
        lines.append('If anything looks wrong, contact your principal or coach to resolve it.')
    return '\n'.join(lines)


def _support_block_ur(principal_name: str, principal_phone: str, coach_hint: str) -> str:
    lines = []
    if principal_name:
        lines.append(f'پرنسپل: {principal_name}')
    if principal_phone:
        lines.append(f'رابطہ: {principal_phone}')
    hint = (coach_hint or '').strip()
    if hint:
        lines.append(f'کوچ / معاون: {hint}')
    if not lines:
        lines.append('اگر کوئی غلطی نظر آئے تو براہ کرم اپنے پرنسپل یا کوچ سے رابطہ کریں۔')
    else:
        lines.append('اگر کچھ غلط لگے تو پرنسپل یا کوچ سے رابطہ کر کے درست کروائیں۔')
    return '\n'.join(lines)


def build_description(
    *,
    lang: str,
    school_name: str,
    grade: str,
    section: str,
    subject: str,
    day: str,
    period: str,
    room: str,
    principal_name: str,
    principal_phone: str,
    coach_hint: str,
) -> str:
    """Multi-paragraph event description in English or Urdu."""
    lang = (lang or 'en').lower()
    cls = class_label(grade, section)
    room_line = (room or '').strip()
    if lang.startswith('ur'):
        support = _support_block_ur(principal_name, principal_phone, coach_hint)
        rsvp = (
            'اگر یہ تمام تفصیلات درست ہیں تو کیلنڈر میں اس دعوت پر "Yes" دبا کر '
            'تصدیق کریں کہ ٹائم ٹیبل درست ہے۔ اگر درست نہیں تو "No" منتخب کریں یا '
            'اوپر دیے گئے رابطے سے رابطہ کریں۔'
        )
        parts = [
            f'یہ دعوت {APP_NAME_UR} ({APP_URL}) — NIETE پروگرام کے ذریعے بھیجی گئی ہے۔',
            f'یہ آپ کے اسکول کے ٹائم ٹیبل کے مطابق ہے: کلاس {cls or "—"}، مضمون: {(subject or "").strip() or "—"}۔',
            f'دن: {day} | پیریڈ: {period}' + (f' | کمرہ: {room_line}' if room_line else '') + '۔',
            support,
            rsvp,
        ]
        if (school_name or '').strip():
            parts.insert(1, f'اسکول: {school_name.strip()}')
        return '\n\n'.join(p for p in parts if p)

    support = _support_block_en(principal_name, principal_phone, coach_hint)
    rsvp = (
        'If all details above are correct, tap **Yes** on this calendar invitation to confirm '
        'that your timetable slot is correct. If something is wrong, tap **No** or reach out '
        'using the contacts above.'
    )
    parts = [
        (
            f'This invitation was sent through {APP_NAME_EN} ({APP_URL}) under the NIETE programme. '
            'It reflects your school’s published timetable.'
        ),
        (
            f'Class: {cls or "—"}. Subject: {(subject or "").strip() or "—"}. '
            f'Day: {day}. Period: {period}.'
            + (f' Room: {room_line}.' if room_line else '')
        ),
        support,
        rsvp,
    ]
    if (school_name or '').strip():
        parts.insert(1, f'School: {school_name.strip()}')
    return '\n\n'.join(parts)
