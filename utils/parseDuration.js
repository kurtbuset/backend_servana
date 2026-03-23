/**
 * Parse a duration string like "1h 30m 20s" into total seconds.
 * @param {string} durationStr - e.g. "1h 30m", "45m 20s", "30s"
 * @returns {number|null} Total seconds, or null if invalid
 */
function parseDurationToSeconds(durationStr) {
  if (!durationStr || typeof durationStr !== 'string') return null;

  let totalSeconds = 0;

  const hourMatch = durationStr.match(/(\d+)h/);
  const minuteMatch = durationStr.match(/(\d+)m/);
  const secondMatch = durationStr.match(/(\d+)s/);

  if (hourMatch) totalSeconds += parseInt(hourMatch[1]) * 3600;
  if (minuteMatch) totalSeconds += parseInt(minuteMatch[1]) * 60;
  if (secondMatch) totalSeconds += parseInt(secondMatch[1]);

  return totalSeconds > 0 ? totalSeconds : null;
}

module.exports = { parseDurationToSeconds };
