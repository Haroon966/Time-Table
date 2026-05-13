import { useCallback, useMemo, useState } from 'react';
import type { Config } from './lib/timetableGenerator';
import { generate, type GenerateResult } from './lib/timetableGenerator';
import defaultConfig from '../fixtures/sample-config.json';
import './App.css';

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function entriesToCsv(entries: GenerateResult['entries']): string {
  const rows = entries as Array<Record<string, string | number>>;
  const header = ['teacher', 'grade', 'section', 'subject', 'day', 'period', 'room'];
  const lines = [header.join(',')];
  for (const e of rows) {
    lines.push(
      header
        .map((h) => {
          const v = e[h] ?? '';
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(',')
    );
  }
  return lines.join('\n');
}

export default function App() {
  const [jsonText, setJsonText] = useState(() => JSON.stringify(defaultConfig, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);

  const runGenerate = useCallback(() => {
    setError(null);
    setResult(null);
    try {
      const cfg = JSON.parse(jsonText) as Config;
      setResult(generate(cfg));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [jsonText]);

  const loadSample = useCallback(() => {
    setJsonText(JSON.stringify(defaultConfig, null, 2));
    setError(null);
    setResult(null);
  }, []);

  const downloadJson = useCallback(() => {
    if (!result) return;
    downloadText('timetable-result.json', JSON.stringify(result, null, 2), 'application/json');
  }, [result]);

  const downloadCsv = useCallback(() => {
    if (!result) return;
    downloadText('timetable-entries.csv', entriesToCsv(result.entries), 'text/csv;charset=utf-8');
  }, [result]);

  const days = useMemo(() => {
    if (!result?.timetable) return [];
    return result.timetable as Array<{ day: string; slots: unknown[] }>;
  }, [result]);

  return (
    <div className="app">
      <header className="header">
        <h1>School timetable generator</h1>
        <p className="tagline">
          Runs entirely in your browser — no server. Edit the JSON config, then generate.
        </p>
      </header>

      <section className="toolbar">
        <button type="button" className="btn primary" onClick={runGenerate}>
          Generate
        </button>
        <button type="button" className="btn" onClick={loadSample}>
          Load sample config
        </button>
        {result && (
          <>
            <button type="button" className="btn" onClick={downloadJson}>
              Download JSON
            </button>
            <button type="button" className="btn" onClick={downloadCsv}>
              Download CSV (entries)
            </button>
          </>
        )}
      </section>

      {error && <div className="alert error">{error}</div>}

      <div className="layout">
        <section className="panel">
          <h2>Config (JSON)</h2>
          <textarea
            className="json-input"
            spellCheck={false}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            aria-label="Timetable config JSON"
          />
        </section>

        <section className="panel grow">
          <h2>Result</h2>
          {!result && !error && <p className="muted">Click Generate to see the timetable and warnings.</p>}
          {result && (
            <>
              {result.warnings.length > 0 && (
                <div className="warnings">
                  <h3>Warnings</h3>
                  <ul>
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              <h3>Week view</h3>
              <div className="week-grid">
                {days.map((d) => (
                  <div key={d.day} className="day-card">
                    <h4>{d.day}</h4>
                    <ul className="slot-list">
                      {(d.slots as Array<Record<string, unknown>>).map((slot, idx) => (
                        <li key={idx} className={slot.type === 'break' ? 'slot break' : 'slot'}>
                          {slot.type === 'break' ? (
                            <span className="break-label">{String(slot.label)}</span>
                          ) : (
                            <>
                              <span className="period-label">{String(slot.label)}</span>
                              <ul className="assignments">
                                {(
                                  (slot.assignments as Array<Record<string, string>>) ?? []
                                ).map((a, j) => (
                                  <li key={j}>
                                    <strong>{String(a.grade)}-{String(a.section)}</strong>{' '}
                                    {a.subject} — {a.teacher_name}
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
