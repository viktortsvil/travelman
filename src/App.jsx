import { useCallback, useEffect, useRef, useState } from "react";
import AuthBar from "./components/AuthBar";
import Globe from "./components/Globe";
import GroupPanel from "./components/GroupPanel";
import { useAuth } from "./context/AuthContext.jsx";
import {
  fetchAllFlightRowsForGroup,
  updateGroupSimSettings,
} from "./services/groupService.js";
import { resolveAllFlights } from "./utils/flightUtils.js";
import { utcDateTimeToMs, utcMsToDateStr, utcMsToTimeStr } from "./utils/timeUtils.js";
import "./App.css";

export default function App() {
  const { user, configured } = useAuth();

  const [activeGroup, setActiveGroup] = useState(null);
  const [groupMemberCount, setGroupMemberCount] = useState(0);
  const [groupFlightCount, setGroupFlightCount] = useState(0);
  const [travelerNames, setTravelerNames] = useState(new Map());

  const [tripDate, setTripDate] = useState("");
  const [tripTime, setTripTime] = useState("06:00");

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
    }
  }, [activeGroup?.id, activeGroup?.simDate, activeGroup?.simTime]);

  useEffect(() => {
    pauseClockMsRef.current = null;
    setSeekUtcMs(null);
    setTripClockUtcMs(null);
    setPlaying(false);
    setResolvedFlights([]);
  }, [activeGroup?.id]);

  const persistTripStart = useCallback(
    async (date, time) => {
      if (!activeGroup) return;
      await updateGroupSimSettings(activeGroup.id, date, time);
      setActiveGroup((group) =>
        group ? { ...group, simDate: date, simTime: time } : group,
      );
    },
    [activeGroup],
  );

  const handleTripDateChange = useCallback(
    (date) => {
      setTripDate(date);
      if (!playing) {
        persistTripStart(date, tripTime);
      }
    },
    [tripTime, persistTripStart, playing],
  );

  const handleTripTimeChange = useCallback(
    (time) => {
      setTripTime(time);
      if (!playing) {
        persistTripStart(tripDate, time);
      }
    },
    [tripDate, persistTripStart, playing],
  );

  const handleTripClockChange = useCallback((ms) => {
    setTripClockUtcMs(ms);
  }, []);

  const handleRun = useCallback(async () => {
    if (!user || !configured) {
      setRunErrors(["Sign in to run the trip."]);
      return;
    }

    if (!activeGroup) {
      setRunErrors(["Select or join a group first."]);
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
      setRunErrors(["Add and save at least one flight in the group."]);
      return;
    }

    const startMs = utcDateTimeToMs(tripDate, tripTime);
    if (Number.isNaN(startMs)) {
      setRunErrors(["Invalid trip start date/time."]);
      return;
    }

    setRunErrors([]);
    setResolvedFlights(flights);
    pauseClockMsRef.current = startMs;
    setSeekUtcMs(startMs);
    setTripClockUtcMs(startMs);
    setPlaying(true);
  }, [user, configured, activeGroup, tripDate, tripTime]);

  const handlePlayPause = useCallback(async () => {
    if (playing) {
      if (tripClockUtcMs != null) {
        pauseClockMsRef.current = tripClockUtcMs;
        setTripDate(utcMsToDateStr(tripClockUtcMs));
        setTripTime(utcMsToTimeStr(tripClockUtcMs));
      }
      setPlaying(false);
      return;
    }

    if (seekUtcMs == null || resolvedFlights.length === 0) {
      await handleRun();
      return;
    }

    const configuredStartMs = utcDateTimeToMs(tripDate, tripTime);
    if (Number.isNaN(configuredStartMs)) {
      setRunErrors(["Invalid trip start date/time."]);
      return;
    }

    setRunErrors([]);
    if (configuredStartMs !== pauseClockMsRef.current) {
      setSeekUtcMs(configuredStartMs);
      setTripClockUtcMs(configuredStartMs);
      pauseClockMsRef.current = configuredStartMs;
    }

    setPlaying(true);
  }, [
    playing,
    seekUtcMs,
    resolvedFlights.length,
    tripDate,
    tripTime,
    tripClockUtcMs,
    handleRun,
  ]);

  const handleGroupSummaryChange = useCallback((memberCount, flightCount) => {
    setGroupMemberCount(memberCount);
    setGroupFlightCount(flightCount);
  }, []);

  const tripActive = seekUtcMs != null;
  const displayTripDate =
    playing && tripClockUtcMs != null
      ? utcMsToDateStr(tripClockUtcMs)
      : tripDate;
  const displayTripTime =
    playing && tripClockUtcMs != null
      ? utcMsToTimeStr(tripClockUtcMs)
      : tripTime;

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
        tripDate={displayTripDate}
        tripTime={displayTripTime}
        onTripDateChange={handleTripDateChange}
        onTripTimeChange={handleTripTimeChange}
        onTripClockChange={handleTripClockChange}
        onPlayPause={handlePlayPause}
        runErrors={runErrors}
        runDisabled={running || !activeGroup}
        runHint={runHint}
        travelerNames={travelerNames}
      />

      <GroupPanel
        open={panelOpen}
        onToggleOpen={() => setPanelOpen((o) => !o)}
        errors={resolveErrors}
        onGroupChange={setActiveGroup}
        onGroupSummaryChange={handleGroupSummaryChange}
        onMembersChange={setTravelerNames}
        tripDate={tripDate}
        tripTime={tripTime}
        onTripDateChange={handleTripDateChange}
        onTripTimeChange={handleTripTimeChange}
        tripStartLocked={playing}
      />
    </div>
  );
}
