import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { resolveHome } from '../../lib/paths.js';

describe('resolveHome', () => {
  it('should expand a leading tilde when given a ~/path string', () => {
    // Arrange
    const input = '~/.jarvis-cache/foo';

    // Act
    const result = resolveHome(input);

    // Assert
    expect(result).toBe(`${homedir()}/.jarvis-cache/foo`);
  });

  it('should return the home directory when input is a bare tilde', () => {
    // Act
    const result = resolveHome('~');

    // Assert
    expect(result).toBe(homedir());
  });

  it('should return the path unchanged when given an absolute path', () => {
    // Act
    const result = resolveHome('/usr/local/bin');

    // Assert
    expect(result).toBe('/usr/local/bin');
  });

  it('should return the path unchanged when given a relative path', () => {
    // Act
    const result = resolveHome('relative/path');

    // Assert
    expect(result).toBe('relative/path');
  });

  it('should return the input unchanged when given a non-string value', () => {
    // Act & Assert
    expect(resolveHome(undefined)).toBeUndefined();
    expect(resolveHome(null)).toBeNull();
  });
});
