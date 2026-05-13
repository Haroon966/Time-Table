"""Create/update Google Calendar events from TimeTable rows (principal OAuth)."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from notes.models import UserProfile

from .calendar_invite_templates import build_description, build_summary
from .google_token_crypto import decrypt_refresh_token
from .models import (
    PrincipalGoogleCalendarConnection,
    SchoolBellSchedule,
    SchoolTimetableDefaults,
    Staff,
    TimeTable,
    TimetableGoogleCalendarEvent,
)
from .timetable_constants import MAX_TIMETABLE_PERIODS

User = get_user_model()
logger = logging.getLogger(__name__)

CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

DAY_NAME_TO_PY_WEEKDAY = {
    'Monday': 0,
    'Tuesday': 1,
    'Wednesday': 2,
    'Thursday': 3,
    'Friday': 4,
    'Saturday': 5,
    'Sunday': 6,
}

RRULE_BYDAY = {
    'Monday': 'MO',
    'Tuesday': 'TU',
    'Wednesday': 'WE',
    'Thursday': 'TH',
    'Friday': 'FR',
    'Saturday': 'SA',
    'Sunday': 'SU',
}


def _calendar_service_for_principal(user: User):
    conn = PrincipalGoogleCalendarConnection.objects.filter(user=user).first()
    if not conn or not conn.refresh_token_encrypted:
        raise ValueError('Google Calendar is not connected for this principal.')
    cid = getattr(settings, 'GOOGLE_OAUTH_CLIENT_ID', '') or ''
    csec = getattr(settings, 'GOOGLE_OAUTH_CLIENT_SECRET', '') or ''
    if not cid or not csec:
        raise ValueError('Google OAuth is not configured on the server (missing client id/secret).')
    refresh = decrypt_refresh_token(conn.refresh_token_encrypted)
    creds = Credentials(
        token=None,
        refresh_token=refresh,
        token_uri='https://oauth2.googleapis.com/token',
        client_id=cid,
        client_secret=csec,
        scopes=[CALENDAR_SCOPE],
    )
    creds.refresh(Request())
    return build('calendar', 'v3', credentials=creds, cache_discovery=False)


def _parse_hhmm(s: str):
    s = (s or '').strip()
    if not s:
        raise ValueError('empty time')
    parts = s.split(':')
    if len(parts) < 2:
        raise ValueError('time must be HH:MM')
    h = int(parts[0])
    m = int(parts[1])
    return datetime(2000, 1, 1, h, m).time()


def _first_occurrence_datetime(day_name: str, start_t, tz_name: str) -> datetime:
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo('Asia/Karachi')
    wd = DAY_NAME_TO_PY_WEEKDAY.get(day_name)
    if wd is None:
        raise ValueError(f'Unknown weekday: {day_name}')
    now = datetime.now(tz)
    d = now.date()
    days_ahead = (wd - d.weekday()) % 7
    cand = d + timedelta(days=days_ahead)
    dt = datetime.combine(cand, start_t, tzinfo=tz)
    while dt <= now:
        dt += timedelta(days=7)
    return dt


def _period_times(period_bounds: dict, period_label: str) -> tuple:
    row = (period_bounds or {}).get(period_label) or {}
    start_s = row.get('start')
    end_s = row.get('end')
    if not start_s or not end_s:
        raise ValueError(f'Missing bell times for {period_label}')
    return _parse_hhmm(str(start_s)), _parse_hhmm(str(end_s))


def _profile_contact(principal_user: User) -> tuple[str, str, str]:
    """principal display name, phone, optional coach line (empty for now)."""
    prof = UserProfile.objects.filter(user=principal_user).first()
    if not prof:
        return '', '', ''
    name = (getattr(prof, 'name', None) or '').strip()
    phone = (getattr(prof, 'phone_number', None) or '').strip()
    return name, phone, ''


def sync_principal_timetable_to_google(
    principal_user: User,
    *,
    lang: str = 'en',
    pause_seconds: float = 0.08,
) -> dict[str, Any]:
    """
    Upsert Google Calendar events for all TimeTable rows owned by this principal.
    Returns summary dict (never raises for single-row failures; aggregates errors).
    """
    out: dict[str, Any] = {
        'ok': True,
        'rows_total': 0,
        'rows_synced': 0,
        'rows_skipped_no_teacher_email': 0,
        'rows_failed': 0,
        'errors': [],
    }
    try:
        service = _calendar_service_for_principal(principal_user)
    except Exception as e:
        out['ok'] = False
        out['errors'].append(str(e))
        return out

    bell = SchoolBellSchedule.objects.filter(user=principal_user).first()
    if not bell or not isinstance(bell.period_bounds, dict) or not bell.period_bounds:
        out['ok'] = False
        out['errors'].append('Bell schedule is not configured.')
        return out

    tz_name = (bell.timezone or 'Asia/Karachi').strip() or 'Asia/Karachi'
    defaults = SchoolTimetableDefaults.objects.filter(user=principal_user).first()
    ppd = int(defaults.default_periods_per_day) if defaults else 5
    ppd = max(1, min(ppd, MAX_TIMETABLE_PERIODS))
    period_keys = [f'Period {i}' for i in range(1, ppd + 1)]
    for pk in period_keys:
        if pk not in bell.period_bounds:
            out['ok'] = False
            out['errors'].append(f'Bell schedule incomplete: missing {pk}')
            return out

    school_name = ''
    prof0 = UserProfile.objects.filter(user=principal_user).first()
    if prof0:
        school_name = (getattr(prof0, 'school_name', None) or '').strip()

    pname, pphone, coach = _profile_contact(principal_user)

    qs = TimeTable.objects.filter(user=principal_user).select_related('teacher')
    out['rows_total'] = qs.count()

    calendar_id = 'primary'

    for entry in qs.iterator():
        try:
            teacher: Staff = entry.teacher
            email = (teacher.email or '').strip()
            if not email:
                out['rows_skipped_no_teacher_email'] += 1
                continue
            start_t, end_t = _period_times(bell.period_bounds, entry.period)
            start_dt = _first_occurrence_datetime(entry.day, start_t, tz_name)
            end_dt = start_dt.replace(
                hour=end_t.hour, minute=end_t.minute, second=0, microsecond=0
            )
            if end_dt <= start_dt:
                end_dt += timedelta(days=1)

            summary = build_summary(entry.grade, entry.section, entry.subject)
            description = build_description(
                lang=lang,
                school_name=school_name,
                grade=entry.grade,
                section=entry.section,
                subject=entry.subject,
                day=entry.day,
                period=entry.period,
                room=entry.room or '',
                principal_name=pname,
                principal_phone=pphone,
                coach_hint=coach,
            )
            byday = RRULE_BYDAY.get(entry.day)
            if not byday:
                raise ValueError(f'Bad day {entry.day}')

            body: dict[str, Any] = {
                'summary': summary,
                'description': description,
                'start': {'dateTime': start_dt.isoformat(), 'timeZone': tz_name},
                'end': {'dateTime': end_dt.isoformat(), 'timeZone': tz_name},
                'recurrence': [f'RRULE:FREQ=WEEKLY;BYDAY={byday}'],
                'attendees': [{'email': email}],
                'guestsCanInviteOthers': False,
                'guestsCanModify': False,
                'transparency': 'opaque',
            }

            mapped = TimetableGoogleCalendarEvent.objects.filter(timetable_entry=entry).first()
            if mapped:
                service.events().update(
                    calendarId=calendar_id,
                    eventId=mapped.google_event_id,
                    body=body,
                    sendUpdates='all',
                ).execute()
            else:
                created = (
                    service.events()
                    .insert(calendarId=calendar_id, body=body, sendUpdates='all')
                    .execute()
                )
                eid = created.get('id')
                if not eid:
                    raise ValueError('Google did not return an event id')
                TimetableGoogleCalendarEvent.objects.update_or_create(
                    timetable_entry=entry,
                    defaults={
                        'principal_user': principal_user,
                        'google_event_id': eid,
                    },
                )
            out['rows_synced'] += 1
            time.sleep(pause_seconds)
        except HttpError as he:
            out['rows_failed'] += 1
            msg = getattr(he, 'content', None) or str(he)
            out['errors'].append(f'row {entry.pk}: {msg[:500]}')
            logger.warning('Google Calendar sync failed for timetable %s: %s', entry.pk, he)
        except Exception as ex:
            out['rows_failed'] += 1
            out['errors'].append(f'row {entry.pk}: {ex}')
            logger.exception('Google Calendar sync failed for timetable %s', entry.pk)

    out['ok'] = out['rows_failed'] == 0
    return out
