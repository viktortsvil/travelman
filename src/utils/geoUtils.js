/**
 * Cesium-specific helpers: positions along great-circle routes.
 */

import {
  Cartesian3,
  Cartographic,
  Ellipsoid,
  EllipsoidGeodesic,
  Math as CesiumMath,
  Matrix4,
  Transforms,
} from "cesium";
import { CRUISE_ALTITUDE_M, ARC_PEAK_M, GROUND_ALTITUDE_M } from "./flightUtils.js";

/**
 * 3D position along a flight path at fraction t ∈ [0, 1].
 * Ground at endpoints; peaks at cruise altitude mid-route.
 */
export function positionAlongFlight(from, to, fraction) {
  const start = Cartographic.fromDegrees(from.lon, from.lat);
  const end = Cartographic.fromDegrees(to.lon, to.lat);
  const geodesic = new EllipsoidGeodesic(start, end);
  const along = geodesic.interpolateUsingFraction(fraction);

  const peakAltitude = CRUISE_ALTITUDE_M + ARC_PEAK_M;
  const altitude = Math.sin(fraction * Math.PI) * peakAltitude;

  return Cartesian3.fromRadians(
    along.longitude,
    along.latitude,
    altitude,
  );
}

/** Choose enough samples so long routes draw as smooth 3D arcs. */
function routeSampleCount(from, to) {
  const start = Cartographic.fromDegrees(from.lon, from.lat);
  const end = Cartographic.fromDegrees(to.lon, to.lat);
  const distanceM = new EllipsoidGeodesic(start, end).surfaceDistance;

  // ~1 vertex every 40 km, clamped for short hops and ultra-long hauls.
  return Math.min(320, Math.max(96, Math.ceil(distanceM / 40_000)));
}

/** Pre-compute polyline vertices for drawing the route on the globe. */
export function buildRoutePositions(from, to, steps = routeSampleCount(from, to)) {
  return Array.from({ length: steps + 1 }, (_, i) =>
    positionAlongFlight(from, to, i / steps),
  );
}

/** Ground-level position while moving between airports between flights. */
export function positionAlongTransfer(from, to, fraction) {
  const start = Cartographic.fromDegrees(from.lon, from.lat);
  const end = Cartographic.fromDegrees(to.lon, to.lat);
  const geodesic = new EllipsoidGeodesic(start, end);
  const along = geodesic.interpolateUsingFraction(fraction);

  return Cartesian3.fromRadians(along.longitude, along.latitude, GROUND_ALTITUDE_M);
}

function airportPosition(airport) {
  return Cartesian3.fromDegrees(
    airport.lon,
    airport.lat,
    GROUND_ALTITUDE_M,
  );
}

/** Position for a person's plane based on their current trip phase. */
export function positionForPersonState(state) {
  if (!state) return null;
  if (state.mode === "transfer") {
    return positionAlongTransfer(state.from, state.to, state.progress);
  }
  if (state.mode === "waiting" || state.mode === "done") {
    const airport = state.mode === "done" ? state.to : state.from;
    return airportPosition(airport);
  }
  return positionAlongFlight(state.from, state.to, state.progress);
}

/** Compass heading from a 3D path tangent at a point (0 = north, clockwise). */
function headingFromTangent(fromPos, toPos) {
  const transform = Transforms.eastNorthUpToFixedFrame(
    fromPos,
    Ellipsoid.WGS84,
    new Matrix4(),
  );
  const worldDelta = Cartesian3.subtract(toPos, fromPos, new Cartesian3());
  const inv = Matrix4.inverse(transform, new Matrix4());
  const local = Matrix4.multiplyByPointAsVector(inv, worldDelta, new Cartesian3());

  if (Cartesian3.magnitudeSquared(local) < CesiumMath.EPSILON10) {
    return 0;
  }

  return Math.atan2(local.x, local.y);
}

/** Heading along a path segment; uses actual 3D motion for stable rotation. */
export function headingAlongRoute(from, to, fraction, positionFn = positionAlongFlight) {
  const t = Math.min(1 - 1e-5, Math.max(1e-5, fraction));
  const dt = 0.001;
  const t0 = Math.max(0, t - dt);
  const t1 = Math.min(1, t + dt);

  return headingFromTangent(
    positionFn(from, to, t0),
    positionFn(from, to, t1),
  );
}

/** Initial compass heading for a route (used to rotate the plane billboard). */
export function headingForFlight(from, to) {
  return headingAlongRoute(from, to, 0);
}

/** Heading while flying, transferring, or waiting at an airport. */
export function headingForPersonState(state) {
  if (!state) return 0;
  if (state.mode === "flying") {
    return headingAlongRoute(state.from, state.to, state.progress, positionAlongFlight);
  }
  if (state.mode === "transfer") {
    return headingAlongRoute(
      state.from,
      state.to,
      state.progress,
      positionAlongTransfer,
    );
  }
  return headingForFlight(state.from, state.to);
}

/** Local "up" for a position on the globe (billboard rotation axis). */
export function surfaceNormalAt(position) {
  return Ellipsoid.WGS84.geodeticSurfaceNormal(position, new Cartesian3());
}

/** Avoid ±π jumps when applying consecutive billboard rotations. */
export function unwrapRotation(previous, next) {
  if (previous == null || !Number.isFinite(next)) return next;

  let delta = next - previous;
  while (delta > Math.PI) delta -= CesiumMath.TWO_PI;
  while (delta < -Math.PI) delta += CesiumMath.TWO_PI;

  return previous + delta;
}
