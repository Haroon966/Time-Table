# Generated migration to ensure section field exists in TimeTable
# This migration ensures the section field is properly configured and handles any NULL values

from django.db import migrations, models


def ensure_section_field_exists(apps, schema_editor):
    """Ensure section field exists and set default for NULL values"""
    TimeTable = apps.get_model('school', 'TimeTable')
    # Update any NULL section values to empty string
    # This handles cases where the field might have NULL values instead of empty strings
    db_alias = schema_editor.connection.alias
    TimeTable.objects.using(db_alias).filter(section__isnull=True).update(section='')
    # Also trim any whitespace from existing section values
    for timetable in TimeTable.objects.using(db_alias).all():
        if timetable.section:
            timetable.section = timetable.section.strip()
            timetable.save(update_fields=['section'])


def reverse_ensure_section_field(apps, schema_editor):
    """Reverse migration - no action needed"""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('school', '0013_billaccount'),
    ]

    operations = [
        # Ensure section field exists and is properly configured with default empty string
        migrations.AlterField(
            model_name='timetable',
            name='section',
            field=models.CharField(blank=True, default='', help_text='Section (if applicable)', max_length=10),
        ),
        # Run data migration to set default for any NULL values and normalize existing values
        migrations.RunPython(ensure_section_field_exists, reverse_ensure_section_field),
    ]

