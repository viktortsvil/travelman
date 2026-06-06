import { createEmptyFlightRow } from "../utils/flightUtils.js";
import AirportInput from "./AirportInput.jsx";
import DateInput from "./DateInput.jsx";

/**
 * Editable flight schedule table (origin/destination + local times).
 */
export default function FlightScheduleTable({
  flights,
  onChange,
  onSave,
  saving = false,
  loadingFlights = false,
  dirty = false,
  errors,
}) {
  const updateRow = (id, field, value) => {
    onChange(
      flights.map((row) =>
        row.id === id ? { ...row, [field]: value } : row,
      ),
    );
  };

  const addRow = () => {
    onChange([...flights, createEmptyFlightRow()]);
  };

  const removeRow = (id) => {
    if (flights.length <= 1) return;
    onChange(flights.filter((row) => row.id !== id));
  };

  return (
    <>
      <div className="flight-panel__table-wrap">
        <table className="flight-panel__table">
          <thead>
            <tr>
              <th>From</th>
              <th>Depart date</th>
              <th>Depart time</th>
              <th>To</th>
              <th>Arrive date</th>
              <th>Arrive time</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {flights.map((row) => (
              <tr key={row.id}>
                <td>
                  <AirportInput
                    placeholder="SFO"
                    value={row.fromLocation}
                    onChange={(value) =>
                      updateRow(row.id, "fromLocation", value)
                    }
                  />
                </td>
                <td>
                  <DateInput
                    value={row.fromDate}
                    onChange={(value) => updateRow(row.id, "fromDate", value)}
                  />
                </td>
                <td>
                  <input
                    type="time"
                    value={row.fromTime}
                    onChange={(e) =>
                      updateRow(row.id, "fromTime", e.target.value)
                    }
                  />
                </td>
                <td>
                  <AirportInput
                    placeholder="JFK"
                    value={row.toLocation}
                    onChange={(value) =>
                      updateRow(row.id, "toLocation", value)
                    }
                  />
                </td>
                <td>
                  <DateInput
                    value={row.toDate}
                    onChange={(value) => updateRow(row.id, "toDate", value)}
                  />
                </td>
                <td>
                  <input
                    type="time"
                    value={row.toTime}
                    onChange={(e) =>
                      updateRow(row.id, "toTime", e.target.value)
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="flight-panel__remove"
                    onClick={() => removeRow(row.id)}
                    disabled={flights.length <= 1}
                    title="Remove row"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flight-panel__bottom-controls">
          <button type="button" className="flight-panel__add" onClick={addRow}>
            + Add flight
          </button>
          <button
            type="button"
            className="group-panel__btn group-panel__btn--primary"
            onClick={onSave}
            disabled={saving || loadingFlights}
          >
            {saving ? "Saving…" : dirty ? "Save flights" : "Saved"}
          </button>
        </div>
      </div>



      {errors.length > 0 && (
        <ul className="flight-panel__errors">
          {errors.map((msg) => (
            <li key={msg}>{msg}</li>
          ))}
        </ul>
      )}
    </>
  );
}
