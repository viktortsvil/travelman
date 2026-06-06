import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import {
  createGroup,
  fetchGroup,
  fetchGroupFlightSummary,
  fetchGroupMembers,
  fetchMyFlightRowsForGroup,
  fetchMyGroups,
  joinGroupByCode,
  saveMyFlightsForGroup,
  syncGroupTripStartFromFlights,
} from "../services/groupService.js";
import { dbGroupToUi } from "../utils/tripMappers.js";
import { createEmptyFlightRow } from "../utils/flightUtils.js";
import { formatDateForDisplay } from "../utils/timeUtils.js";
import FlightScheduleTable from "./FlightScheduleTable.jsx";
import MembersModal from "./MembersModal.jsx";
import "./FlightPanel.css";
import "./GroupPanel.css";
export default function GroupPanel({
  open,
  onToggleOpen,
  errors,
  onGroupChange,
  onGroupSummaryChange,
  onMembersChange,
  tripDate,
  tripTime,
}) {
  const { user, configured, signInWithGoogle } = useAuth();

  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [activeGroup, setActiveGroup] = useState(null);

  const [flightRows, setFlightRows] = useState([createEmptyFlightRow()]);
  const [dirty, setDirty] = useState(false);
  const [memberCount, setMemberCount] = useState(0);
  const [totalFlights, setTotalFlights] = useState(0);
  const [members, setMembers] = useState([]);
  const [showMembersModal, setShowMembersModal] = useState(false);

  const [newGroupName, setNewGroupName] = useState("");
  const [joinGroupName, setJoinGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [panelError, setPanelError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingFlights, setLoadingFlights] = useState(false);
  const [saving, setSaving] = useState(false);

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
        setMembers([]);
        onGroupSummaryChange?.(0, 0);
        onMembersChange?.(new Map(), new Map());
        return;
      }

      setLoadingFlights(true);

      const [
        { rows, error: rowsError },
        { memberCount: membersTotal, totalFlights: flights, error: summaryError },
        { members: memberList, error: membersError },
      ] = await Promise.all([
        fetchMyFlightRowsForGroup(groupId, user.id),
        fetchGroupFlightSummary(groupId),
        fetchGroupMembers(groupId),
      ]);

      setLoadingFlights(false);

      if (rowsError || summaryError || membersError) {
        setPanelError(
          rowsError?.message ??
          summaryError?.message ??
          membersError?.message ??
          "Failed to load trip",
        );
        return;
      }

      setFlightRows(rows.length > 0 ? rows : [createEmptyFlightRow()]);
      setDirty(false);
      setMemberCount(membersTotal);
      setTotalFlights(flights);
      setMembers(
        memberList.map((member) => ({
          ...member,
          isYou: member.userId === user.id,
        })),
      );
      onGroupSummaryChange?.(membersTotal, flights);

      const nameMap = new Map(
        memberList.map((member) => [member.userId, member.displayName]),
      );
      const avatarMap = new Map(
        memberList.map((member) => [member.userId, member.avatarUrl]),
      );
      onMembersChange?.(nameMap, avatarMap);

      const { group, error: groupError } = await fetchGroup(groupId);
      if (!groupError && group) {
        const uiGroup = dbGroupToUi(group);
        setActiveGroup(uiGroup);
        onGroupChange?.(uiGroup);
      }
    },
    [user, onGroupChange, onGroupSummaryChange, onMembersChange],
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
        setPanelError(error?.message ?? "Trip not found");
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
      setPanelError("Enter a trip name.");
      return;
    }

    setPanelError("");
    const { group, error } = await createGroup(name);
    if (error) {
      setPanelError(error.message);
      return;
    }

    setNewGroupName("");
    setStatusMessage(
      `Created "${group.name}". Share the trip name and code ${group.join_code}.`,
    );
    await refreshGroups();
    setSelectedGroupId(group.id);
  };

  const handleJoinGroup = async () => {
    const name = joinGroupName.trim();
    const code = joinCode.trim();
    if (!name) {
      setPanelError("Enter the trip name.");
      return;
    }
    if (!code) {
      setPanelError("Enter the join code.");
      return;
    }

    setPanelError("");
    const { groupId, error } = await joinGroupByCode(name, code);
    if (error) {
      setPanelError(error.message);
      return;
    }

    setJoinGroupName("");
    setJoinCode("");
    setStatusMessage("Joined trip.");
    await refreshGroups();
    setSelectedGroupId(groupId);
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

    const { error: syncError } = await syncGroupTripStartFromFlights(activeGroup.id);
    if (syncError) {
      setPanelError(syncError.message);
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
      <p>Sign in to create or join a trip and add your flights.</p>
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
          Add Supabase env vars to enable trips.
        </p>
      )}
    </div>
  );

  const renderGroupSetup = () => (
    <section className="group-panel__section">
      <p className="group-panel__step-intro">
        Pick an existing trip, start a new one, or join friends with their trip name and code.
      </p>

      <div className="group-panel__section--list">

        <div className="group-panel__card">
          <h3 className="group-panel__card-title">Create a trip</h3>
          <p className="group-panel__card-hint">
            Start a new shared trip and share the join code with others.
          </p>
          <div className="group-panel__row group-panel__row--split">
            <input
              type="text"
              className="group-panel__input"
              placeholder="e.g. Mexico 2026"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
            />
            <button
              type="button"
              className="group-panel__btn group-panel__btn--primary"
              onClick={handleCreateGroup}
            >
              Create trip
            </button>
          </div>
        </div>

        <div className="group-panel__card">
          <h3 className="group-panel__card-title">Select a trip</h3>
          <p className="group-panel__card-hint">
            Choose one of your trips to view and edit your flights.
          </p>
          <select
            id="trip-select"
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
              <option value="">No trips yet — create or join below</option>
            ) : (
              groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="group-panel__card">
          <h3 className="group-panel__card-title">Join a trip</h3>
          <p className="group-panel__card-hint">
            Enter the exact trip name and join code from a friend.
          </p>
          <div className="group-panel__join-fields">
            <input
              type="text"
              className="group-panel__input"
              placeholder="Trip name"
              value={joinGroupName}
              onChange={(e) => setJoinGroupName(e.target.value)}
            />
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
                Join trip
              </button>
            </div>
          </div>
        </div>

      </div>
    </section>
  );

  const renderActiveGroup = () => {
    if (!activeGroup) return null;

    return (
      <>
        <section className="group-panel__section">
          <div className="group-panel__meta">
            <div>
              <header className="group-panel__header">
                <h2>Current trip info</h2>
              </header>
              <p className="group-panel__hint">Trip name: {activeGroup.name}</p>

              <p className="group-panel__hint">
                Join code:{" "}
                <strong className="group-panel__code">{activeGroup.joinCode}</strong>
              </p>
              <p className="group-panel__hint">
                <a onClick={() => setShowMembersModal(true)} className="group-panel__link">
                  {memberCount} traveler{memberCount === 1 ? "" : "s"},{" "}
                  {totalFlights} flight{totalFlights === 1 ? "" : "s"} total.
                </a>
              </p>
              <p className="group-panel__hint">
                Trip start (UTC): {tripDate && tripTime
                  ? `${formatDateForDisplay(tripDate)} ${tripTime} UTC`
                  : "Save flights to set automatically"}
              </p>
            </div>
          </div>
        </section>

        <section className="group-panel__section">
          <header className="group-panel__header">
            <h2>My flights</h2>
          </header>
          <p className="group-panel__hint group-panel__hint--inline">
            Each row is a flight. All dates and times are in airport's local timezone.
          </p>
        </section>

        {loadingFlights ? (
          <p className="group-panel__hint group-panel__hint--inline">
            Loading flights…
          </p>
        ) : (
          <FlightScheduleTable
            flights={flightRows}
            onChange={handleFlightRowsChange}
            onSave={handleSaveFlights}
            saving={saving}
            loadingFlights={loadingFlights}
            dirty={dirty}
            errors={errors}
          />
        )}
      </>
    );
  };

  return (
    <>
      <aside className={`flight-panel group-panel ${open ? "flight-panel--open" : ""}`}>
        <button
          type="button"
          className="flight-panel__tab"
          onClick={onToggleOpen}
          aria-expanded={open}
          title={open ? "Collapse panel" : "Expand panel"}
        >
          Trips
        </button>

        <div className="flight-panel__body">
            <header className="flight-panel__header">
              <h2>Trips</h2>
              <button
                type="button"
                className="group-panel__btn"
                onClick={onToggleOpen}
              >
                Back
              </button>
            </header>

          {!user ? renderSignedOut() : (
            <>
              {renderGroupSetup()}
              {selectedGroupId ? renderActiveGroup() : groups.length === 0 && (
                <div className="group-panel__empty">
                  <p>Create a trip or join with a code to get started.</p>
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

      <MembersModal
        open={showMembersModal}
        onClose={() => setShowMembersModal(false)}
        members={members}
      />
    </>
  );
}
