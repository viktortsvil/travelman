/**
 * Cesium-specific helpers: positions along great-circle routes.
 */

import {
  Cartesian3,
  Cartographic,
  EllipsoidGeodesic,
} from "cesium";
import { CRUISE_ALTITUDE_M, ARC_PEAK_M } from "./flightUtils.js";

/**
 * 3D position along a flight path at fraction t ∈ [0, 1].
 * Uses an ellipsoid geodesic with a sinusoidal altitude bump at midpoint.
 */
export function positionAlongFlight(from, to, fraction) {
  const start = Cartographic.fromDegrees(from.lon, from.lat);
  const end = Cartographic.fromDegrees(to.lon, to.lat);
  const geodesic = new EllipsoidGeodesic(start, end);
  const along = geodesic.interpolateUsingFraction(fraction);

  const altitude =
    CRUISE_ALTITUDE_M + Math.sin(fraction * Math.PI) * ARC_PEAK_M;

  return Cartesian3.fromRadians(
    along.longitude,
    along.latitude,
    altitude,
  );
}

/** Pre-compute polyline vertices for drawing the route on the globe. */
export function buildRoutePositions(from, to, steps = 200) {
  return Array.from({ length: steps + 1 }, (_, i) =>
    positionAlongFlight(from, to, i / steps),
  );
}

/** Initial compass heading for a route (used to rotate the plane billboard). */
export function headingForFlight(from, to) {
  const start = Cartographic.fromDegrees(from.lon, from.lat);
  const end = Cartographic.fromDegrees(to.lon, to.lat);
  return new EllipsoidGeodesic(start, end).startHeading;
}
