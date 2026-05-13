# Timetable (GitHub Pages)

Static web app that builds school timetables **entirely in the browser**. There is no backend: open the site, edit the JSON config (or start from the sample), click **Generate**, then download JSON or CSV.

The scheduling logic is a TypeScript port of [`../../backend/school/timetable_generator.py`](../../backend/school/timetable_generator.py). Automated tests compare output to CPython for representative configs (see `fixtures/` and `src/lib/timetableGenerator.test.ts`).

## Local development

```bash
cd apps/timetable-pages
npm install
npm run dev
```

## Tests

```bash
npm test
```

Regenerating Python reference files (optional, requires Python 3):

```bash
# from repository root
python3 scripts/python_generate.py < apps/timetable-pages/fixtures/sample-config.json > apps/timetable-pages/fixtures/sample-expected.json
python3 scripts/dump_randbelow_trace.py < apps/timetable-pages/fixtures/sample-config.json > apps/timetable-pages/fixtures/sample-randbelow-trace.json
```

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions** (not “Deploy from a branch”).
3. Ensure the workflow **Deploy timetable Pages** runs on `main` (it builds with `BASE_PATH=/your-repo-name/` so assets resolve under project Pages).

For a **user or organization** site (`username.github.io` with site at `/`), set `BASE_PATH=/` in the workflow environment instead.

## Config format

The JSON body matches the Python `generate(config)` input: `periods_per_day`, `classes`, `teachers`, optional `weekly_load`, `working_days`, `day`, break fields, etc. Use **Load sample config** in the UI for a starting point.
