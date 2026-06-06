import { useCallback, useEffect, useRef, useState } from "react";
import AuthBar from "./components/AuthBar";
import Globe from "./components/Globe";
import GroupPanel from "./components/GroupPanel";
import { useAuth } from "./context/AuthContext.jsx";
import { fetchAllFlightRowsForGroup } from "./services/groupService.js";
import { resolveAllFlights } from "./utils/flightUtils.js";
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

  const [resolvedFlights, setResolvedFlights] = useState([]);
  const [resolveErrors, setResolveErrors] = useState([]);
  const [runErrors, setRunErrors] = useState([]);

  const [seekUtcMs, setSeekUtcMs] = useState(null);
  const [tripClockUtcMs, setTripClockUtcMs] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [running, setRunning] = useState(false);

  const pauseClockMsRef = useRef(null);

  useEffect(() => {
    if (activeGroup) {
      setTripDate(activeGroup.simDate);
      setTripTime(activeGroup.simTime);
      if (!playing && seekUtcMs == null) {
        setGlobeDate(activeGroup.simDate);
        setGlobeTime(activeGroup.simTime || "06:00");
      }
    }
  }, [activeGroup?.simDate, activeGroup?.simTime, activeGroup?.id, playing, seekUtcMs]);

  useEffect(() => {
    pauseClockMsRef.current = null;
    setSeekUtcMs(null);
    setTripClockUtcMs(null);
    setPlaying(false);
    setResolvedFlights([]);
    if (activeGroup) {
      setGlobeDate(activeGroup.simDate);
      setGlobeTime(activeGroup.simTime || "06:00");
    } else {
      setGlobeDate("");
      setGlobeTime("06:00");
    }
  }, [activeGroup?.id]);

  const handleTripClockChange = useCallback((ms) => {
    setTripClockUtcMs(ms);
  }, []);

  const handleGlobeDateChange = useCallback((date) => {
    setGlobeDate(date);
  }, []);

  const handleGlobeTimeChange = useCallback((time) => {
    setGlobeTime(time);
  }, []);

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

    const { flights, errors } = resolveAllFlights(rows);
    setResolveErrors(errors);

    if (errors.length > 0) {
      setRunErrors(["Fix schedule errors in the panel before running."]);
      return;
    }

    if (flights.length === 0) {
      setRunErrors(["Add and save at least one flight in the trip."]);
      return;
    }

    const startMs = utcDateTimeToMs(globeDate, globeTime);
    if (Number.isNaN(startMs)) {
      setRunErrors(["Trip start is not set yet — save flights in the panel first."]);
      return;
    }

    setRunErrors([]);
    setResolvedFlights(flights);
    pauseClockMsRef.current = startMs;
    setSeekUtcMs(startMs);
    setTripClockUtcMs(startMs);
    setPlaying(true);
  }, [user, configured, activeGroup, globeDate, globeTime]);

  const handlePlayPause = useCallback(async () => {
    if (playing) {
      if (tripClockUtcMs != null) {
        pauseClockMsRef.current = tripClockUtcMs;
        setGlobeDate(utcMsToDateStr(tripClockUtcMs));
        setGlobeTime(utcMsToTimeStr(tripClockUtcMs));
      }
      setPlaying(false);
      return;
    }

    if (seekUtcMs == null || resolvedFlights.length === 0) {
      await handleRun();
      return;
    }

    const seekMs = utcDateTimeToMs(globeDate, globeTime);
    if (Number.isNaN(seekMs)) {
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
    globeDate,
    globeTime,
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

  const tripActive = seekUtcMs != null;
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
        runErrors={runErrors}
        runDisabled={running || !activeGroup}
        runHint={runHint}
        travelerNames={travelerNames}
        travelerAvatars={travelerAvatars}
      />

      <GroupPanel
        open={panelOpen}
        onToggleOpen={() => setPanelOpen((o) => !o)}
        errors={resolveErrors}
        onGroupChange={setActiveGroup}
        onGroupSummaryChange={handleGroupSummaryChange}
        onMembersChange={handleMembersChange}
        tripDate={tripDate}
        tripTime={tripTime}
      />
    </div>
  );
}
