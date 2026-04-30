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
  '../../hooks/lib/secret_patterns.json',
);

const data = JSON.parse(readFileSync(PATTERNS_JSON_PATH, 'utf8'));

const PATTERN_ROWS = data.patterns.map((entry, index) => ({
  name: entry.name,
  entry,
  compiled: SECRET_PATTERNS[index],
}));

describe('secret_patterns.json structure', () => {
  it('should have version 1 and a non-empty patterns array', () => {
    // Act & Assert
    expect(data.version).toBe(1);
    expect(Array.isArray(data.patterns)).toBe(true);
    expect(data.patterns.length).toBeGreaterThan(0);
  });

  it.each(data.patterns)('should have required fields when entry is named "$name"', (entry) => {
    // Act & Assert
    expect(entry).toHaveProperty('name');
    expect(entry).toHaveProperty('regex');
    expect(entry).toHaveProperty('flags');
    expect(['literal', 'backref', 'function']).toContain(entry.replacement_type);
    if (entry.replacement_type === 'function') {
      expect(entry).toHaveProperty('function');
    } else {
      expect(entry).toHaveProperty('replacement');
    }
  });
});

describe('pattern count and order parity', () => {
  it('should match JSON pattern count when SECRET_PATTERNS is loaded', () => {
    // Act & Assert
    expect(SECRET_PATTERNS.length).toBe(data.patterns.length);
  });

  it('should match JSON pattern names in order when SECRET_PATTERNS is loaded', () => {
    // Act & Assert
    expect(SECRET_PATTERNS.map((p) => p.name)).toEqual(data.patterns.map((e) => e.name));
  });
});

describe('regex source parity', () => {
  it.each(PATTERN_ROWS)('should match JSON regex source when pattern is "$name"', ({ entry, compiled }) => {
    // Act & Assert
    expect(compiled.regex.source).toBe(new RegExp(entry.regex).source);
  });

  it.each(PATTERN_ROWS)('should include every JSON flag (excluding "g") when pattern is "$name"', ({ entry, compiled }) => {
    // Act & Assert
    for (const flag of entry.flags) {
      expect(compiled.regex.flags).toContain(flag);
    }
  });
});

describe('replacement parity', () => {
  it.each(PATTERN_ROWS)('should resolve replacement matching JSON when pattern is "$name"', ({ entry, compiled }) => {
    // Act & Assert
    if (entry.replacement_type === 'literal' || entry.replacement_type === 'backref') {
      expect(compiled.replacement).toBe(entry.replacement);
    } else {
      expect(typeof compiled.replacement).toBe('function');
    }
  });
});

describe('portability constraints', () => {
  it.each(data.patterns)('should not use Python-only named groups when entry is "$name"', (entry) => {
    // Act & Assert
    expect(entry.regex).not.toContain('(?P<');
    expect(entry.regex).not.toContain('(?P=');
  });

  it.each(data.patterns)('should not use inline flag syntax when entry is "$name"', (entry) => {
    // Act & Assert
    expect(/\(\?[ismx]+\)/.test(entry.regex)).toBe(false);
  });

  it.each(data.patterns)('should not use lookbehind assertions when entry is "$name"', (entry) => {
    // Act & Assert
    expect(entry.regex).not.toContain('(?<=');
    expect(entry.regex).not.toContain('(?<!');
  });
});
