/**
 * 3D globe with multi-flight animation driven by a trip clock.
 */

import { useEffect, useRef, useState } from "react";
import {
  Viewer,
  OpenStreetMapImageryProvider,
  Cartesian3,
  Cartesian2,
  Color,
  CallbackProperty,
  ColorMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import {
  SIM_MS_PER_REAL_MS,
  assignUserColors,
  getPersonPlaneState,
  groupFlightsByUser,
} from "../utils/flightUtils.js";
import {
  buildRoutePositions,
  headingForPersonState,
  positionForPersonState,
  surfaceNormalAt,
  unwrapRotation,
} from "../utils/geoUtils.js";
import "./Globe.css";

const planeSvgCache = new Map();
function planeSvg(color) {
  if (!planeSvgCache.has(color)) {
    planeSvgCache.set(
      color,
      `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <g transform="translate(32 32)">
    <path fill="${color}" stroke="#1a1a2e" stroke-width="2"
      d="M0 -24 L6 8 L22 14 L22 20 L6 16 L0 24 L-6 16 L-22 20 L-22 14 L-6 8 Z"/>
  </g>
</svg>
`)}`,
    );
  }
  return planeSvgCache.get(color);
}

const HUD_UPDATE_MS = 250;

export default function Globe({
  resolvedFlights,
  seekUtcMs,
  playing,
  tripActive = false,
  tripDate,
  tripTime,
  onTripDateChange,
  onTripTimeChange,
  onTripClockChange,
  onPlayPause,
  runErrors,
  runDisabled = false,
  runHint,
  travelerNames = new Map(),
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const clickHandlerRef = useRef(null);

  const tripTimeRef = useRef(null);
  const playingRef = useRef(playing);
  const lastFrameRef = useRef(null);
  const lastHudUpdateRef = useRef(0);
  const rafRef = useRef(null);

  const personPlaneRef = useRef({});
  const flightsByUserRef = useRef(new Map());
  const userColorsRef = useRef(new Map());
  const travelerNamesRef = useRef(travelerNames);
  const entityKeysRef = useRef([]);
  const planeRotationRef = useRef(new Map());

  const [hoveredTraveler, setHoveredTraveler] = useState(null);

  playingRef.current = playing;
  travelerNamesRef.current = travelerNames;

  useEffect(() => {
    if (seekUtcMs == null) return;

    tripTimeRef.current = seekUtcMs;
    onTripClockChange?.(seekUtcMs);

    for (const [userId, flights] of flightsByUserRef.current) {
      personPlaneRef.current[userId] = getPersonPlaneState(flights, seekUtcMs);
    }

    viewerRef.current?.scene.requestRender();
  }, [seekUtcMs, onTripClockChange]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    for (const key of entityKeysRef.current) {
      viewer.entities.removeById(key);
    }
    entityKeysRef.current = [];
    personPlaneRef.current = {};
    planeRotationRef.current.clear();
    setHoveredTraveler(null);

    const flightsByUser = groupFlightsByUser(resolvedFlights);
    const userColors = assignUserColors([...flightsByUser.keys()]);
    flightsByUserRef.current = flightsByUser;
    userColorsRef.current = userColors;

    const tripUtcMs = tripTimeRef.current ?? seekUtcMs;
    for (const [userId, flights] of flightsByUser) {
      if (tripUtcMs != null) {
        personPlaneRef.current[userId] = getPersonPlaneState(flights, tripUtcMs);
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
          material: new ColorMaterialProperty(
            Color.fromCssColorString(color).withAlpha(0.75),
          ),
        },
      });

      viewer.entities.add({
        id: fromId,
        position: Cartesian3.fromDegrees(flight.from.lon, flight.from.lat),
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
          return positionForPersonState(state) ?? Cartesian3.ZERO;
        }, false),
        billboard: {
          image: planeSvg(color),
          width: 48,
          height: 48,
          rotation: new CallbackProperty(() => {
            const state = personPlaneRef.current[userId];
            if (!state) return 0;
            const heading = headingForPersonState(state);
            const rotation = unwrapRotation(
              planeRotationRef.current.get(userId),
              heading,
            );
            planeRotationRef.current.set(userId, rotation);
            return rotation;
          }, false),
          alignedAxis: new CallbackProperty(() => {
            const state = personPlaneRef.current[userId];
            const position = positionForPersonState(state);
            if (!position) return Cartesian3.UNIT_Z;
            return surfaceNormalAt(position);
          }, false),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    viewer.scene.requestRender();
  }, [resolvedFlights, seekUtcMs]);

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
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      targetFrameRate: 30,
      useBrowserRecommendedResolution: true,
    });

    const scene = viewer.scene;
    scene.globe.maximumScreenSpaceError = 2;
    scene.globe.tileCacheSize = 300;
    scene.fog.enabled = false;
    scene.skyAtmosphere.show = false;
    scene.globe.showGroundAtmosphere = false;
    scene.moon.show = false;
    if (scene.sun) scene.sun.show = false;

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

    const hoverHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    hoverHandler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.endPosition);
      const entityId = picked?.id?.id;
      if (typeof entityId === "string" && entityId.startsWith("plane-")) {
        const userId = entityId.slice("plane-".length);
        setHoveredTraveler({
          name: travelerNamesRef.current.get(userId) ?? "Traveler",
          x: movement.endPosition.x,
          y: movement.endPosition.y,
        });
        viewer.canvas.style.cursor = "pointer";
      } else {
        setHoveredTraveler(null);
        viewer.canvas.style.cursor = "";
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);
    clickHandlerRef.current = hoverHandler;

    const clearHover = () => {
      setHoveredTraveler(null);
      if (!viewer.isDestroyed()) {
        viewer.canvas.style.cursor = "";
      }
    };
    containerRef.current.addEventListener("mouseleave", clearHover);

    const tick = (timestamp) => {
      const viewerInstance = viewerRef.current;

      if (
        lastFrameRef.current != null &&
        playingRef.current &&
        tripTimeRef.current != null
      ) {
        const realDeltaMs = timestamp - lastFrameRef.current;
        tripTimeRef.current += realDeltaMs * SIM_MS_PER_REAL_MS;

        for (const [userId, flights] of flightsByUserRef.current) {
          personPlaneRef.current[userId] = getPersonPlaneState(
            flights,
            tripTimeRef.current,
          );
        }

        if (timestamp - lastHudUpdateRef.current >= HUD_UPDATE_MS) {
          lastHudUpdateRef.current = timestamp;
          onTripClockChange?.(tripTimeRef.current);
        }

        viewerInstance?.scene.requestRender();
      }

      lastFrameRef.current = timestamp;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    const resizeObserver = new ResizeObserver(() => {
      if (viewer.isDestroyed()) return;
      viewer.resize();
      viewer.scene.requestRender();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      containerRef.current?.removeEventListener("mouseleave", clearHover);
      hoverHandler.destroy();
      clickHandlerRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  const playPauseLabel = playing
    ? "Pause"
    : seekUtcMs != null
      ? "Resume"
      : "Run";

  const tripStartLocked = playing;

  return (
    <div className="globe-root">
      <div ref={containerRef} className="globe-viewer" />

      {hoveredTraveler && (
        <div
          className="globe-traveler-tooltip"
          style={{
            left: hoveredTraveler.x + 14,
            top: hoveredTraveler.y + 14,
          }}
        >
          {hoveredTraveler.name}
        </div>
      )}

      <div className="globe-controls">
        <div className="globe-controls__group">
          <p className="globe-controls__label">
            {tripActive ? "Trip time (UTC)" : "Trip start (UTC)"}
          </p>
          <input
            type="date"
            className="globe-input"
            value={tripDate}
            onChange={(e) => onTripDateChange(e.target.value)}
            disabled={tripStartLocked}
            title={tripStartLocked ? "Pause the trip to change time" : undefined}
          />
          <input
            type="time"
            className="globe-input"
            value={tripTime}
            step="1"
            onChange={(e) => onTripTimeChange(e.target.value)}
            disabled={tripStartLocked}
            title={tripStartLocked ? "Pause the trip to change time" : undefined}
          />
          <button
            type="button"
            className="globe-btn globe-btn--primary"
            onClick={onPlayPause}
            disabled={seekUtcMs == null && runDisabled}
          >
            {playPauseLabel}
          </button>
        </div>

        {runErrors.length > 0 && (
          <div className="globe-run-error">{runErrors[0]}</div>
        )}

        {runHint && (
          <p className="globe-hint globe-controls__label globe-hint--interactive">{runHint}</p>
        )}

        <p className="globe-hint globe-controls__label">
          Drag to rotate · Scroll to zoom
        </p>
        <p className="globe-hint globe-controls__label">
          1 h trip time = 1 s real time
        </p>
        <p className="globe-hint globe-controls__label">
          Hover a plane to see who it is
        </p>
      </div>
    </div>
  );
}
