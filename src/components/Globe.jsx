/**
 * 3D globe with multi-flight animation driven by a simulation clock.
 *
 * Props:
 *   resolvedFlights — validated flights from the schedule table
 *   simStartUtcMs   — UTC instant when simulation begins (null = not started)
 *   playing         — whether the simulation clock is advancing
 *   onSimTimeChange — optional callback with current sim UTC ms (for HUD)
 */

import { useEffect, useRef, useState } from "react";
import {
  Viewer,
  OpenStreetMapImageryProvider,
  Cartesian3,
  Cartesian2,
  Color,
  CallbackProperty,
  PolylineGlowMaterialProperty,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import {
  SIM_MS_PER_REAL_MS,
  assignUserColors,
  getPersonPlaneState,
  groupFlightsByUser,
} from "../utils/flightUtils.js";
import {
  positionAlongFlight,
  buildRoutePositions,
  headingForFlight,
} from "../utils/geoUtils.js";
import { formatUtcMs } from "../utils/timeUtils.js";
import "./Globe.css";

/** Build a plane SVG tinted to a given color (one plane per person). */
function planeSvg(color) {
  return `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <g transform="translate(32 32) rotate(-90)">
    <path fill="${color}" stroke="#1a1a2e" stroke-width="2"
      d="M0 -24 L6 8 L22 14 L22 20 L6 16 L0 24 L-6 16 L-22 20 L-22 14 L-6 8 Z"/>
  </g>
</svg>
`)}`;
}

export default function Globe({
  resolvedFlights,
  simStartUtcMs,
  playing,
  onSimClockUpdate,
  onTogglePlaying,
  simDate,
  simTime,
  onSimDateChange,
  onSimTimeInputChange,
  onRun,
  runErrors,
  simSettingsReadOnly = false,
  runDisabled = false,
  runHint,
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);

  // Simulation clock — stored in refs so the RAF loop doesn't trigger re-renders
  const simTimeRef = useRef(null);
  const playingRef = useRef(playing);
  const lastFrameRef = useRef(null);
  const rafRef = useRef(null);

  // Per-person plane state (position fraction + active leg), updated each frame
  const personPlaneRef = useRef({});
  const flightsByUserRef = useRef(new Map());
  const userColorsRef = useRef(new Map());

  // Cesium entity ids we created (for cleanup on schedule change)
  const entityKeysRef = useRef([]);

  const [displaySimTime, setDisplaySimTime] = useState(null);

  playingRef.current = playing;

  /** Reset simulation clock when user clicks Run with a new start time. */
  useEffect(() => {
    if (simStartUtcMs != null) {
      simTimeRef.current = simStartUtcMs;
      setDisplaySimTime(simStartUtcMs);
      onSimClockUpdate?.(simStartUtcMs);

      for (const [userId, flights] of flightsByUserRef.current) {
        personPlaneRef.current[userId] = getPersonPlaneState(
          flights,
          simStartUtcMs,
        );
      }
    }
  }, [simStartUtcMs, onSimClockUpdate]);

  /** Rebuild globe entities whenever the resolved flight list changes. */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    for (const key of entityKeysRef.current) {
      viewer.entities.removeById(key);
    }
    entityKeysRef.current = [];
    personPlaneRef.current = {};

    const flightsByUser = groupFlightsByUser(resolvedFlights);
    const userColors = assignUserColors([...flightsByUser.keys()]);
    flightsByUserRef.current = flightsByUser;
    userColorsRef.current = userColors;

    const simUtcMs = simTimeRef.current ?? simStartUtcMs;
    for (const [userId, flights] of flightsByUser) {
      if (simUtcMs != null) {
        personPlaneRef.current[userId] = getPersonPlaneState(flights, simUtcMs);
      }
    }

    for (const flight of resolvedFlights) {
      const userId = flight.userId ?? flight.id;
      const color = userColors.get(userId) ?? "#ffffff";
      const routeId = `route-${flight.id}`;
      const fromId = `from-${flight.id}`;
      const toId = `to-${flight.id}`;

      entityKeysRef.current.push(routeId, fromId, toId);

      viewer.entities.add({
        id: routeId,
        polyline: {
          positions: buildRoutePositions(flight.from, flight.to),
          width: 2,
          material: new PolylineGlowMaterialProperty({
            glowPower: 0.12,
            color: Color.fromCssColorString(color).withAlpha(0.7),
          }),
        },
      });

      viewer.entities.add({
        id: fromId,
        position: Cartesian3.fromDegrees(
          flight.from.lon,
          flight.from.lat,
        ),
        point: {
          pixelSize: 8,
          color: Color.GOLD,
          outlineColor: Color.WHITE,
          outlineWidth: 1,
        },
        label: {
          text: flight.from.iata,
          font: "12px sans-serif",
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: 1,
          verticalOrigin: 1,
          pixelOffset: new Cartesian2(0, -14),
        },
      });

      viewer.entities.add({
        id: toId,
        position: Cartesian3.fromDegrees(flight.to.lon, flight.to.lat),
        point: {
          pixelSize: 8,
          color: Color.GOLD,
          outlineColor: Color.WHITE,
          outlineWidth: 1,
        },
        label: {
          text: flight.to.iata,
          font: "12px sans-serif",
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: 1,
          verticalOrigin: 1,
          pixelOffset: new Cartesian2(0, -14),
        },
      });
    }

    for (const [userId, flights] of flightsByUser) {
      const color = userColors.get(userId) ?? "#ffffff";
      const planeId = `plane-${userId}`;
      entityKeysRef.current.push(planeId);

      viewer.entities.add({
        id: planeId,
        show: new CallbackProperty(
          () => personPlaneRef.current[userId] != null,
          false,
        ),
        position: new CallbackProperty(() => {
          const state = personPlaneRef.current[userId];
          if (!state) return Cartesian3.ZERO;
          return positionAlongFlight(
            state.flight.from,
            state.flight.to,
            state.progress,
          );
        }, false),
        billboard: {
          image: planeSvg(color),
          width: 40,
          height: 40,
          rotation: new CallbackProperty(() => {
            const state = personPlaneRef.current[userId];
            if (!state) return 0;
            return -headingForFlight(state.flight.from, state.flight.to);
          }, false),
          alignedAxis: Cartesian3.UNIT_Z,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
  }, [resolvedFlights, simStartUtcMs]);

  /** Create the Cesium viewer once on mount. */
  useEffect(() => {
    if (!containerRef.current) return;

    const viewer = new Viewer(containerRef.current, {
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    });

    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(
      new OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
      }),
    );

    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(-98, 38, 6_500_000),
    });

    viewerRef.current = viewer;

    /** Advance simulation clock and update each person's plane. */
    const tick = (timestamp) => {
      if (lastFrameRef.current != null && playingRef.current && simTimeRef.current != null) {
        const realDeltaMs = timestamp - lastFrameRef.current;
        simTimeRef.current += realDeltaMs * SIM_MS_PER_REAL_MS;

        for (const [userId, flights] of flightsByUserRef.current) {
          personPlaneRef.current[userId] = getPersonPlaneState(
            flights,
            simTimeRef.current,
          );
        }

        setDisplaySimTime(simTimeRef.current);
        onSimClockUpdate?.(simTimeRef.current);
      }

      lastFrameRef.current = timestamp;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      viewer.destroy();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewer init only once
  }, []);

  return (
    <div className="globe-root">
      <div ref={containerRef} className="globe-viewer" />

      <div className="globe-controls">
        <div className="globe-controls__group">
          <span className="globe-controls__label">Sim start (UTC)</span>
          <input
            type="date"
            className="globe-input"
            value={simDate}
            onChange={(e) => onSimDateChange(e.target.value)}
            disabled={simSettingsReadOnly}
            readOnly={simSettingsReadOnly}
            title={
              simSettingsReadOnly
                ? "Edit in the group panel"
                : undefined
            }
          />
          <input
            type="time"
            className="globe-input"
            value={simTime}
            onChange={(e) => onSimTimeInputChange(e.target.value)}
            disabled={simSettingsReadOnly}
            readOnly={simSettingsReadOnly}
            title={
              simSettingsReadOnly
                ? "Edit in the group panel"
                : undefined
            }
          />
          <button
            type="button"
            className="globe-btn globe-btn--primary"
            onClick={onRun}
            disabled={runDisabled}
          >
            Run
          </button>
        </div>

        <div className="globe-controls__group">
          <button
            type="button"
            className="globe-btn"
            onClick={onTogglePlaying}
            disabled={simStartUtcMs == null}
          >
            {playing ? "Pause" : "Resume"}
          </button>
          {displaySimTime != null && (
            <span className="globe-sim-time">
              Sim: {formatUtcMs(displaySimTime)}
            </span>
          )}
        </div>

        {runErrors.length > 0 && (
          <div className="globe-run-error">{runErrors[0]}</div>
        )}

        {runHint && (
          <span className="globe-hint globe-hint--interactive">{runHint}</span>
        )}

        <span className="globe-hint">
          Drag to rotate · Scroll to zoom · 3 h flight time = 1 s real time
        </span>
      </div>
    </div>
  );
}
