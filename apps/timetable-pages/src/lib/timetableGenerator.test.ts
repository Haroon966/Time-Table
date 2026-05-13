import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Config } from './timetableGenerator';
import { generate } from './timetableGenerator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '../../fixtures');

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8')) as unknown;
}

describe('generate parity with CPython', () => {
  it('matches single-subject output (shuffle order irrelevant for identical slots)', () => {
    const cfg = loadJson('single-subject-config.json') as Config;
    const expected = loadJson('single-subject-expected.json');
    const got = generate(cfg);
    expect(got).toEqual(expected);
  });

  it('matches dual-subject sample when using randbelow trace from Python random.seed(42)', () => {
    const cfg = loadJson('sample-config.json') as Config;
    const expected = loadJson('sample-expected.json');
    const trace = loadJson('sample-randbelow-trace.json') as [number, number][];
    const got = generate(cfg, { randbelowTrace: trace });
    expect(got).toEqual(expected);
  });
});
