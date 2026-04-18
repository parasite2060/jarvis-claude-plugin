// Parity tests for the JSON-driven secret scrubber (Story 11.7).
//
// Asserts that the loaded SECRET_PATTERNS faithfully reflects every entry in
// the vendored `secret_patterns.json` — count, regex source, replacement.
// Mirrors `test_secret_scrubber_json_parity.py` on the server side.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SECRET_PATTERNS } from '../../hooks/lib/transcript.js';

const PATTERNS_JSON_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../hooks/lib/secret_patterns.json'
);

const data = JSON.parse(readFileSync(PATTERNS_JSON_PATH, 'utf8'));

describe('secret_patterns.json structure', () => {
  it('has version 1 and a non-empty patterns array', () => {
    expect(data.version).toBe(1);
    expect(Array.isArray(data.patterns)).toBe(true);
    expect(data.patterns.length).toBeGreaterThan(0);
  });

  it('every pattern has the required fields', () => {
    for (const entry of data.patterns) {
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('regex');
      expect(entry).toHaveProperty('flags');
      expect(entry).toHaveProperty('replacement_type');
      expect(['literal', 'backref', 'function']).toContain(entry.replacement_type);

      if (entry.replacement_type === 'function') {
        expect(entry).toHaveProperty('function');
      } else {
        expect(entry).toHaveProperty('replacement');
      }
    }
  });
});

describe('pattern count and order parity', () => {
  it('loaded pattern count matches JSON', () => {
    expect(SECRET_PATTERNS.length).toBe(data.patterns.length);
  });

  it('pattern names match JSON in order', () => {
    const jsonNames = data.patterns.map((e) => e.name);
    const loadedNames = SECRET_PATTERNS.map((p) => p.name);
    expect(loadedNames).toEqual(jsonNames);
  });
});

describe('regex source parity', () => {
  it('each compiled regex source equals the JSON regex string', () => {
    for (let i = 0; i < SECRET_PATTERNS.length; i += 1) {
      const entry = data.patterns[i];
      const compiled = SECRET_PATTERNS[i].regex;
      expect(compiled.source).toBe(new RegExp(entry.regex).source);
    }
  });

  it('compiled flags include every JSON flag character (excluding "g")', () => {
    for (let i = 0; i < SECRET_PATTERNS.length; i += 1) {
      const entry = data.patterns[i];
      const compiled = SECRET_PATTERNS[i].regex;
      for (const flag of entry.flags) {
        expect(compiled.flags).toContain(flag);
      }
    }
  });
});

describe('replacement parity', () => {
  it('literal replacements equal JSON', () => {
    for (let i = 0; i < SECRET_PATTERNS.length; i += 1) {
      const entry = data.patterns[i];
      if (entry.replacement_type === 'literal') {
        expect(SECRET_PATTERNS[i].replacement).toBe(entry.replacement);
      }
    }
  });

  it('backref replacements equal JSON (JS uses $1 syntax natively)', () => {
    for (let i = 0; i < SECRET_PATTERNS.length; i += 1) {
      const entry = data.patterns[i];
      if (entry.replacement_type === 'backref') {
        expect(SECRET_PATTERNS[i].replacement).toBe(entry.replacement);
      }
    }
  });

  it('function replacements resolve to callables', () => {
    for (let i = 0; i < SECRET_PATTERNS.length; i += 1) {
      const entry = data.patterns[i];
      if (entry.replacement_type === 'function') {
        expect(typeof SECRET_PATTERNS[i].replacement).toBe('function');
      }
    }
  });
});

describe('portability constraints', () => {
  it('no Python-only named groups (?P<...> or (?P=...)', () => {
    for (const entry of data.patterns) {
      expect(entry.regex).not.toContain('(?P<');
      expect(entry.regex).not.toContain('(?P=');
    }
  });

  it('no inline flag syntax', () => {
    for (const entry of data.patterns) {
      expect(/\(\?[ismx]+\)/.test(entry.regex)).toBe(false);
    }
  });

  it('no lookbehind assertions', () => {
    for (const entry of data.patterns) {
      expect(entry.regex).not.toContain('(?<=');
      expect(entry.regex).not.toContain('(?<!');
    }
  });
});
