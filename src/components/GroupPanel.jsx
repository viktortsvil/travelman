import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import {
  createGroup,
  fetchGroup,
  fetchGroupFlightSummary,
  fetchMyFlightRowsForGroup,
  fetchMyGroups,
  joinGroupByCode,
  saveMyFlightsForGroup,
  updateGroupSimSettings,
} from "../services/groupService.js";
import { dbGroupToUi } from "../utils/tripMappers.js";
import { createEmptyFlightRow } from "../utils/flightUtils.js";
import FlightScheduleTable from "./FlightScheduleTable.jsx";
import "./FlightPanel.css";
import "./GroupPanel.css";

export default function GroupPanel({
  open,
  onToggleOpen,
  errors,
  onGroupChange,
  onGroupSummaryChange,
}) {
  const { user, configured, signInWithGoogle } = useAuth();

  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [activeGroup, setActiveGroup] = useState(null);

  const [flightRows, setFlightRows] = useState([createEmptyFlightRow()]);
  const [dirty, setDirty] = useState(false);
  const [memberCount, setMemberCount] = useState(0);
  const [totalFlights, setTotalFlights] = useState(0);
  const [flightsByUser, setFlightsByUser] = useState(new Map());

  const [newGroupName, setNewGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [panelError, setPanelError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingFlights, setLoadingFlights] = useState(false);
  const [saving, setSaving] = useState(false);

  const myFlightCount = user ? (flightsByUser.get(user.id) ?? 0) : 0;

  const refreshGroups = useCallback(async () => {
    if (!user || !configured) return;

    setLoadingGroups(true);
    const { groups: nextGroups, error } = await fetchMyGroups();
    setLoadingGroups(false);

    if (error) {
      setPanelError(error.message);
      return;
    }

    setGroups(nextGroups.map(dbGroupToUi));
  }, [user, configured]);

  const refreshGroupData = useCallback(
    async (groupId) => {
      if (!groupId || !user) {
        setMemberCount(0);
        setTotalFlights(0);
        setFlightsByUser(new Map());
        onGroupSummaryChange?.(0, 0);
        return;
      }

      setLoadingFlights(true);

      const [
        { rows, error: rowsError },
        { memberCount: members, totalFlights: flights, flightsByUser: byUser, error: summaryError },
      ] = await Promise.all([
        fetchMyFlightRowsForGroup(groupId, user.id),
        fetchGroupFlightSummary(groupId),
      ]);

      setLoadingFlights(false);

      if (rowsError || summaryError) {
        setPanelError(rowsError?.message ?? summaryError?.message ?? "Failed to load group");
        return;
      }

      setFlightRows(rows.length > 0 ? rows : [createEmptyFlightRow()]);
      setDirty(false);
      setMemberCount(members);
      setTotalFlights(flights);
      setFlightsByUser(byUser);
      onGroupSummaryChange?.(members, flights);
    },
    [user, onGroupSummaryChange],
  );

  useEffect(() => {
    refreshGroups();
  }, [refreshGroups]);

  useEffect(() => {
    if (groups.length > 0 && !selectedGroupId) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, selectedGroupId]);

  useEffect(() => {
    if (!selectedGroupId) {
      setActiveGroup(null);
      onGroupChange?.(null);
      setFlightRows([createEmptyFlightRow()]);
      setDirty(false);
      return;
    }

    let cancelled = false;

    (async () => {
      const { group, error } = await fetchGroup(selectedGroupId);
      if (cancelled) return;

      if (error || !group) {
        setPanelError(error?.message ?? "Group not found");
        return;
      }

      const uiGroup = dbGroupToUi(group);
      setActiveGroup(uiGroup);
      onGroupChange?.(uiGroup);
      await refreshGroupData(selectedGroupId);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedGroupId, onGroupChange, refreshGroupData]);

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      setPanelError("Enter a group name.");
      return;
    }

    setPanelError("");
    const { group, error } = await createGroup(name);
    if (error) {
      setPanelError(error.message);
      return;
    }

    setNewGroupName("");
    setStatusMessage(`Created "${group.name}". Share code ${group.join_code}.`);
    await refreshGroups();
    setSelectedGroupId(group.id);
  };

  const handleJoinGroup = async () => {
    const code = joinCode.trim();
    if (!code) {
      setPanelError("Enter a join code.");
      return;
    }

    setPanelError("");
    const { groupId, error } = await joinGroupByCode(code);
    if (error) {
      setPanelError(error.message);
      return;
    }

    setJoinCode("");
    setStatusMessage("Joined group.");
    await refreshGroups();
    setSelectedGroupId(groupId);
  };

  const handleSimDateChange = async (simDate) => {
    if (!activeGroup) return;

    const nextGroup = { ...activeGroup, simDate };
    setActiveGroup(nextGroup);
    onGroupChange?.(nextGroup);

    const { error } = await updateGroupSimSettings(
      activeGroup.id,
      simDate,
      activeGroup.simTime,
    );
    if (error) setPanelError(error.message);
  };

  const handleSimTimeChange = async (simTime) => {
    if (!activeGroup) return;

    const nextGroup = { ...activeGroup, simTime };
    setActiveGroup(nextGroup);
    onGroupChange?.(nextGroup);

    const { error } = await updateGroupSimSettings(
      activeGroup.id,
      activeGroup.simDate,
      simTime,
    );
    if (error) setPanelError(error.message);
  };

  const handleSaveFlights = async () => {
    if (!activeGroup || !user) return;

    setSaving(true);
    setPanelError("");

    const { error } = await saveMyFlightsForGroup(
      activeGroup.id,
      user.id,
      flightRows,
    );

    setSaving(false);

    if (error) {
      setPanelError(error.message);
      return;
    }

    setStatusMessage("Flights saved.");
    setDirty(false);
    await refreshGroupData(activeGroup.id);
  };

  const handleFlightRowsChange = (rows) => {
    setFlightRows(rows);
    setDirty(true);
  };

  const renderSignedOut = () => (
    <div className="group-panel__empty">
      <p>Sign in to create or join groups and add your flights.</p>
      {configured ? (
        <button
          type="button"
          className="group-panel__btn group-panel__btn--primary"
          onClick={() => signInWithGoogle()}
        >
          Sign in with Google
        </button>
      ) : (
        <p className="group-panel__hint">
          Add Supabase env vars to enable groups.
        </p>
      )}
    </div>
  );

  const renderGroupPicker = () => (
    <section className="group-panel__section">
      <div className="group-panel__row">
        <label className="group-panel__label" htmlFor="group-select">
          Group
        </label>
        <select
          id="group-select"
          className="group-panel__select"
          value={selectedGroupId}
          onChange={(e) => {
            setSelectedGroupId(e.target.value);
            setPanelError("");
            setStatusMessage("");
          }}
          disabled={loadingGroups || groups.length === 0}
        >
          {groups.length === 0 ? (
            <option value="">No groups yet</option>
          ) : (
            groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))
          )}
        </select>
      </div>

      <div className="group-panel__row group-panel__row--split">
        <input
          type="text"
          className="group-panel__input"
          placeholder="New group name"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
        />
        <button
          type="button"
          className="group-panel__btn group-panel__btn--primary"
          onClick={handleCreateGroup}
        >
          Create
        </button>
      </div>

      <div className="group-panel__row group-panel__row--split">
        <input
          type="text"
          className="group-panel__input"
          placeholder="Join code"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
        />
        <button
          type="button"
          className="group-panel__btn"
          onClick={handleJoinGroup}
        >
          Join
        </button>
      </div>
    </section>
  );

  const renderActiveGroup = () => {
    if (!activeGroup) return null;

    const otherFlightCount = totalFlights - myFlightCount;

    return (
      <>
        <section className="group-panel__section">
          <div className="group-panel__meta">
            <p>
              Join code:{" "}
              <strong className="group-panel__code">{activeGroup.joinCode}</strong>
            </p>
            <p className="group-panel__hint">
              {memberCount} member{memberCount === 1 ? "" : "s"},{" "}
              {totalFlights} flight{totalFlights === 1 ? "" : "s"} total.
              Run plays everyone&apos;s flights together.
            </p>
          </div>

          <div className="group-panel__row group-panel__row--split">
            <label className="group-panel__label" htmlFor="group-sim-date">
              Sim start (UTC)
            </label>
            <input
              id="group-sim-date"
              type="date"
              className="group-panel__input group-panel__input--compact"
              value={activeGroup.simDate}
              onChange={(e) => handleSimDateChange(e.target.value)}
            />
            <input
              type="time"
              className="group-panel__input group-panel__input--compact"
              value={activeGroup.simTime}
              onChange={(e) => handleSimTimeChange(e.target.value)}
            />
          </div>
        </section>

        <section className="group-panel__section">
          <div className="group-panel__section-header">
            <h3 className="group-panel__subtitle">My flights</h3>
            <button
              type="button"
              className="group-panel__btn group-panel__btn--primary"
              onClick={handleSaveFlights}
              disabled={saving || loadingFlights}
            >
              {saving ? "Saving…" : dirty ? "Save flights" : "Saved"}
            </button>
          </div>

          {otherFlightCount > 0 && (
            <p className="group-panel__hint group-panel__hint--inline">
              Other members have {otherFlightCount} saved flight
              {otherFlightCount === 1 ? "" : "s"} in this group.
            </p>
          )}
        </section>

        {loadingFlights ? (
          <p className="group-panel__hint group-panel__hint--inline">
            Loading flights…
          </p>
        ) : (
          <FlightScheduleTable
            flights={flightRows}
            onChange={handleFlightRowsChange}
            errors={errors}
          />
        )}
      </>
    );
  };

  return (
    <aside className={`flight-panel group-panel ${open ? "flight-panel--open" : ""}`}>
      <button
        type="button"
        className="flight-panel__tab"
        onClick={onToggleOpen}
        aria-expanded={open}
        title={open ? "Collapse panel" : "Expand panel"}
      >
        Groups
      </button>

      <div className="flight-panel__body">
        <header className="flight-panel__header">
          <h2>Groups</h2>
          <p className="flight-panel__hint">
            Each group is one shared trip. Add your flights, save, then Run
            to animate the whole group.
          </p>
        </header>

        {!user ? renderSignedOut() : (
          <>
            {renderGroupPicker()}
            {selectedGroupId ? renderActiveGroup() : groups.length === 0 && (
              <div className="group-panel__empty">
                <p>Create a group or join with a code to get started.</p>
              </div>
            )}
          </>
        )}

        {statusMessage && (
          <p className="group-panel__status">{statusMessage}</p>
        )}
        {panelError && (
          <p className="group-panel__error">{panelError}</p>
        )}
      </div>
    </aside>
  );
}
