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
} from "../services/groupService.js";
import { dbGroupToUi } from "../utils/tripMappers.js";
import { createEmptyFlightRow } from "../utils/flightUtils.js";
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
  onTripDateChange,
  onTripTimeChange,
  tripStartLocked = false,
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
        onMembersChange?.(new Map());
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
          "Failed to load group",
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
      onMembersChange?.(nameMap);
    },
    [user, onGroupSummaryChange, onMembersChange],
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
    setStatusMessage(
      `Created "${group.name}". Share the group name and code ${group.join_code}.`,
    );
    await refreshGroups();
    setSelectedGroupId(group.id);
  };

  const handleJoinGroup = async () => {
    const name = joinGroupName.trim();
    const code = joinCode.trim();
    if (!name) {
      setPanelError("Enter the group name.");
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
    setStatusMessage("Joined group.");
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
      <p>Sign in to create or join a group and add your flights.</p>
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

  const renderGroupSetup = () => (
    <section className="group-panel__section">
      <p className="group-panel__step-intro">
        Pick an existing group, start a new one, or join friends with their group name and code.
      </p>

      <div className="group-panel__section--list">

        <div className="group-panel__card">
          <h3 className="group-panel__card-title">1. Select a group</h3>
          <p className="group-panel__card-hint">
            Choose one of your groups to view and edit your flights.
          </p>
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
              <option value="">No groups yet — create or join below</option>
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
          <h3 className="group-panel__card-title">2. Create a group</h3>
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
              Create group
            </button>
          </div>
        </div>

        <div className="group-panel__card">
          <h3 className="group-panel__card-title">3. Join a group</h3>
          <p className="group-panel__card-hint">
          </p>
          <div className="group-panel__join-fields">
            <input
              type="text"
              className="group-panel__input"
              placeholder="Group name"
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
                Join group
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
              <p>
                Join code:{" "}
                <strong className="group-panel__code">{activeGroup.joinCode}</strong>
              </p>
              <p className="group-panel__hint">
                {memberCount} traveler{memberCount === 1 ? "" : "s"},{" "}
                {totalFlights} flight{totalFlights === 1 ? "" : "s"} total.
              </p>
            </div>
            <button
              type="button"
              className="group-panel__btn group-panel__btn--link"
              onClick={() => setShowMembersModal(true)}
            >
              View travelers
            </button>
          </div>

          <div className="group-panel__row group-panel__row--split">
            <label className="group-panel__label" htmlFor="group-trip-date">
              Trip start (UTC)
            </label>
            <input
              id="group-trip-date"
              type="date"
              className="group-panel__input group-panel__input--compact"
              value={tripDate}
              onChange={(e) => onTripDateChange(e.target.value)}
              disabled={tripStartLocked}
              title={
                tripStartLocked ? "Pause the trip to change start time" : undefined
              }
            />
            <input
              type="time"
              className="group-panel__input group-panel__input--compact"
              value={tripTime}
              onChange={(e) => onTripTimeChange(e.target.value)}
              disabled={tripStartLocked}
              title={
                tripStartLocked ? "Pause the trip to change start time" : undefined
              }
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
          <p className="group-panel__hint group-panel__hint--inline">
            Each row is a flight. If your next departure airport differs from
            where you landed, the map shows you traveling there between flights.
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
          Groups
        </button>

        <div className="flight-panel__body">
          <header className="flight-panel__header">
            <h2>Groups</h2>
            <p className="flight-panel__hint">
              Select, create, or join a group, add your flights, save, then Run
              to watch the whole trip together.
            </p>
          </header>

          {!user ? renderSignedOut() : (
            <>
              {renderGroupSetup()}
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

      <MembersModal
        open={showMembersModal}
        onClose={() => setShowMembersModal(false)}
        members={members}
      />
    </>
  );
}
