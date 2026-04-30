import { describe, it, expect } from 'vitest';
import { parseExtraHeaders } from '../../../hooks/lib/parse-extra-headers.js';

describe('parseExtraHeaders', () => {
  it('should return empty object when input is empty string', () => {
    // Act
    const result = parseExtraHeaders('');

    // Assert
    expect(result).toEqual({});
  });

  it('should return empty object when input is undefined', () => {
    // Act
    const result = parseExtraHeaders(undefined);

    // Assert
    expect(result).toEqual({});
  });

  it('should return parsed headers when input is a valid JSON object string', () => {
    // Arrange
    const raw = '{"X-Custom-Auth":"abc","X-Other":"def"}';

    // Act
    const result = parseExtraHeaders(raw);

    // Assert
    expect(result).toEqual({ 'X-Custom-Auth': 'abc', 'X-Other': 'def' });
  });

  it('should return empty object when JSON is malformed', () => {
    // Act
    const result = parseExtraHeaders('{not-valid-json');

    // Assert
    expect(result).toEqual({});
  });

  it('should return empty object when JSON parses to a non-object value', () => {
    // Act & Assert
    expect(parseExtraHeaders('"a-string"')).toEqual({});
    expect(parseExtraHeaders('123')).toEqual({});
    expect(parseExtraHeaders('null')).toEqual({});
    expect(parseExtraHeaders('[1,2,3]')).toEqual({});
  });
});
