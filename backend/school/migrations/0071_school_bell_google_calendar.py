# Generated manually for school bell schedule + Google Calendar mapping

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('school', '0070_alter_timetable_day_sunday'),
    ]

    operations = [
        migrations.CreateModel(
            name='SchoolBellSchedule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('emis_code', models.CharField(blank=True, max_length=50, null=True)),
                (
                    'timezone',
                    models.CharField(
                        default='Asia/Karachi',
                        help_text='IANA timezone for period times (e.g. Asia/Karachi)',
                        max_length=64,
                    ),
                ),
                (
                    'period_bounds',
                    models.JSONField(
                        blank=True,
                        default=dict,
                        help_text='Map period label to {start, end} as "HH:MM" 24h, e.g. {"Period 1": {"start": "08:00", "end": "08:45"}}',
                    ),
                ),
                ('updated_at', models.DateTimeField(auto_now=True)),
                (
                    'user',
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='school_bell_schedule',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                'verbose_name': 'School bell schedule',
                'verbose_name_plural': 'School bell schedules',
            },
        ),
        migrations.CreateModel(
            name='PrincipalGoogleCalendarConnection',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('refresh_token_encrypted', models.TextField(blank=True, default='')),
                ('organizer_email', models.CharField(blank=True, default='', max_length=254)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                (
                    'user',
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='principal_google_calendar',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                'verbose_name': 'Principal Google Calendar connection',
            },
        ),
        migrations.CreateModel(
            name='TimetableGoogleCalendarEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('google_event_id', models.CharField(max_length=256)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                (
                    'principal_user',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='timetable_google_calendar_events',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'timetable_entry',
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='google_calendar_event',
                        to='school.timetable',
                    ),
                ),
            ],
        ),
        migrations.AddIndex(
            model_name='timetablegooglecalendarevent',
            index=models.Index(fields=['principal_user', 'google_event_id'], name='school_timet_principal_2b0fbd_idx'),
        ),
    ]
