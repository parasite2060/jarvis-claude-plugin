import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../hooks/lib/jarvis-client.js', () => ({
  get: vi.fn(),
  config: { serverUrl: 'http://test', apiKey: 'test', cacheDir: '/tmp', workerPort: 0, extraHeaders: '' },
}));

describe('transcript-state', () => {
  describe('extractSegment', () => {
    let extractSegment;

    beforeEach(async () => {
      const mod = await import('../../../hooks/lib/transcript-state.js');
      extractSegment = mod.extractSegment;
    });

    it('should return full content when lastLine is 0', () => {
      // Arrange
      const content = 'line0\nline1\nline2\nline3\nline4';

      // Act
      const result = extractSegment(content, 0);

      // Assert
      expect(result).toEqual({ content, startLine: 0, endLine: 5 });
    });

    it('should return segment with 20-line overlap when lastLine is 450 and total is 900', () => {
      // Arrange
      const lines = Array.from({ length: 900 }, (_, i) => `line${i}`);
      const content = lines.join('\n');

      // Act
      const result = extractSegment(content, 450);

      // Assert
      expect(result).toEqual({
        content: lines.slice(430).join('\n'),
        startLine: 430,
        endLine: 900,
      });
    });

    it('should return full content when lastLine exceeds totalLines', () => {
      // Arrange
      const content = 'line0\nline1\nline2';

      // Act
      const result = extractSegment(content, 100);

      // Assert
      expect(result).toEqual({ content, startLine: 0, endLine: 3 });
    });

    it('should return full content when transcript is shorter than OVERLAP_LINES', () => {
      // Arrange
      const content = 'line0\nline1\nline2';

      // Act
      const result = extractSegment(content, 1);

      // Assert
      expect(result).toEqual({ content, startLine: 0, endLine: 3 });
    });

    it('should clamp startLine to 0 when lastLine is below OVERLAP_LINES', () => {
      // Arrange
      const lines = Array.from({ length: 50 }, (_, i) => `line${i}`);
      const content = lines.join('\n');

      // Act
      const result = extractSegment(content, 10);

      // Assert
      expect(result).toEqual({ content, startLine: 0, endLine: 50 });
    });

    it('should clamp startLine to 0 when lastLine equals OVERLAP_LINES exactly', () => {
      // Arrange
      const lines = Array.from({ length: 50 }, (_, i) => `line${i}`);
      const content = lines.join('\n');

      // Act
      const result = extractSegment(content, 20);

      // Assert
      expect(result).toEqual({ content, startLine: 0, endLine: 50 });
    });

    it('should return the full single-line content when transcript is one line', () => {
      // Act
      const result = extractSegment('only-one-line', 0);

      // Assert
      expect(result).toEqual({ content: 'only-one-line', startLine: 0, endLine: 1 });
    });

    it('should return empty content when transcript is empty', () => {
      // Act
      const result = extractSegment('', 0);

      // Assert
      expect(result).toEqual({ content: '', startLine: 0, endLine: 1 });
    });
  });

  describe('getLastPosition', () => {
    let getLastPosition;
    let mockGet;

    beforeEach(async () => {
      vi.resetModules();
      const client = await import('../../../hooks/lib/jarvis-client.js');
      mockGet = client.get;
      mockGet.mockReset();
      const mod = await import('../../../hooks/lib/transcript-state.js');
      getLastPosition = mod.getLastPosition;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return last_line when server response is valid', async () => {
      // Arrange
      mockGet.mockResolvedValue({ session_id: 'known', last_line: 450 });

      // Act
      const result = await getLastPosition('known');

      // Assert
      expect(result).toBe(450);
      expect(mockGet).toHaveBeenCalledWith('/conversations/position?session_id=known');
    });

    it('should URL-encode session_id when it contains special characters', async () => {
      // Arrange
      mockGet.mockResolvedValue({ last_line: 0 });

      // Act
      await getLastPosition('a session/with spaces');

      // Assert
      expect(mockGet).toHaveBeenCalledWith(
        '/conversations/position?session_id=a%20session%2Fwith%20spaces',
      );
    });

    it('should return 0 when response has no last_line field', async () => {
      // Arrange
      mockGet.mockResolvedValue({ session_id: 'known' });

      // Act
      const result = await getLastPosition('known');

      // Assert
      expect(result).toBe(0);
    });

    it('should return 0 when response is null', async () => {
      // Arrange
      mockGet.mockResolvedValue(null);

      // Act
      const result = await getLastPosition('known');

      // Assert
      expect(result).toBe(0);
    });

    it('should return 0 when last_line is not a number', async () => {
      // Arrange
      mockGet.mockResolvedValue({ last_line: 'not-a-number' });

      // Act
      const result = await getLastPosition('known');

      // Assert
      expect(result).toBe(0);
    });

    it('should return 0 when get() throws', async () => {
      // Arrange
      mockGet.mockRejectedValue(new Error('boom'));

      // Act
      const result = await getLastPosition('known');

      // Assert
      expect(result).toBe(0);
    });
  });
});
