import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readTranscript, filterSensitiveData } from '../../hooks/lib/transcript.js';
import * as fs from 'node:fs';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

describe('transcript module', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readTranscript', () => {
    it('reads a JSONL file and returns string content', () => {
      const mockContent = '{"type":"human","message":{"role":"user","content":"hello"}}\n{"type":"assistant","message":{"role":"assistant","content":"hi"}}\n';
      fs.readFileSync.mockReturnValue(mockContent);

      const result = readTranscript('/tmp/transcript.jsonl');

      expect(result).toBe(mockContent);
      expect(fs.readFileSync).toHaveBeenCalledWith('/tmp/transcript.jsonl', 'utf8');
    });

    it('returns null for non-existent file', () => {
      const err = new Error('ENOENT: no such file or directory');
      err.code = 'ENOENT';
      fs.readFileSync.mockImplementation(() => { throw err; });

      const result = readTranscript('/tmp/nonexistent.jsonl');

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('jarvis.transcript.read-error:')
      );
    });

    it('returns null for unreadable file (permission denied)', () => {
      const err = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      fs.readFileSync.mockImplementation(() => { throw err; });

      const result = readTranscript('/tmp/protected.jsonl');

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('jarvis.transcript.read-error:')
      );
    });
  });

  describe('filterSensitiveData', () => {
    it('redacts sk-... API key patterns', () => {
      const content = '{"content":"my key is sk-abcdefghijklmnopqrstuvwxyz1234567890abcd"}';
      const result = filterSensitiveData(content);
      expect(result).toContain('[REDACTED_API_KEY]');
      expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    });

    it('redacts Bearer <token> patterns', () => {
      const content = '{"header":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.defghijklmno"}';
      const result = filterSensitiveData(content);
      expect(result).toContain('[REDACTED_TOKEN]');
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });

    it('redacts "password": "value" patterns', () => {
      const content = '{"password": "my-super-secret-pass"}';
      const result = filterSensitiveData(content);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('my-super-secret-pass');
    });

    it('redacts API_KEY=value environment variable patterns', () => {
      const content = 'API_KEY=sk123456 and SECRET=mysecretvalue';
      const result = filterSensitiveData(content);
      expect(result).toContain('API_KEY=[REDACTED]');
      expect(result).toContain('SECRET=[REDACTED]');
      expect(result).not.toContain('sk123456');
      expect(result).not.toContain('mysecretvalue');
    });

    it('redacts AWS access key patterns', () => {
      const content = '{"key":"AKIAIOSFODNN7EXAMPLE"}';
      const result = filterSensitiveData(content);
      expect(result).toContain('[REDACTED_AWS_KEY]');
      expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('preserves normal conversation text (no false positives)', () => {
      const content = '{"content":"The password is complex. Use a token-based approach for authentication. The secret to good code is simplicity."}';
      const result = filterSensitiveData(content);
      expect(result).toBe(content);
    });

    it('handles empty string input', () => {
      const result = filterSensitiveData('');
      expect(result).toBe('');
    });
  });
});
