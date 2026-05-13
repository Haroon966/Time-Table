# Generated manually - allow same teacher in same period (user resolves conflicts in UI)

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('school', '0028_staff_transfer_emis_fields'),
    ]

    operations = [
        migrations.AlterUniqueTogether(
            name='timetable',
            unique_together=set(),
        ),
    ]
