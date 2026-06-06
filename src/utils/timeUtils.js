/**
 * Timezone-aware datetime helpers.
 * Converts local airport times (with IANA zones) to UTC milliseconds for simulation.
 */

/**
 * Read calendar parts of a UTC instant as they appear in a given IANA timezone.
 * Used to invert "local time in zone X" → UTC.
 */
function getPartsInZone(utcMs, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Sortable number for comparing local datetimes (YYYYMMDDHHmm). */
function partsToKey(p) {
  return (
    p.year * 1e8 +
    p.month * 1e6 +
    p.day * 1e4 +
    p.hour * 100 +
    p.minute
  );
}

/**
 * Convert a local date + time in an IANA timezone to UTC epoch milliseconds.
 *
 * @param {string} dateStr  "YYYY-MM-DD"
 * @param {string} timeStr  "HH:MM" (24-hour)
 * @param {string} timeZone IANA name, e.g. "America/Los_Angeles"
 * @returns {number} UTC ms, or NaN if inputs are invalid
 */
export function localDateTimeToUtcMs(dateStr, timeStr, timeZone) {
  const dateMatch = dateStr?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeStr?.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return NaN;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  const targetKey = year * 1e8 + month * 1e6 + day * 1e4 + hour * 100 + minute;

  // Binary-search UTC range ±14 h around a naive UTC guess (covers all TZ offsets)
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let lo = naive - 14 * 3600 * 1000;
  let hi = naive + 14 * 3600 * 1000;

  while (hi - lo > 60_000) {
    const mid = Math.floor((lo + hi) / 2);
    const midKey = partsToKey(getPartsInZone(mid, timeZone));
    if (midKey < targetKey) lo = mid + 1;
    else hi = mid;
  }

  return lo;
}

/**
 * Parse UTC simulation start from separate date/time fields (both UTC).
 */
export function utcDateTimeToMs(dateStr, timeStr) {
  return localDateTimeToUtcMs(dateStr, timeStr, "UTC");
}

/**
 * Format UTC ms as a readable UTC string for the HUD.
 */
export function formatUtcMs(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
