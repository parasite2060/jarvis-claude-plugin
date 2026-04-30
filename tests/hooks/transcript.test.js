// Synthetic fake secrets for regex tests. Not real credentials.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { realPatternsJson } = vi.hoisted(() => {
  const { readFileSync } = require('node:fs');
  const { fileURLToPath } = require('node:url');
  const { dirname, join } = require('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    realPatternsJson: readFileSync(
      join(here, '../../hooks/lib/secret_patterns.json'),
      'utf8'
    ),
  };
});

vi.mock('node:fs', () => ({
  readFileSync: vi.fn((path) => {
    if (typeof path === 'string' && path.endsWith('secret_patterns.json')) {
      return realPatternsJson;
    }
    throw new Error(`unexpected readFileSync mock call: ${path}`);
  }),
}));

import { readTranscript, filterSensitiveData } from '../../hooks/lib/transcript.js';
import * as fs from 'node:fs';

describe('transcript module', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readTranscript', () => {
    it('should return file content as a string when readFileSync succeeds', () => {
      // Arrange
      const mockContent = '{"type":"human","message":{"role":"user","content":"hello"}}\n{"type":"assistant","message":{"role":"assistant","content":"hi"}}\n';
      fs.readFileSync.mockReturnValue(mockContent);

      // Act
      const result = readTranscript('/tmp/transcript.jsonl');

      // Assert
      expect(result).toBe(mockContent);
      expect(fs.readFileSync).toHaveBeenCalledWith('/tmp/transcript.jsonl', 'utf8');
    });

    it('should return null when the file does not exist', () => {
      // Arrange
      const err = new Error('ENOENT: no such file or directory');
      err.code = 'ENOENT';
      fs.readFileSync.mockImplementation(() => { throw err; });

      // Act
      const result = readTranscript('/tmp/nonexistent.jsonl');

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when the file is unreadable', () => {
      // Arrange
      const err = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      fs.readFileSync.mockImplementation(() => { throw err; });

      // Act
      const result = readTranscript('/tmp/protected.jsonl');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('filterSensitiveData', () => {
    it('should redact sk-... API key when present', () => {
      // Arrange
      const content = '{"content":"my key is sk-abcdefghijklmnopqrstuvwxyz1234567890abcd"}';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('[REDACTED_API_KEY]');
      expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    });

    it('should redact Bearer <token> patterns when present', () => {
      // Arrange
      const content = '{"header":"Bearer abcdefghijklmnopqrstuvwxyz1234567890"}';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('[REDACTED_TOKEN]');
      expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
    });

    it('should redact Bearer <token> as JWT when token is JWT-shaped', () => {
      // Arrange
      const content = '{"header":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.defghijklmno"}';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('[REDACTED_JWT]');
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });

    it('should redact "password": "value" patterns when present', () => {
      // Arrange
      const content = '{"password": "my-super-secret-pass"}';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('my-super-secret-pass');
    });

    it('should redact API_KEY and SECRET env-var assignments when present', () => {
      // Arrange
      const content = 'API_KEY=sk123456 and SECRET=mysecretvalue';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('API_KEY=[REDACTED]');
      expect(result).toContain('SECRET=[REDACTED]');
      expect(result).not.toContain('sk123456');
      expect(result).not.toContain('mysecretvalue');
    });

    it('should redact AWS access key when present', () => {
      // Arrange
      const content = '{"key":"AKIAIOSFODNN7EXAMPLE"}';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('[REDACTED_AWS_KEY]');
      expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('should preserve normal conversation text when no secrets are present', () => {
      // Arrange
      const content = '{"content":"The password is complex. Use a token-based approach for authentication. The secret to good code is simplicity."}';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toBe(content);
    });

    it('should return empty string when input is empty', () => {
      // Act
      const result = filterSensitiveData('');

      // Assert
      expect(result).toBe('');
    });

    it('should redact Anthropic sk-ant- API key when present', () => {
      // Arrange
      const content = 'ANTHROPIC=sk-ant-FAKETESTKEYFORUNITTESTS000000000';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('[REDACTED_API_KEY]');
      expect(result).not.toContain('sk-ant-FAKETESTKEYFORUNITTESTS000000000');
    });

    it('should redact GitHub personal access token when present', () => {
      // Arrange
      const content = 'my PAT is ghp_FAKETESTTOKENFORUNITTESTS00000000000 for ci';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(result).not.toContain('ghp_FAKETESTTOKENFORUNITTESTS00000000000');
    });

    it('should redact GitHub OAuth token when prefixed with gho_', () => {
      // Arrange
      const content = 'OAuth gho_FAKETESTTOKENFORUNITTESTS00000000000 issued';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(result).not.toContain('gho_FAKETESTTOKENFORUNITTESTS00000000000');
    });

    it('should redact Google API key when present', () => {
      // Arrange
      const content = 'GOOGLE_API_KEY: AIzaSyFAKETESTKEYFORUNITTESTS0000000000';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('[REDACTED_GOOGLE_KEY]');
      expect(result).not.toContain('AIzaSyFAKETESTKEYFORUNITTESTS0000000000');
    });

    it('should redact Slack token when present', () => {
      // Arrange
      const content = 'slack=xoxb-FAKE-FAKE-FAKE-FAKETOKENUNITTESTS';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('[REDACTED_SLACK_TOKEN]');
      expect(result).not.toContain('xoxb-FAKE-FAKE-FAKE-FAKETOKENUNITTESTS');
    });

    it('should redact JWT token when present', () => {
      // Arrange
      const content =
        'Authorization: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.FAKETESTSIGNATUREFORUNITTESTS';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('[REDACTED_JWT]');
      expect(result).not.toContain(
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.FAKETESTSIGNATUREFORUNITTESTS'
      );
    });

    it('should stop the JWT regex at the third segment to mirror Python semantics', () => {
      // Arrange
      const content = 'eyJaaa.bbb.ccc trailing prose';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toBe('[REDACTED_JWT] trailing prose');
    });

    it('should leave a 4th dotted segment intact when JWT pattern matches the first three', () => {
      // Arrange
      const content = 'eyJaaa.bbb.ccc.ddd.eee after';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toBe('[REDACTED_JWT].ddd.eee after');
    });

    it('should redact multi-line PEM private key block when present', () => {
      // Arrange
      const content = [
        'Here is my key:',
        '-----BEGIN RSA PRIVATE KEY-----',
        'FAKEPEMBODYLINE1FAKEPEMBODYLINE1',
        'FAKEPEMBODYLINE2FAKEPEMBODYLINE2',
        '-----END RSA PRIVATE KEY-----',
        'End.',
      ].join('\n');

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('[REDACTED_PEM]');
      expect(result).not.toContain('FAKEPEMBODYLINE1');
      expect(result).not.toContain('BEGIN RSA PRIVATE KEY');
    });

    it('should redact postgres connection string credentials when present', () => {
      // Arrange
      const content = 'DB_URL=postgres://testuser:testfakepassword@host:5432/db';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('postgres://[REDACTED_USER]:[REDACTED_PW]@host:5432/db');
      expect(result).not.toContain('testuser');
      expect(result).not.toContain('testfakepassword');
    });

    it('should redact mongodb+srv connection string credentials when present', () => {
      // Arrange
      const content = 'mongodb+srv://appuser:fakeapppass@cluster0.example.mongodb.net/app';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('[REDACTED_USER]:[REDACTED_PW]@');
      expect(result).not.toContain('fakeapppass');
    });

    it('should redact https basic-auth credentials when present', () => {
      // Arrange
      const content = 'https://me:fakesecretvalue@example.com/path';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('https://[REDACTED_USER]:[REDACTED_PW]@example.com/path');
      expect(result).not.toContain('fakesecretvalue');
    });

    it('should redact CLIENT_SECRET and AUTH_SECRET env assignments when present', () => {
      // Arrange
      const content = 'CLIENT_SECRET=fakeClientSecretValue AUTH_SECRET=fakeAuthSecretValue';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).toContain('CLIENT_SECRET=[REDACTED]');
      expect(result).toContain('AUTH_SECRET=[REDACTED]');
      expect(result).not.toContain('fakeClientSecretValue');
      expect(result).not.toContain('fakeAuthSecretValue');
    });

    it('should redact JSON refresh_token and client_secret fields when present', () => {
      // Arrange
      const content =
        '{"refresh_token": "fakeRefresh_abc123", "client_secret": "fakeClientSecretValue"}';

      // Act
      const result = filterSensitiveData(content);

      // Assert
      expect(result).not.toContain('fakeRefresh_abc123');
      expect(result).not.toContain('fakeClientSecretValue');
      expect(result).toContain('[REDACTED]');
    });
  });
});
