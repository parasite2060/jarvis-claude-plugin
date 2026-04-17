// Synthetic fake secrets for regex tests. Not real credentials.
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
      const content = '{"header":"Bearer abcdefghijklmnopqrstuvwxyz1234567890"}';
      const result = filterSensitiveData(content);
      expect(result).toContain('[REDACTED_TOKEN]');
      expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
    });

    it('redacts JWT-shaped Bearer tokens as JWT (more specific placeholder)', () => {
      const content = '{"header":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.defghijklmno"}';
      const result = filterSensitiveData(content);
      expect(result).toContain('[REDACTED_JWT]');
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

    it('redacts Anthropic sk-ant- API keys', () => {
      const content = 'ANTHROPIC=sk-ant-FAKETESTKEYFORUNITTESTS000000000';
      const result = filterSensitiveData(content);
      expect(result).toContain('[REDACTED_API_KEY]');
      expect(result).not.toContain('sk-ant-FAKETESTKEYFORUNITTESTS000000000');
    });

    it('redacts GitHub personal access tokens', () => {
      const content = 'my PAT is ghp_FAKETESTTOKENFORUNITTESTS00000000000 for ci';
      const result = filterSensitiveData(content);
      expect(result).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(result).not.toContain('ghp_FAKETESTTOKENFORUNITTESTS00000000000');
    });

    it('redacts GitHub OAuth tokens (gho_)', () => {
      const content = 'OAuth gho_FAKETESTTOKENFORUNITTESTS00000000000 issued';
      const result = filterSensitiveData(content);
      expect(result).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(result).not.toContain('gho_FAKETESTTOKENFORUNITTESTS00000000000');
    });

    it('redacts Google API keys', () => {
      const content = 'GOOGLE_API_KEY: AIzaSyFAKETESTKEYFORUNITTESTS0000000000';
      const result = filterSensitiveData(content);
      expect(result).toContain('[REDACTED_GOOGLE_KEY]');
      expect(result).not.toContain('AIzaSyFAKETESTKEYFORUNITTESTS0000000000');
    });

    it('redacts Slack tokens', () => {
      const content = 'slack=xoxb-FAKE-FAKE-FAKE-FAKETOKENUNITTESTS';
      const result = filterSensitiveData(content);
      expect(result).toContain('[REDACTED_SLACK_TOKEN]');
      expect(result).not.toContain('xoxb-FAKE-FAKE-FAKE-FAKETOKENUNITTESTS');
    });

    it('redacts JWT tokens', () => {
      const content =
        'Authorization: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.FAKETESTSIGNATUREFORUNITTESTS';
      const result = filterSensitiveData(content);
      expect(result).toContain('[REDACTED_JWT]');
      expect(result).not.toContain(
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.FAKETESTSIGNATUREFORUNITTESTS'
      );
    });

    it('JWT regex stops at the third segment — mirrors Python semantics (AC7 parity)', () => {
      const content = 'eyJaaa.bbb.ccc trailing prose';
      const result = filterSensitiveData(content);
      expect(result).toBe('[REDACTED_JWT] trailing prose');
    });

    it('JWT regex leaves a 4th dotted segment intact — no over-greedy match', () => {
      const content = 'eyJaaa.bbb.ccc.ddd.eee after';
      const result = filterSensitiveData(content);
      expect(result).toBe('[REDACTED_JWT].ddd.eee after');
    });

    it('redacts multi-line PEM private key blocks', () => {
      const content = [
        'Here is my key:',
        '-----BEGIN RSA PRIVATE KEY-----',
        'FAKEPEMBODYLINE1FAKEPEMBODYLINE1',
        'FAKEPEMBODYLINE2FAKEPEMBODYLINE2',
        '-----END RSA PRIVATE KEY-----',
        'End.',
      ].join('\n');
      const result = filterSensitiveData(content);
      expect(result).toContain('[REDACTED_PEM]');
      expect(result).not.toContain('FAKEPEMBODYLINE1');
      expect(result).not.toContain('BEGIN RSA PRIVATE KEY');
    });

    it('redacts postgres connection string credentials', () => {
      const content = 'DB_URL=postgres://testuser:testfakepassword@host:5432/db';
      const result = filterSensitiveData(content);
      expect(result).toContain('postgres://[REDACTED_USER]:[REDACTED_PW]@host:5432/db');
      expect(result).not.toContain('testuser');
      expect(result).not.toContain('testfakepassword');
    });

    it('redacts mongodb+srv connection string credentials', () => {
      const content = 'mongodb+srv://appuser:fakeapppass@cluster0.example.mongodb.net/app';
      const result = filterSensitiveData(content);
      expect(result).toContain('[REDACTED_USER]:[REDACTED_PW]@');
      expect(result).not.toContain('fakeapppass');
    });

    it('redacts https basic-auth credentials', () => {
      const content = 'https://me:fakesecretvalue@example.com/path';
      const result = filterSensitiveData(content);
      expect(result).toContain('https://[REDACTED_USER]:[REDACTED_PW]@example.com/path');
      expect(result).not.toContain('fakesecretvalue');
    });

    it('redacts CLIENT_SECRET and AUTH_SECRET env assignments', () => {
      const content = 'CLIENT_SECRET=fakeClientSecretValue AUTH_SECRET=fakeAuthSecretValue';
      const result = filterSensitiveData(content);
      expect(result).toContain('CLIENT_SECRET=[REDACTED]');
      expect(result).toContain('AUTH_SECRET=[REDACTED]');
      expect(result).not.toContain('fakeClientSecretValue');
      expect(result).not.toContain('fakeAuthSecretValue');
    });

    it('redacts JSON refresh_token and client_secret fields', () => {
      const content =
        '{"refresh_token": "fakeRefresh_abc123", "client_secret": "fakeClientSecretValue"}';
      const result = filterSensitiveData(content);
      expect(result).not.toContain('fakeRefresh_abc123');
      expect(result).not.toContain('fakeClientSecretValue');
      expect(result).toContain('[REDACTED]');
    });
  });
});
