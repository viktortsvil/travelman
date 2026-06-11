import { useCallback, useEffect, useRef, useState } from "react";
import AuthBar from "./components/AuthBar";
import Globe from "./components/Globe";
import GroupPanel from "./components/GroupPanel";
import { useAuth } from "./context/AuthContext.jsx";
import { fetchAllFlightRowsForGroup } from "./services/groupService.js";
import {
  findNextEventUtcMs,
  findPreviousEventUtcMs,
  resolveAllFlights,
  TWO_HOURS_MS,
} from "./utils/flightUtils.js";
import { utcDateTimeToMs, utcMsToDateStr, utcMsToTimeStr } from "./utils/timeUtils.js";
import "./App.css";

function mapsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

export default function App() {
  const { user, configured } = useAuth();

  const [activeGroup, setActiveGroup] = useState(null);
  const [groupMemberCount, setGroupMemberCount] = useState(0);
  const [groupFlightCount, setGroupFlightCount] = useState(0);
  const [travelerNames, setTravelerNames] = useState(new Map());
  const [travelerAvatars, setTravelerAvatars] = useState(new Map());

  const [tripDate, setTripDate] = useState("");
  const [tripTime, setTripTime] = useState("06:00");
  const [globeDate, setGlobeDate] = useState("");
  const [globeTime, setGlobeTime] = useState("06:00");
  const [globeUtcMs, setGlobeUtcMs] = useState(null);

  const [resolvedFlights, setResolvedFlights] = useState([]);
  const [runErrors, setRunErrors] = useState([]);

  const [seekUtcMs, setSeekUtcMs] = useState(null);
  const [tripClockUtcMs, setTripClockUtcMs] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [running, setRunning] = useState(false);

  const pauseClockMsRef = useRef(null);

  const syncGlobeUtcMs = useCallback((date, time) => {
    const ms = utcDateTimeToMs(date, time);
    setGlobeUtcMs(Number.isNaN(ms) ? null : ms);
    return ms;
  }, []);

  const applyUtcMsToGlobe = useCallback(
    (ms) => {
      if (ms == null || Number.isNaN(ms)) return;

      setGlobeUtcMs(ms);
      setGlobeDate(utcMsToDateStr(ms));
      setGlobeTime(utcMsToTimeStr(ms));

      if (seekUtcMs != null && !playing) {
        pauseClockMsRef.current = ms;
        setSeekUtcMs(ms);
        setTripClockUtcMs(ms);
      }
    },
    [seekUtcMs, playing],
  );

  useEffect(() => {
    if (activeGroup) {
      setTripDate(activeGroup.simDate);
      setTripTime(activeGroup.simTime);
      if (!playing && seekUtcMs == null) {
        const simTime = activeGroup.simTime || "06:00";
        setGlobeDate(activeGroup.simDate);
        setGlobeTime(simTime);
        syncGlobeUtcMs(activeGroup.simDate, simTime);
      }
    }
  }, [activeGroup?.simDate, activeGroup?.simTime, activeGroup?.id, playing, seekUtcMs, syncGlobeUtcMs]);

  useEffect(() => {
    pauseClockMsRef.current = null;
    setSeekUtcMs(null);
    setTripClockUtcMs(null);
    setPlaying(false);
    setResolvedFlights([]);
    if (activeGroup) {
      const simTime = activeGroup.simTime || "06:00";
      setGlobeDate(activeGroup.simDate);
      setGlobeTime(simTime);
      syncGlobeUtcMs(activeGroup.simDate, simTime);
    } else {
      setGlobeDate("");
      setGlobeTime("06:00");
      setGlobeUtcMs(null);
    }
  }, [activeGroup?.id, syncGlobeUtcMs]);

  useEffect(() => {
    if (!activeGroup || !configured) {
      setResolvedFlights([]);
      return;
    }

    let cancelled = false;

    (async () => {
      const { rows, error } = await fetchAllFlightRowsForGroup(activeGroup.id);
      if (cancelled) return;

      if (error) {
        setResolvedFlights([]);
        return;
      }

      const { flights } = resolveAllFlights(rows);
      setResolvedFlights(flights);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeGroup?.id, configured]);

  const handleTripClockChange = useCallback((ms) => {
    setTripClockUtcMs(ms);
  }, []);

  const handleGlobeDateChange = useCallback(
    (date) => {
      setGlobeDate(date);
      syncGlobeUtcMs(date, globeTime);
    },
    [globeTime, syncGlobeUtcMs],
  );

  const handleGlobeTimeChange = useCallback(
    (time) => {
      setGlobeTime(time);
      syncGlobeUtcMs(globeDate, time);
    },
    [globeDate, syncGlobeUtcMs],
  );

  const getCurrentGlobeUtcMs = useCallback(() => {
    if (globeUtcMs != null) return globeUtcMs;
    const ms = utcDateTimeToMs(globeDate, globeTime);
    return Number.isNaN(ms) ? null : ms;
  }, [globeUtcMs, globeDate, globeTime]);

  const handleSeekBack2h = useCallback(() => {
    const ms = getCurrentGlobeUtcMs();
    if (ms == null) return;
    applyUtcMsToGlobe(ms - TWO_HOURS_MS);
  }, [getCurrentGlobeUtcMs, applyUtcMsToGlobe]);

  const handleSeekForward2h = useCallback(() => {
    const ms = getCurrentGlobeUtcMs();
    if (ms == null) return;
    applyUtcMsToGlobe(ms + TWO_HOURS_MS);
  }, [getCurrentGlobeUtcMs, applyUtcMsToGlobe]);

  const handleSkipToNext = useCallback(() => {
    const ms = getCurrentGlobeUtcMs();
    if (ms == null || resolvedFlights.length === 0) return;

    const nextMs = findNextEventUtcMs(resolvedFlights, ms);
    if (nextMs == null) return;

    applyUtcMsToGlobe(nextMs);
  }, [getCurrentGlobeUtcMs, resolvedFlights, applyUtcMsToGlobe]);

  const handleSkipToPrevious = useCallback(() => {
    const ms = getCurrentGlobeUtcMs();
    if (ms == null || resolvedFlights.length === 0) return;

    const prevMs = findPreviousEventUtcMs(resolvedFlights, ms);
    if (prevMs == null) return;

    applyUtcMsToGlobe(prevMs);
  }, [getCurrentGlobeUtcMs, resolvedFlights, applyUtcMsToGlobe]);

  const handleRun = useCallback(async () => {
    if (!user || !configured) {
      setRunErrors(["Sign in to run the trip."]);
      return;
    }

    if (!activeGroup) {
      setRunErrors(["Select or join a trip first."]);
      return;
    }

    setRunning(true);
    const { rows, error } = await fetchAllFlightRowsForGroup(activeGroup.id);
    setRunning(false);

    if (error) {
      setRunErrors([error.message]);
      return;
    }

    const { flights } = resolveAllFlights(rows);

    if (flights.length === 0) {
      setRunErrors(["Add and save at least one flight in the trip."]);
      return;
    }

    const startMs = getCurrentGlobeUtcMs();
    if (startMs == null) {
      setRunErrors(["Trip start is not set yet — save flights in the panel first."]);
      return;
    }

    setRunErrors([]);
    setResolvedFlights(flights);
    pauseClockMsRef.current = startMs;
    setSeekUtcMs(startMs);
    setTripClockUtcMs(startMs);
    setGlobeUtcMs(startMs);
    setPlaying(true);
  }, [user, configured, activeGroup, getCurrentGlobeUtcMs]);

  const handlePlayPause = useCallback(async () => {
    if (playing) {
      if (tripClockUtcMs != null) {
        pauseClockMsRef.current = tripClockUtcMs;
        applyUtcMsToGlobe(tripClockUtcMs);
      }
      setPlaying(false);
      return;
    }

    if (seekUtcMs == null || resolvedFlights.length === 0) {
      await handleRun();
      return;
    }

    const seekMs = getCurrentGlobeUtcMs();
    if (seekMs == null) {
      setRunErrors(["Invalid trip time."]);
      return;
    }

    setRunErrors([]);
    if (seekMs !== pauseClockMsRef.current) {
      setSeekUtcMs(seekMs);
      setTripClockUtcMs(seekMs);
      pauseClockMsRef.current = seekMs;
    }
    setPlaying(true);
  }, [
    playing,
    seekUtcMs,
    resolvedFlights.length,
    tripClockUtcMs,
    getCurrentGlobeUtcMs,
    applyUtcMsToGlobe,
    handleRun,
  ]);

  const handleMembersChange = useCallback((names, avatars) => {
    const nextAvatars = avatars ?? new Map();
    setTravelerNames((prev) => (mapsEqual(prev, names) ? prev : names));
    setTravelerAvatars((prev) =>
      mapsEqual(prev, nextAvatars) ? prev : nextAvatars,
    );
  }, []);

  const handleGroupSummaryChange = useCallback((memberCount, flightCount) => {
    setGroupMemberCount(memberCount);
    setGroupFlightCount(flightCount);
  }, []);

  const tripActive = resolvedFlights.length > 0;
  const previewUtcMs = getCurrentGlobeUtcMs();
  const viewUtcMs =
    playing && tripClockUtcMs != null ? tripClockUtcMs : previewUtcMs;
  const nextEventUtcMs =
    previewUtcMs != null && resolvedFlights.length > 0
      ? findNextEventUtcMs(resolvedFlights, previewUtcMs)
      : null;
  const prevEventUtcMs =
    previewUtcMs != null && resolvedFlights.length > 0
      ? findPreviousEventUtcMs(resolvedFlights, previewUtcMs)
      : null;
  const globeDisplayDate =
    playing && tripClockUtcMs != null
      ? utcMsToDateStr(tripClockUtcMs)
      : globeDate;
  const globeDisplayTime =
    playing && tripClockUtcMs != null
      ? utcMsToTimeStr(tripClockUtcMs)
      : globeTime;

  const runHint =
    activeGroup && groupFlightCount > 0
      ? `Playing ${groupFlightCount} flight${
          groupFlightCount === 1 ? "" : "s"
        } from ${groupMemberCount} traveler${
          groupMemberCount === 1 ? "" : "s"
        }`
      : null;

  return (
    <div className="app">
      <AuthBar />

      <Globe
        resolvedFlights={resolvedFlights}
        viewUtcMs={viewUtcMs}
        seekUtcMs={seekUtcMs}
        playing={playing}
        tripActive={tripActive}
        tripDate={globeDisplayDate}
        tripTime={globeDisplayTime}
        onTripDateChange={handleGlobeDateChange}
        onTripTimeChange={handleGlobeTimeChange}
        tripTimeLocked={playing}
        onTripClockChange={handleTripClockChange}
        onPlayPause={handlePlayPause}
        onSeekBack2h={handleSeekBack2h}
        onSeekForward2h={handleSeekForward2h}
        onSkipToNext={handleSkipToNext}
        onSkipToPrevious={handleSkipToPrevious}
        navDisabled={playing || previewUtcMs == null}
        skipToNextDisabled={playing || nextEventUtcMs == null}
        skipToPreviousDisabled={playing || prevEventUtcMs == null}
        runErrors={runErrors}
        runDisabled={running || !activeGroup}
        runHint={runHint}
        travelerNames={travelerNames}
        travelerAvatars={travelerAvatars}
      />

      <GroupPanel
        open={panelOpen}
        onToggleOpen={() => setPanelOpen((o) => !o)}
        onGroupChange={setActiveGroup}
        onGroupSummaryChange={handleGroupSummaryChange}
        onMembersChange={handleMembersChange}
        tripDate={tripDate}
        tripTime={tripTime}
      />
    </div>
  );
}
