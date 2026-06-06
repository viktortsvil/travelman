/** Format Postgres `time` / time string for HTML inputs (HH:MM). */
export function formatTimeForInput(value) {
  if (!value) return "";
  return String(value).slice(0, 5);
}

/** Format Postgres `date` / date string for HTML inputs (YYYY-MM-DD). */
export function formatDateForInput(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

/** @param {object} row DB flight_rows row */
export function dbRowToFlightRow(row) {
  return {
    id: row.id,
    userId: row.user_id ?? null,
    fromLocation: row.from_location ?? "",
    fromDate: formatDateForInput(row.from_date),
    fromTime: formatTimeForInput(row.from_time),
    toLocation: row.to_location ?? "",
    toDate: formatDateForInput(row.to_date),
    toTime: formatTimeForInput(row.to_time),
  };
}

/** @param {object} row UI flight row */
export function flightRowToDbRow(row, groupId, userId, sortOrder) {
  return {
    id: row.id,
    group_id: groupId,
    user_id: userId,
    sort_order: sortOrder,
    from_location: row.fromLocation ?? "",
    from_date: row.fromDate || null,
    from_time: row.fromTime || null,
    to_location: row.toLocation ?? "",
    to_date: row.toDate || null,
    to_time: row.toTime || null,
  };
}

/** @param {object} group DB groups row */
export function dbGroupToUi(group) {
  return {
    id: group.id,
    name: group.name,
    joinCode: group.join_code,
    simDate: formatDateForInput(group.sim_date),
    simTime: formatTimeForInput(group.sim_time),
    createdBy: group.created_by,
  };
}
