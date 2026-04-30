import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { STDERR_FALLBACK_LOGGER } from '../../../worker/lib/fallback-logger.js';

describe('STDERR_FALLBACK_LOGGER', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should be a silent no-op when info is called', () => {
    // Act
    STDERR_FALLBACK_LOGGER.info('this should not print');

    // Assert
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('should forward to console.error when warn is called', () => {
    // Act
    STDERR_FALLBACK_LOGGER.warn('warn-message');

    // Assert
    expect(consoleErrorSpy).toHaveBeenCalledWith('warn-message');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('should forward to console.error when error is called', () => {
    // Act
    STDERR_FALLBACK_LOGGER.error('error-message');

    // Assert
    expect(consoleErrorSpy).toHaveBeenCalledWith('error-message');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});
