import { supabase } from "../lib/supabase.js";
import { dbRowToFlightRow, flightRowToDbRow } from "../utils/tripMappers.js";

function requireClient() {
  if (!supabase) {
    throw new Error("Supabase is not configured");
  }
  return supabase;
}

/** @returns {Promise<{ groups: object[], error: Error | null }>} */
export async function fetchMyGroups() {
  const client = requireClient();
  const { data, error } = await client
    .from("groups")
    .select("*")
    .order("name");

  return { groups: data ?? [], error };
}

/** @returns {Promise<{ group: object | null, error: Error | null }>} */
export async function createGroup(name) {
  const client = requireClient();
  const { data, error } = await client.rpc("create_group", {
    p_name: name,
  });

  return { group: data, error };
}

/** @returns {Promise<{ groupId: string | null, error: Error | null }>} */
export async function joinGroupByCode(code) {
  const client = requireClient();
  const { data, error } = await client.rpc("join_group_by_code", {
    p_code: code,
  });

  return { groupId: data, error };
}

/** @returns {Promise<{ group: object | null, error: Error | null }>} */
export async function fetchGroup(groupId) {
  const client = requireClient();
  const { data, error } = await client
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();

  return { group: data, error };
}

/** @returns {Promise<{ error: Error | null }>} */
export async function updateGroupSimSettings(groupId, simDate, simTime) {
  const client = requireClient();
  const { error } = await client
    .from("groups")
    .update({
      sim_date: simDate,
      sim_time: simTime,
    })
    .eq("id", groupId);

  return { error };
}

/** @returns {Promise<{ rows: object[], error: Error | null }>} */
export async function fetchMyFlightRowsForGroup(groupId, userId) {
  const client = requireClient();
  const { data, error } = await client
    .from("flight_rows")
    .select("*")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .order("sort_order");

  return { rows: (data ?? []).map(dbRowToFlightRow), error };
}

/** @returns {Promise<{ rows: object[], error: Error | null }>} */
export async function fetchAllFlightRowsForGroup(groupId) {
  const client = requireClient();
  const { data, error } = await client
    .from("flight_rows")
    .select("*")
    .eq("group_id", groupId)
    .order("sort_order");

  return { rows: (data ?? []).map(dbRowToFlightRow), error };
}

/** @returns {Promise<{ error: Error | null }>} */
export async function saveMyFlightsForGroup(groupId, userId, rows) {
  const client = requireClient();

  const { error: deleteError } = await client
    .from("flight_rows")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);

  if (deleteError) return { error: deleteError };

  const payload = rows.map((row, index) =>
    flightRowToDbRow(row, groupId, userId, index),
  );

  if (payload.length === 0) {
    return { error: null };
  }

  const { error: insertError } = await client
    .from("flight_rows")
    .insert(payload);

  return { error: insertError };
}

/**
 * @returns {Promise<{
 *   memberCount: number,
 *   totalFlights: number,
 *   flightsByUser: Map<string, number>,
 *   error: Error | null
 * }>}
 */
export async function fetchGroupFlightSummary(groupId) {
  const client = requireClient();

  const [{ count: memberCount, error: membersError }, { data, error: rowsError }] =
    await Promise.all([
      client
        .from("group_members")
        .select("*", { count: "exact", head: true })
        .eq("group_id", groupId),
      client.from("flight_rows").select("user_id").eq("group_id", groupId),
    ]);

  if (membersError) {
    return {
      memberCount: 0,
      totalFlights: 0,
      flightsByUser: new Map(),
      error: membersError,
    };
  }

  if (rowsError) {
    return {
      memberCount: memberCount ?? 0,
      totalFlights: 0,
      flightsByUser: new Map(),
      error: rowsError,
    };
  }

  const flightsByUser = new Map();
  for (const row of data ?? []) {
    flightsByUser.set(
      row.user_id,
      (flightsByUser.get(row.user_id) ?? 0) + 1,
    );
  }

  return {
    memberCount: memberCount ?? 0,
    totalFlights: data?.length ?? 0,
    flightsByUser,
    error: null,
  };
}
