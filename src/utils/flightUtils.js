/**
 * Flight schedule resolution and in-flight position math.
 *
 * Simulation speed: 1 hour of trip time elapses per 1 real second.
 * Plane speed along the great-circle route is constant (linear in time).
 */

import { lookupAirport } from "./airportData.js";
import { localDateTimeToUtcMs } from "./timeUtils.js";

/** 1 hour of trip time per 1 real second → multiplier on wall-clock delta. */
export const SIM_MS_PER_REAL_MS = 1 * 60 * 60;

/** Altitude (m) for airports, transfers, and route endpoints. */
export const GROUND_ALTITUDE_M = 0;

/** Cruise altitude in meters; tweak for higher/lower arcs. */
export const CRUISE_ALTITUDE_M = 10_000;

/** Extra peak height (m) at route midpoint — gives a gentle flight arc. */
export const ARC_PEAK_M = 4_000;

/** Distinct plane colors (Cesium CSS color strings). */
export const PLANE_COLORS = [
  "#60a5fa",
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

/** 3 hours before the earliest group departure → shared trip start (UTC). */
export const TRIP_START_LEAD_MS = 3 * 60 * 60 * 1000;

/**
 * Shared trip start in UTC ms: earliest departure in the group minus 3 hours.
 * @returns {number | null}
 */
export function computeGroupTripStartUtcMs(flights) {
  if (flights.length === 0) return null;
  const earliestDepartUtcMs = Math.min(...flights.map((f) => f.departUtcMs));
  return earliestDepartUtcMs - TRIP_START_LEAD_MS;
}

/**
 * Resolve all saved rows and compute trip start fields for the groups table.
 * @returns {{ utcMs: number, simDate: string, simTime: string } | null}
 */
export function computeGroupTripStartFromRows(rows) {
  const { flights } = resolveAllFlights(rows);
  const utcMs = computeGroupTripStartUtcMs(flights);
  if (utcMs == null || Number.isNaN(utcMs)) return null;

  const iso = new Date(utcMs).toISOString();
  return {
    utcMs,
    simDate: iso.slice(0, 10),
    simTime: iso.slice(11, 19),
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

  return { flights, errors: [...errors, ...validateFlightSequences(flights)] };
}

/** Ensure a traveler's flights do not overlap in time. */
export function validateFlightSequences(flights) {
  const errors = [];
  const byUser = groupFlightsByUser(flights);

  for (const userFlights of byUser.values()) {
    const sorted = [...userFlights].sort((a, b) => a.departUtcMs - b.departUtcMs);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      if (next.departUtcMs < prev.arriveUtcMs) {
        errors.push(
          `${prev.label} overlaps with ${next.label} — a flight cannot start before the previous one lands.`,
        );
      }
    }
  }

  return errors;
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
 * One plane per person: waiting, flying, ground transfer between legs,
 * or parked at the final destination.
 *
 * @returns {{
 *   mode: "waiting" | "flying" | "transfer" | "done",
 *   from: object,
 *   to: object,
 *   progress: number,
 * } | null}
 */
export function getPersonPlaneState(flights, simUtcMs) {
  if (flights.length === 0) return null;

  const sorted = [...flights].sort((a, b) => a.departUtcMs - b.departUtcMs);
  const first = sorted[0];

  if (simUtcMs < first.departUtcMs) {
    return {
      mode: "waiting",
      from: first.from,
      to: first.to,
      progress: 0,
    };
  }

  for (let i = 0; i < sorted.length; i++) {
    const flight = sorted[i];
    const { phase, progress } = getFlightState(flight, simUtcMs);

    if (phase === "flying") {
      return {
        mode: "flying",
        from: flight.from,
        to: flight.to,
        progress,
      };
    }

    if (phase === "waiting") {
      return {
        mode: "waiting",
        from: flight.from,
        to: flight.to,
        progress: 0,
      };
    }

    const next = sorted[i + 1];
    if (!next) {
      return {
        mode: "done",
        from: flight.from,
        to: flight.to,
        progress: 1,
      };
    }

    if (simUtcMs < next.departUtcMs) {
      const gapMs = next.departUtcMs - flight.arriveUtcMs;
      const gapProgress =
        gapMs > 0 ? (simUtcMs - flight.arriveUtcMs) / gapMs : 1;

      const sameAirport =
        flight.to.iata === next.from.iata &&
        flight.to.lat === next.from.lat &&
        flight.to.lon === next.from.lon;

      if (sameAirport) {
        return {
          mode: "waiting",
          from: next.from,
          to: next.to,
          progress: 0,
        };
      }

      return {
        mode: "transfer",
        from: flight.to,
        to: next.from,
        progress: Math.min(1, Math.max(0, gapProgress)),
      };
    }
  }

  const last = sorted[sorted.length - 1];
  return {
    mode: "done",
    from: last.from,
    to: last.to,
    progress: 1,
  };
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
