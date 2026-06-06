import { useCallback, useState } from "react";
import AuthBar from "./components/AuthBar";
import Globe from "./components/Globe";
import GroupPanel from "./components/GroupPanel";
import { useAuth } from "./context/AuthContext.jsx";
import { fetchAllFlightRowsForGroup } from "./services/groupService.js";
import { resolveAllFlights } from "./utils/flightUtils.js";
import { utcDateTimeToMs } from "./utils/timeUtils.js";
import "./App.css";

export default function App() {
  const { user, configured } = useAuth();

  const [activeGroup, setActiveGroup] = useState(null);
  const [groupMemberCount, setGroupMemberCount] = useState(0);
  const [groupFlightCount, setGroupFlightCount] = useState(0);

  const [resolvedFlights, setResolvedFlights] = useState([]);
  const [resolveErrors, setResolveErrors] = useState([]);
  const [runErrors, setRunErrors] = useState([]);

  const [simStartUtcMs, setSimStartUtcMs] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [running, setRunning] = useState(false);

  const handleRun = useCallback(async () => {
    if (!user || !configured) {
      setRunErrors(["Sign in to run a group simulation."]);
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

    const startMs = utcDateTimeToMs(activeGroup.simDate, activeGroup.simTime);
    if (Number.isNaN(startMs)) {
      setRunErrors(["Invalid group simulation start date/time."]);
      return;
    }

    setRunErrors([]);
    setResolvedFlights(flights);
    setSimStartUtcMs(startMs);
    setPlaying(true);
  }, [user, configured, activeGroup]);

  const togglePlaying = useCallback(() => {
    setPlaying((p) => !p);
  }, []);

  const handleGroupSummaryChange = useCallback((memberCount, flightCount) => {
    setGroupMemberCount(memberCount);
    setGroupFlightCount(flightCount);
  }, []);

  const runHint =
    activeGroup && groupFlightCount > 0
      ? `Run will play ${groupFlightCount} flight${
          groupFlightCount === 1 ? "" : "s"
        } from ${groupMemberCount} member${
          groupMemberCount === 1 ? "" : "s"
        }.`
      : null;

  return (
    <div className="app">
      <AuthBar />

      <Globe
        resolvedFlights={resolvedFlights}
        simStartUtcMs={simStartUtcMs}
        playing={playing}
        onTogglePlaying={togglePlaying}
        simDate={activeGroup?.simDate ?? ""}
        simTime={activeGroup?.simTime ?? "06:00"}
        onSimDateChange={() => {}}
        onSimTimeInputChange={() => {}}
        simSettingsReadOnly
        onRun={handleRun}
        runErrors={runErrors}
        runDisabled={running || !activeGroup}
        runHint={runHint}
      />

      <GroupPanel
        open={panelOpen}
        onToggleOpen={() => setPanelOpen((o) => !o)}
        errors={resolveErrors}
        onGroupChange={setActiveGroup}
        onGroupSummaryChange={handleGroupSummaryChange}
      />
    </div>
  );
}
