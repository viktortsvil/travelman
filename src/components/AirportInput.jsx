import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { searchAirports } from "../utils/airportData.js";
import "./AirportInput.css";

/**
 * Text input with airport/city autocomplete for flight table cells.
 */
export default function AirportInput({ value, onChange, placeholder }) {
  const listId = useId();
  const inputRef = useRef(null);
  const blurTimeoutRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [debouncedQuery, setDebouncedQuery] = useState(value);
  const [dropdownStyle, setDropdownStyle] = useState(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(value), 120);
    return () => window.clearTimeout(id);
  }, [value]);

  const suggestions =
    open && debouncedQuery.trim() ? searchAirports(debouncedQuery) : [];

  useEffect(() => {
    setHighlightIndex(suggestions.length > 0 ? 0 : -1);
  }, [debouncedQuery, suggestions.length]);

  useEffect(() => {
    if (!open || !inputRef.current) {
      setDropdownStyle(null);
      return;
    }

    const updatePosition = () => {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + 2,
        left: rect.left,
        width: Math.max(rect.width, 220),
      });
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, suggestions.length, value]);

  useEffect(
    () => () => {
      if (blurTimeoutRef.current) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    },
    [],
  );

  const closeDropdown = () => {
    setOpen(false);
    setHighlightIndex(-1);
  };

  const selectSuggestion = (suggestion) => {
    onChange(suggestion.iata);
    closeDropdown();
    inputRef.current?.focus();
  };

  const handleFocus = () => {
    if (blurTimeoutRef.current) {
      window.clearTimeout(blurTimeoutRef.current);
    }
    if (value.trim()) setOpen(true);
  };

  const handleBlur = () => {
    blurTimeoutRef.current = window.setTimeout(closeDropdown, 150);
  };

  const handleChange = (event) => {
    onChange(event.target.value);
    setOpen(event.target.value.trim().length > 0);
  };

  const handleKeyDown = (event) => {
    if (!open || suggestions.length === 0) {
      if (event.key === "ArrowDown" && value.trim()) setOpen(true);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex(
        (i) => (i - 1 + suggestions.length) % suggestions.length,
      );
    } else if (event.key === "Enter" && highlightIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[highlightIndex]);
    } else if (event.key === "Escape") {
      closeDropdown();
    }
  };

  return (
    <div className="airport-input">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />

      {open &&
        suggestions.length > 0 &&
        dropdownStyle &&
        createPortal(
          <ul
            id={listId}
            role="listbox"
            className="airport-input__dropdown"
            style={dropdownStyle}
          >
            {suggestions.map((suggestion, index) => (
              <li key={suggestion.iata} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlightIndex}
                  className={`airport-input__option${
                    index === highlightIndex
                      ? " airport-input__option--active"
                      : ""
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(suggestion)}
                  onMouseEnter={() => setHighlightIndex(index)}
                >
                  <span className="airport-input__code">{suggestion.iata}</span>
                  <span className="airport-input__detail">
                    {suggestion.municipality || suggestion.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
