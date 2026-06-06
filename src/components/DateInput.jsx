import { useEffect, useRef, useState } from "react";
import { formatDateForDisplay, parseDateInput } from "../utils/timeUtils.js";
import "./DateInput.css";

/**
 * Date field that stores YYYY-MM-DD, displays e.g. "Jan 1, 1970",
 * accepts typed dates, and still opens the native picker from the calendar button.
 */
export default function DateInput({
  value,
  onChange,
  placeholder = "Jan 1, 2026",
  disabled = false,
}) {
  const nativeRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() =>
    value ? formatDateForDisplay(value) : "",
  );

  useEffect(() => {
    if (!focused) {
      setText(value ? formatDateForDisplay(value) : "");
    }
  }, [value, focused]);

  const commitText = () => {
    const parsed = parseDateInput(text);
    if (parsed === "") {
      onChange("");
      setText("");
      return true;
    }
    if (parsed) {
      onChange(parsed);
      setText(formatDateForDisplay(parsed));
      return true;
    }
    setText(value ? formatDateForDisplay(value) : "");
    return false;
  };

  const openPicker = () => {
    if (disabled) return;
    const input = nativeRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      input.showPicker();
    } else {
      input.focus();
    }
  };

  return (
    <div className={`date-input ${disabled ? "date-input--disabled" : ""}`}>
      <input
        type="text"
        className="date-input__text"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commitText();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitText();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setText(value ? formatDateForDisplay(value) : "");
            e.currentTarget.blur();
          }
        }}
        aria-label="Date"
      />
      <button
        type="button"
        className="date-input__picker"
        onClick={openPicker}
        title="Open calendar"
        aria-label="Open calendar"
        disabled={disabled}
      >
        <span aria-hidden="true">📅</span>
      </button>
      <input
        ref={nativeRef}
        type="date"
        className="date-input__native"
        value={value}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          onChange(e.target.value);
          setText(
            e.target.value ? formatDateForDisplay(e.target.value) : "",
          );
        }}
      />
    </div>
  );
}
