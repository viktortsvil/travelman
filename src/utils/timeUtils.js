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

/** Sortable number for comparing local datetimes (YYYYMMDDHHmmss). */
function partsToKey(p) {
  return (
    p.year * 1e10 +
    p.month * 1e8 +
    p.day * 1e6 +
    p.hour * 1e4 +
    p.minute * 100 +
    p.second
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
  const timeMatch = timeStr?.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateMatch || !timeMatch) return NaN;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? 0);

  const targetKey =
    year * 1e10 + month * 1e8 + day * 1e6 + hour * 1e4 + minute * 100 + second;

  // Binary-search UTC range ±14 h around a naive UTC guess (covers all TZ offsets)
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let lo = naive - 14 * 3600 * 1000;
  let hi = naive + 14 * 3600 * 1000;

  while (hi - lo > 1000) {
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
 * Format "YYYY-MM-DD" for display, e.g. "Jan 1, 1970".
 */
export function formatDateForDisplay(dateStr) {
  const dateMatch = dateStr?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return "";

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function toIsoDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseMonthName(name) {
  const key = name.toLowerCase();
  const fullIndex = MONTH_NAMES.findIndex(
    (month) => month === key || month.startsWith(key),
  );
  if (fullIndex >= 0) return fullIndex + 1;

  const shortIndex = MONTH_NAMES.findIndex((month) =>
    month.startsWith(key.slice(0, 3)),
  );
  return shortIndex >= 0 ? shortIndex + 1 : null;
}

/**
 * Parse manual date entry into "YYYY-MM-DD".
 * Accepts ISO dates, US slash dates, and "Jan 1, 1970" style text.
 *
 * @returns {string | null | ""} ISO date, empty string, or null if invalid
 */
export function parseDateInput(text) {
  const trimmed = text?.trim();
  if (!trimmed) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return toIsoDate(
      Number(trimmed.slice(0, 4)),
      Number(trimmed.slice(5, 7)),
      Number(trimmed.slice(8, 10)),
    );
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    return toIsoDate(
      Number(slashMatch[3]),
      Number(slashMatch[1]),
      Number(slashMatch[2]),
    );
  }

  const namedMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (namedMatch) {
    const month = parseMonthName(namedMatch[1]);
    if (!month) return null;
    return toIsoDate(Number(namedMatch[3]), month, Number(namedMatch[2]));
  }

  return null;
}

/**
 * Format UTC ms as a readable UTC string for the HUD.
 */
export function formatUtcMs(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** UTC ms → "YYYY-MM-DD" for date inputs. */
export function utcMsToDateStr(ms) {
  if (ms == null || Number.isNaN(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

/** UTC ms → "HH:MM" for time inputs. */
export function utcMsToTimeStr(ms) {
  if (ms == null || Number.isNaN(ms)) return "";
  return new Date(ms).toISOString().slice(11, 16);
}
