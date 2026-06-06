/**
 * Flight schedule resolution and in-flight position math.
 *
 * Simulation speed: 3 hours of flight time elapse per 1 real second.
 * Plane speed along the great-circle route is constant (linear in time).
 */

import { lookupAirport } from "./airportData.js";
import { localDateTimeToUtcMs } from "./timeUtils.js";

/** 3 hours of simulated time per 1 real second → multiplier on wall-clock delta. */
export const SIM_MS_PER_REAL_MS = 3 * 60 * 60;

/** Cruise altitude in meters; tweak for higher/lower arcs. */
export const CRUISE_ALTITUDE_M = 10_000;

/** Extra peak height (m) at route midpoint — gives a gentle flight arc. */
export const ARC_PEAK_M = 4_000;

/** Distinct plane colors (Cesium CSS color strings). */
export const PLANE_COLORS = [
  "#ffffff",
  "#ff6b6b",
  "#4ecdc4",
  "#ffe66d",
  "#a78bfa",
  "#fb923c",
  "#34d399",
  "#f472b6",
];

/**
 * Blank row for the flight table.
 * Times are interpreted in each airport's local timezone (from CSV).
 */
export function createEmptyFlightRow() {
  return {
    id: crypto.randomUUID(),
    fromLocation: "",
    fromDate: "",
    fromTime: "",
    toLocation: "",
    toDate: "",
    toTime: "",
  };
}

/** Example SFO → JFK row for first load. */
export function createDefaultFlightRow() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: crypto.randomUUID(),
    fromLocation: "SFO",
    fromDate: today,
    fromTime: "08:00",
    toLocation: "JFK",
    toDate: today,
    toTime: "16:30",
  };
}

/**
 * Resolve one table row into a simulation-ready flight object.
 *
 * @returns {{ flight: object | null, errors: string[] }}
 */
export function resolveFlightRow(row, index) {
  const errors = [];
  const label = `Flight ${index + 1}`;

  const from = lookupAirport(row.fromLocation);
  if (!from) {
    errors.push(`${label}: unknown origin "${row.fromLocation}"`);
  }

  const to = lookupAirport(row.toLocation);
  if (!to) {
    errors.push(`${label}: unknown destination "${row.toLocation}"`);
  }

  if (!from || !to) {
    return { flight: null, errors };
  }

  const departUtcMs = localDateTimeToUtcMs(
    row.fromDate,
    row.fromTime,
    from.ianaTz,
  );
  const arriveUtcMs = localDateTimeToUtcMs(
    row.toDate,
    row.toTime,
    to.ianaTz,
  );

  if (Number.isNaN(departUtcMs)) {
    errors.push(`${label}: invalid departure date/time`);
  }
  if (Number.isNaN(arriveUtcMs)) {
    errors.push(`${label}: invalid arrival date/time`);
  }

  if (!Number.isNaN(departUtcMs) && !Number.isNaN(arriveUtcMs)) {
    if (arriveUtcMs <= departUtcMs) {
      errors.push(`${label}: arrival must be after departure`);
    }
  }

  if (errors.length > 0) {
    return { flight: null, errors };
  }

  const durationMs = arriveUtcMs - departUtcMs;

  return {
    flight: {
      id: row.id,
      userId: row.userId ?? null,
      from,
      to,
      departUtcMs,
      arriveUtcMs,
      durationMs,
      label: `${from.iata} → ${to.iata}`,
    },
    errors: [],
  };
}

/**
 * Resolve every row in the table.
 *
 * @returns {{ flights: object[], errors: string[] }}
 */
export function resolveAllFlights(rows) {
  const flights = [];
  const errors = [];

  rows.forEach((row, index) => {
    // Skip completely empty rows
    const hasData =
      row.fromLocation ||
      row.toLocation ||
      row.fromDate ||
      row.toTime ||
      row.toDate ||
      row.toTime;
    if (!hasData) return;

    const result = resolveFlightRow(row, index);
    errors.push(...result.errors);
    if (result.flight) flights.push(result.flight);
  });

  return { flights, errors };
}

/**
 * Flight phase at a given simulation instant (UTC ms).
 *
 * @returns {"waiting" | "flying" | "done"} phase and 0–1 progress when flying
 */
export function getFlightState(flight, simUtcMs) {
  if (simUtcMs < flight.departUtcMs) {
    return { phase: "waiting", progress: 0 };
  }
  if (simUtcMs >= flight.arriveUtcMs) {
    return { phase: "done", progress: 1 };
  }

  const progress =
    (simUtcMs - flight.departUtcMs) / flight.durationMs;
  return { phase: "flying", progress };
}

/** Group resolved flights by user id. */
export function groupFlightsByUser(flights) {
  /** @type {Map<string, object[]>} */
  const byUser = new Map();

  for (const flight of flights) {
    const userId = flight.userId ?? flight.id;
    const list = byUser.get(userId) ?? [];
    list.push(flight);
    byUser.set(userId, list);
  }

  for (const list of byUser.values()) {
    list.sort((a, b) => a.departUtcMs - b.departUtcMs);
  }

  return byUser;
}

/** Stable color per user id. */
export function assignUserColors(userIds) {
  const sorted = [...new Set(userIds)].sort();
  const colors = new Map();
  sorted.forEach((userId, index) => {
    colors.set(userId, PLANE_COLORS[index % PLANE_COLORS.length]);
  });
  return colors;
}

/**
 * One plane per person: waiting at the next origin, flying the active leg,
 * or parked at the final destination when all legs are done.
 *
 * @returns {{ flight: object, progress: number, mode: "waiting" | "flying" | "done" } | null}
 */
export function getPersonPlaneState(flights, simUtcMs) {
  if (flights.length === 0) return null;

  const sorted = [...flights].sort((a, b) => a.departUtcMs - b.departUtcMs);

  for (const flight of sorted) {
    const { phase, progress } = getFlightState(flight, simUtcMs);
    if (phase === "flying") {
      return { flight, progress, mode: "flying" };
    }
    if (phase === "waiting") {
      return { flight, progress: 0, mode: "waiting" };
    }
  }

  const last = sorted[sorted.length - 1];
  return { flight: last, progress: 1, mode: "done" };
}

/**
 * Great-circle heading from `from` to `to` airport (radians).
 * Constant heading is a good approximation for short/medium haul routes.
 */
export function routeHeading(from, to) {
  // Lazy-import Cesium types only when called from Globe — keep pure here
  // Globe will compute heading; export a helper that takes radians lat/lon
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return Math.atan2(y, x);
}
