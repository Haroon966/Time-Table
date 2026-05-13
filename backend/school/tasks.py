"""Celery tasks for the school app."""

import logging

from celery import shared_task
from django.contrib.auth import get_user_model

from .google_calendar_sync import sync_principal_timetable_to_google

User = get_user_model()
logger = logging.getLogger(__name__)


@shared_task(bind=True)
def sync_timetable_google_calendar_task(self, principal_user_id: int, lang: str = 'en'):
    """
    Background sync of principal timetable rows to Google Calendar.
    Returns a JSON-serializable summary dict.
    """
    try:
        user = User.objects.get(pk=principal_user_id)
    except User.DoesNotExist:
        logger.warning('sync_timetable_google_calendar_task: user %s not found', principal_user_id)
        return {'ok': False, 'errors': ['User not found']}

    try:
        summary = sync_principal_timetable_to_google(user, lang=lang or 'en')
    except Exception:
        logger.exception('sync_timetable_google_calendar_task failed user=%s', principal_user_id)
        return {'ok': False, 'errors': ['Unexpected error during sync']}

    logger.info(
        'sync_timetable_google_calendar_task user=%s synced=%s failed=%s skipped=%s',
        principal_user_id,
        summary.get('rows_synced'),
        summary.get('rows_failed'),
        summary.get('rows_skipped_no_teacher_email'),
    )
    return summary
