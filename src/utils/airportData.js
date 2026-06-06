/**
 * Airport and timezone lookup backed by bundled CSV files.
 * Loaded once at module init; all lookups are in-memory.
 */

import airportsCsv from "../assets/airports.csv?raw";
import timezonesCsv from "../assets/timezones.csv?raw";
import { parseCsv } from "./csvParser.js";

// --- Index maps built from CSV data ---

/** @type {Map<string, object>} IATA code → airport row */
const byIata = new Map();

/** @type {Map<string, string>} IATA code → IANA timezone (e.g. America/New_York) */
const tzByIata = new Map();

/** @type {object[]} Full airport list for city/name search */
let allAirports = [];

/** Airport type priority when multiple airports match a city name. */
const TYPE_RANK = {
  large_airport: 0,
  medium_airport: 1,
  small_airport: 2,
  seaplane_base: 3,
  heliport: 4,
  closed: 5,
};

function buildIndexes() {
  allAirports = parseCsv(airportsCsv);

  for (const row of allAirports) {
    const iata = row.iata_code?.trim();
    if (iata) {
      byIata.set(iata.toUpperCase(), row);
    }
  }

  const tzRows = parseCsv(timezonesCsv);
  for (const row of tzRows) {
    const iata = row.iata_code?.replace(/"/g, "").trim();
    const iana = row.iana_tz?.replace(/"/g, "").trim();
    if (iata && iana) {
      tzByIata.set(iata.toUpperCase(), iana);
    }
  }
}

buildIndexes();

/**
 * Pick the best airport when a city/name search returns multiple hits.
 * Prefers large scheduled airports over heliports and closed fields.
 */
function pickBestMatch(candidates) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  return [...candidates].sort((a, b) => {
    const rankA = TYPE_RANK[a.type] ?? 99;
    const rankB = TYPE_RANK[b.type] ?? 99;
    if (rankA !== rankB) return rankA - rankB;

    // Prefer airports with scheduled commercial service
    const schedA = a.scheduled_service === "yes" ? 0 : 1;
    const schedB = b.scheduled_service === "yes" ? 0 : 1;
    return schedA - schedB;
  })[0];
}

/**
 * Resolve a user-entered location string to airport coordinates + metadata.
 *
 * Lookup order:
 *   1. Exact 3-letter IATA code (e.g. "SFO")
 *   2. Exact municipality/city name (e.g. "San Francisco")
 *   3. Partial match on airport name
 *
 * @returns {{ iata, name, municipality, lat, lon, timezone, ianaTz } | null}
 */
export function lookupAirport(query) {
  const trimmed = query.trim();
  if (!trimmed) return null;

  let row = null;

  // --- IATA code (3 letters) ---
  if (/^[A-Za-z]{3}$/.test(trimmed)) {
    row = byIata.get(trimmed.toUpperCase());
  } else {
    const lower = trimmed.toLowerCase();

    // --- Exact city / municipality ---
    let matches = allAirports.filter(
      (a) => a.municipality?.toLowerCase() === lower,
    );

    // --- Fallback: substring in airport name ---
    if (matches.length === 0) {
      matches = allAirports.filter((a) =>
        a.name?.toLowerCase().includes(lower),
      );
    }

    row = pickBestMatch(matches);
  }

  if (!row) return null;

  const iata = row.iata_code?.toUpperCase();
  if (!iata) return null;

  const lat = parseFloat(row.latitude_deg);
  const lon = parseFloat(row.longitude_deg);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  const ianaTz = tzByIata.get(iata) ?? "UTC";

  return {
    iata,
    name: row.name,
    municipality: row.municipality,
    lat,
    lon,
    ianaTz,
  };
}

/**
 * Return ranked airport suggestions for autocomplete (IATA, city, or name).
 *
 * @param {string} query
 * @param {number} [limit=8]
 * @returns {{ iata: string, name: string, municipality: string, label: string }[]}
 */
export function searchAirports(query, limit = 8) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const lower = trimmed.toLowerCase();
  const upper = trimmed.toUpperCase();
  const isIataPartial = /^[A-Za-z]{1,3}$/.test(trimmed);

  /** @type {Map<string, { row: object, iata: string, score: number }>} */
  const bestByIata = new Map();

  for (const row of allAirports) {
    const iata = row.iata_code?.trim()?.toUpperCase();
    if (!iata) continue;

    const lat = parseFloat(row.latitude_deg);
    const lon = parseFloat(row.longitude_deg);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;

    const municipality = row.municipality?.trim() ?? "";
    const name = row.name?.trim() ?? "";
    const municipalityLower = municipality.toLowerCase();
    const nameLower = name.toLowerCase();

    let score = null;

    if (isIataPartial && iata.startsWith(upper)) {
      score = iata === upper ? 0 : 1 + (iata.length - upper.length);
    } else if (municipalityLower.startsWith(lower)) {
      score = 10 + municipalityLower.length - lower.length;
    } else if (municipalityLower.includes(lower)) {
      score = 30;
    } else if (nameLower.includes(lower)) {
      score = 40;
    }

    if (score == null) continue;

    score += (TYPE_RANK[row.type] ?? 99) * 0.01;
    if (row.scheduled_service !== "yes") score += 0.5;

    const existing = bestByIata.get(iata);
    if (!existing || score < existing.score) {
      bestByIata.set(iata, { row, iata, score });
    }
  }

  return [...bestByIata.values()]
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.iata.localeCompare(b.iata),
    )
    .slice(0, limit)
    .map(({ row, iata }) => {
      const municipality = row.municipality?.trim() ?? "";
      const name = row.name?.trim() ?? "";
      const label = municipality
        ? `${iata} · ${municipality}`
        : `${iata} · ${name}`;

      return { iata, name, municipality, label };
    });
}

/** Return IANA timezone for an IATA code, defaulting to UTC. */
export function getTimezoneForIata(iata) {
  return tzByIata.get(iata.toUpperCase()) ?? "UTC";
}
