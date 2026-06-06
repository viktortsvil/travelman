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
  VerticalOrigin,
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
  positionForPersonState,
} from "../utils/geoUtils.js";
import {
  AVATAR_BILLBOARD_PX,
  applyBillboardImage,
  travelerMarkerImage,
  tryLoadTravelerAvatar,
} from "../utils/avatarUtils.js";
import {
  loadGentlemanHatImage,
  NORTH_POLE_HAT_BILLBOARD_PX,
} from "../utils/gentlemanHat.js";
import DateInput from "./DateInput.jsx";
import "./Globe.css";

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
  tripTimeLocked = false,
  runErrors,
  runDisabled = false,
  runHint,
  travelerNames = new Map(),
  travelerAvatars = new Map(),
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
  const travelerAvatarsRef = useRef(travelerAvatars);
  const avatarImageCacheRef = useRef(new Map());
  const photoLoadedUsersRef = useRef(new Set());
  const planeEntitiesRef = useRef(new Map());
  const entityKeysRef = useRef([]);

  const [hoveredTravelers, setHoveredTravelers] = useState(null);
  const [hintsVisible, setHintsVisible] = useState(true);

  const hideOrShowHints = () => {
    setHintsVisible((visible) => !visible);
  };

  playingRef.current = playing;
  travelerNamesRef.current = travelerNames;
  travelerAvatarsRef.current = travelerAvatars;

  const requestAvatarForUser = (userId, entity) => {
    const target = entity ?? planeEntitiesRef.current.get(userId);
    const cached = avatarImageCacheRef.current.get(userId);
    if (photoLoadedUsersRef.current.has(userId) && cached) {
      applyBillboardImage(target, cached);
      return;
    }

    const avatarUrl = travelerAvatarsRef.current.get(userId) ?? null;
    tryLoadTravelerAvatar({
      userId,
      avatarUrl,
      onSuccess: (image) => {
        photoLoadedUsersRef.current.add(userId);
        avatarImageCacheRef.current.set(userId, image);
        applyBillboardImage(entity ?? planeEntitiesRef.current.get(userId), image);
        viewerRef.current?.scene.requestRender();
      },
    });
  };

  const updateInitialsMarker = (userId, entity) => {
    if (photoLoadedUsersRef.current.has(userId)) return;
    const displayName = travelerNamesRef.current.get(userId) ?? "Unknown Traveler";
    const color = userColorsRef.current.get(userId) ?? "#4ecdc4";
    const marker = travelerMarkerImage(displayName, color);
    avatarImageCacheRef.current.set(userId, marker);
    applyBillboardImage(entity, marker);
  };

  useEffect(() => {
    avatarImageCacheRef.current.clear();
    photoLoadedUsersRef.current.clear();

    for (const [userId, avatarUrl] of travelerAvatars) {
      if (!avatarUrl) continue;
      requestAvatarForUser(userId, planeEntitiesRef.current.get(userId));
    }
  }, [travelerAvatars]);

  useEffect(() => {
    const viewer = viewerRef.current;
    for (const [userId, entity] of planeEntitiesRef.current) {
      updateInitialsMarker(userId, entity);
    }
    viewer?.scene.requestRender();
  }, [travelerNames]);

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
    planeEntitiesRef.current.clear();
    setHoveredTravelers(null);

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

    for (const [userId] of flightsByUser) {
      const color = userColors.get(userId) ?? "#4ecdc4";
      const displayName = travelerNamesRef.current.get(userId) ?? "Unknown Traveler";
      const planeId = `plane-${userId}`;
      entityKeysRef.current.push(planeId);

      const entity = viewer.entities.add({
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
          image:
            avatarImageCacheRef.current.get(userId) ??
            travelerMarkerImage(displayName, color),
          width: AVATAR_BILLBOARD_PX,
          height: AVATAR_BILLBOARD_PX,
          color: Color.WHITE.withAlpha(0.7),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      planeEntitiesRef.current.set(userId, entity);
      requestAvatarForUser(userId, entity);
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
    viewer.canvas.style.imageRendering = "auto";

    loadGentlemanHatImage().then((hatImage) => {
      if (viewer.isDestroyed()) return;

      viewer.entities.add({
        id: "north-pole-hat",
        position: Cartesian3.fromDegrees(0, 90, 0),
        billboard: {
          image: hatImage,
          width: NORTH_POLE_HAT_BILLBOARD_PX,
          height: Math.round(NORTH_POLE_HAT_BILLBOARD_PX * (148 / 128)),
          verticalOrigin: VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      viewer.scene.requestRender();
    });

    const hoverHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    hoverHandler.setInputAction((movement) => {
      const pickedObjects = viewer.scene.drillPick(movement.endPosition, 32);
      const names = [];
      const seenUserIds = new Set();

      for (const picked of pickedObjects) {
        const entityId = picked?.id?.id;
        if (typeof entityId !== "string" || !entityId.startsWith("plane-")) {
          continue;
        }

        const userId = entityId.slice("plane-".length);
        if (seenUserIds.has(userId)) continue;
        seenUserIds.add(userId);

        names.push({
          userId,
          name: travelerNamesRef.current.get(userId) ?? "Traveler",
        });
      }

      if (names.length > 0) {
        setHoveredTravelers({
          travelers: names,
          x: movement.endPosition.x,
          y: movement.endPosition.y,
        });
        viewer.canvas.style.cursor = "pointer";
      } else {
        setHoveredTravelers(null);
        viewer.canvas.style.cursor = "";
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);
    clickHandlerRef.current = hoverHandler;

    const clearHover = () => {
      setHoveredTravelers(null);
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

  return (
    <div className="globe-root">
      <div ref={containerRef} className="globe-viewer" />

      {hoveredTravelers && (
        <div
          className="globe-traveler-tooltip"
          style={{
            left: hoveredTravelers.x + 14,
            top: hoveredTravelers.y + 14,
          }}
        >
          {hoveredTravelers.travelers.map(({ userId, name }) => (
            <div key={userId} className="globe-traveler-tooltip__name">
              {name}
            </div>
          ))}
        </div>
      )}

      <div className="globe-controls">
        <div className="globe-controls__group">
          <p className="globe-controls__label">
            {tripActive ? "Trip time (UTC)" : "Trip start (UTC)"}
          </p>
          <div className="globe-controls__datetime-row">
            <DateInput
              value={tripDate}
              onChange={onTripDateChange}
              disabled={tripTimeLocked}
            />
            <input
              type="time"
              className="globe-controls__time"
              value={tripTime}
              onChange={(e) => onTripTimeChange?.(e.target.value)}
              disabled={tripTimeLocked}
              title={
                tripTimeLocked
                  ? "Pause the trip to change time"
                  : "Local playback time — not saved to the trip"
              }
            />
          </div>
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
      </div>

      <div className="globe-hints" onClick={hideOrShowHints}>
        {hintsVisible ? (
          <>
            {runHint && (
              <p className="globe-hint globe-controls__label globe-hint--interactive">
                {runHint}
              </p>
            )}

            <p className="globe-hint globe-controls__label">
              Drag to rotate · Scroll to zoom
            </p>
            <p className="globe-hint globe-controls__label">
              1 h trip time = 1 s real time
            </p>
            <p className="globe-hint globe-controls__label">
              Hover travelers to see their names
            </p>
          </>
        ) : (
          <p className="globe-hint globe-controls__label">Click to show hints</p>
        )}
      </div>
    </div>
  );
}
