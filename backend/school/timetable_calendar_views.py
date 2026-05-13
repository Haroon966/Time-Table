"""Bell schedule + principal Google Calendar OAuth and timetable sync API."""

from __future__ import annotations

import logging
from urllib.parse import urlencode

import requests
from django.conf import settings
from django.contrib.auth.models import User
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.http import HttpResponseRedirect
from django.urls import reverse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from flags.permissions import RequireFeatureFlag
from notes.models import UserProfile
from notes.permissions import PRINCIPAL_GROUP_NAME

from .models import PrincipalGoogleCalendarConnection, SchoolBellSchedule, SchoolTimetableDefaults
from .serializers import SchoolBellScheduleSerializer
from .timetable_constants import MAX_TIMETABLE_PERIODS
from .tasks import sync_timetable_google_calendar_task
from .google_token_crypto import encrypt_refresh_token

logger = logging.getLogger(__name__)

GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
STATE_SIGNER_SALT = 'myschool.timetable.google_calendar'


def _is_principal(user: User) -> bool:
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False):
        return True
    return user.groups.filter(name=PRINCIPAL_GROUP_NAME).exists()


def _get_or_create_school_bell_schedule(user: User) -> SchoolBellSchedule:
    profile = UserProfile.objects.filter(user=user).first()
    emis = str(profile.emis_code).strip() if profile and profile.emis_code else None
    obj, _ = SchoolBellSchedule.objects.get_or_create(
        user=user,
        defaults={
            'emis_code': emis or '',
            'timezone': 'Asia/Karachi',
            'period_bounds': {},
        },
    )
    if emis and not (obj.emis_code or '').strip():
        obj.emis_code = emis
        obj.save(update_fields=['emis_code'])
    return obj


def _required_period_keys_for_user(user: User) -> list[str]:
    d = SchoolTimetableDefaults.objects.filter(user=user).first()
    ppd = int(d.default_periods_per_day) if d else 5
    ppd = max(1, min(ppd, MAX_TIMETABLE_PERIODS))
    return [f'Period {i}' for i in range(1, ppd + 1)]


def _oauth_redirect_uri(request) -> str:
    explicit = (getattr(settings, 'GOOGLE_OAUTH_REDIRECT_URI', None) or '').strip()
    if explicit:
        return explicit
    return request.build_absolute_uri(reverse('timetable-google-oauth-callback'))


class SchoolBellScheduleViewSet(viewsets.GenericViewSet):
    """GET/PATCH bell schedule for the authenticated principal."""

    queryset = SchoolBellSchedule.objects.all()
    permission_classes = [IsAuthenticated, RequireFeatureFlag]
    required_feature = 'timetable'
    serializer_class = SchoolBellScheduleSerializer

    @action(detail=False, methods=['get', 'patch'], url_path='current')
    def current(self, request):
        if not _is_principal(request.user):
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
        obj = _get_or_create_school_bell_schedule(request.user)
        if request.method == 'GET':
            ser = self.get_serializer(obj)
            return Response(
                {
                    **ser.data,
                    'required_period_keys': _required_period_keys_for_user(request.user),
                }
            )
        if hasattr(request.data, 'copy'):
            data = request.data.copy()
        else:
            data = dict(request.data)
        if isinstance(data, dict) and 'period_bounds' in data:
            merged = {**(obj.period_bounds or {}), **(data.get('period_bounds') or {})}
            data['period_bounds'] = merged
        ser = self.get_serializer(
            obj,
            data=data,
            partial=True,
            context={'required_period_keys': _required_period_keys_for_user(request.user)},
        )
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(
            {
                **ser.data,
                'required_period_keys': _required_period_keys_for_user(request.user),
            }
        )


class TimetableGoogleCalendarViewSet(viewsets.GenericViewSet):
    """Google Calendar connect + sync (feature-flagged)."""

    queryset = PrincipalGoogleCalendarConnection.objects.none()
    permission_classes = [IsAuthenticated, RequireFeatureFlag]
    required_feature = 'timetable_google_calendar'

    @action(detail=False, methods=['get'], url_path='status')
    def status(self, request):
        if not _is_principal(request.user):
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
        conn = PrincipalGoogleCalendarConnection.objects.filter(user=request.user).first()
        connected = bool(conn and conn.refresh_token_encrypted)
        return Response(
            {
                'connected': connected,
                'organizer_email': (conn.organizer_email if conn else '') or '',
                'oauth_configured': bool(
                    getattr(settings, 'GOOGLE_OAUTH_CLIENT_ID', '')
                    and getattr(settings, 'GOOGLE_OAUTH_CLIENT_SECRET', '')
                ),
            }
        )

    @action(detail=False, methods=['get'], url_path='authorize-url')
    def authorize_url(self, request):
        if not _is_principal(request.user):
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
        cid = getattr(settings, 'GOOGLE_OAUTH_CLIENT_ID', '') or ''
        if not cid:
            return Response(
                {'detail': 'Google OAuth is not configured (GOOGLE_OAUTH_CLIENT_ID).'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        redirect_uri = _oauth_redirect_uri(request)
        signer = TimestampSigner(salt=STATE_SIGNER_SALT)
        state = signer.sign(str(request.user.pk))
        params = {
            'client_id': cid,
            'redirect_uri': redirect_uri,
            'response_type': 'code',
            'scope': CALENDAR_SCOPE,
            'access_type': 'offline',
            'prompt': 'consent',
            'include_granted_scopes': 'true',
            'state': state,
        }
        url = f'{GOOGLE_AUTH_URL}?{urlencode(params)}'
        return Response({'authorization_url': url, 'redirect_uri': redirect_uri})

    @action(detail=False, methods=['post'], url_path='disconnect')
    def disconnect(self, request):
        if not _is_principal(request.user):
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
        PrincipalGoogleCalendarConnection.objects.filter(user=request.user).delete()
        return Response({'ok': True})

    @action(detail=False, methods=['post'], url_path='sync')
    def sync(self, request):
        if not _is_principal(request.user):
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
        lang = (request.data.get('lang') or request.query_params.get('lang') or 'en')[:8]
        async_result = sync_timetable_google_calendar_task.delay(request.user.pk, lang=lang)
        payload = {'queued': True, 'task_id': async_result.id}
        if getattr(settings, 'CELERY_TASK_ALWAYS_EAGER', False):
            payload['queued'] = False
            payload['result'] = async_result.result
        return Response(payload, status=status.HTTP_202_ACCEPTED if payload['queued'] else status.HTTP_200_OK)


def _exchange_code(code: str, redirect_uri: str) -> dict:
    cid = getattr(settings, 'GOOGLE_OAUTH_CLIENT_ID', '') or ''
    csec = getattr(settings, 'GOOGLE_OAUTH_CLIENT_SECRET', '') or ''
    r = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            'code': code,
            'client_id': cid,
            'client_secret': csec,
            'redirect_uri': redirect_uri,
            'grant_type': 'authorization_code',
        },
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


def _userinfo_email(access_token: str) -> str:
    r = requests.get(
        GOOGLE_USERINFO_URL,
        headers={'Authorization': f'Bearer {access_token}'},
        timeout=15,
    )
    r.raise_for_status()
    return (r.json() or {}).get('email') or ''


@csrf_exempt
@require_GET
def timetable_google_oauth_callback(request):
    """Browser redirect target for Google OAuth (no JWT)."""
    front = getattr(settings, 'FRONTEND_BASE_URL', 'https://myschool.niete.pk').rstrip('/')
    err_url = f'{front}/timetable?google_calendar=error'

    code = (request.GET.get('code') or '').strip()
    state = (request.GET.get('state') or '').strip()
    if not code or not state:
        return HttpResponseRedirect(err_url)

    signer = TimestampSigner(salt=STATE_SIGNER_SALT)
    try:
        uid = int(signer.unsign(state, max_age=900))
    except (BadSignature, SignatureExpired, ValueError, TypeError):
        logger.warning('Google OAuth callback: bad state')
        return HttpResponseRedirect(err_url)

    user = User.objects.filter(pk=uid).first()
    if not user or not _is_principal(user):
        return HttpResponseRedirect(err_url)

    redirect_uri = _oauth_redirect_uri(request)
    try:
        token_payload = _exchange_code(code, redirect_uri)
    except Exception as e:
        logger.exception('Google OAuth token exchange failed: %s', e)
        return HttpResponseRedirect(err_url)

    refresh = token_payload.get('refresh_token') or ''
    access = token_payload.get('access_token') or ''
    if not refresh:
        logger.warning('Google OAuth: no refresh_token (user may need prompt=consent)')
        return HttpResponseRedirect(f'{front}/timetable?google_calendar=no_refresh')

    email = ''
    if access:
        try:
            email = _userinfo_email(access)
        except Exception:
            pass

    enc = encrypt_refresh_token(refresh)
    PrincipalGoogleCalendarConnection.objects.update_or_create(
        user=user,
        defaults={
            'refresh_token_encrypted': enc,
            'organizer_email': email,
        },
    )
    return HttpResponseRedirect(f'{front}/timetable?google_calendar=connected')
