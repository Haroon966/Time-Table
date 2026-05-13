from django.db import migrations


def add_flag(apps, schema_editor):
    FeatureFlag = apps.get_model('flags', 'FeatureFlag')
    FeatureFlag.objects.get_or_create(
        key='timetable_google_calendar',
        defaults={
            'description': (
                'Principal: connect Google Calendar and sync timetable invites to teachers (Calendar API).'
            ),
            'enabled_for_roles': ['Principal'],
            'is_active': True,
        },
    )


def remove_flag(apps, schema_editor):
    FeatureFlag = apps.get_model('flags', 'FeatureFlag')
    FeatureFlag.objects.filter(key='timetable_google_calendar').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('flags', '0009_enable_staff_feature_for_teachers'),
    ]

    operations = [
        migrations.RunPython(add_flag, remove_flag),
    ]
