import { get } from './jarvis-client.js';

const OVERLAP_LINES = 20;

/**
 * Query server for last processed line position for a session.
 * Returns 0 if server is unreachable or no position exists (safe fallback).
 * @param {string} sessionId
 * @returns {Promise<number>}
 */
export async function getLastPosition(sessionId) {
  try {
    const resp = await get(`/conversations/position?session_id=${encodeURIComponent(sessionId)}`);
    return (resp && typeof resp.last_line === 'number') ? resp.last_line : 0;
  } catch {
    return 0;
  }
}

/**
 * Extract a segment from the full transcript content.
 * If lastLine=0, returns the full content.
 * Otherwise returns from (lastLine - OVERLAP_LINES) to end.
 * @param {string} fullContent
 * @param {number} lastLine
 * @returns {{ content: string, startLine: number, endLine: number }}
 */
export function extractSegment(fullContent, lastLine) {
  const lines = fullContent.split('\n');
  const totalLines = lines.length;

  if (lastLine === 0 || lastLine >= totalLines) {
    return { content: fullContent, startLine: 0, endLine: totalLines };
  }

  const startLine = Math.max(0, lastLine - OVERLAP_LINES);
  const segment = lines.slice(startLine).join('\n');
  return { content: segment, startLine, endLine: totalLines };
}
