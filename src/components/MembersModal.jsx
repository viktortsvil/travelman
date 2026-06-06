import "./MembersModal.css";
/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {Function} props.onClose
 * @param {{ userId: string, displayName: string, flightCount: number, isYou?: boolean }[]} props.members
 */
export default function MembersModal({ open, onClose, members }) {
  if (!open) return null;

  return (
    <div className="members-modal__backdrop" onClick={onClose}>
      <div
        className="members-modal"
        role="dialog"
        aria-labelledby="members-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="members-modal__header">
          <h3 id="members-modal-title">Trip travelers</h3>
          <button
            type="button"
            className="members-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {members.length === 0 ? (
          <p className="members-modal__empty">No travelers yet.</p>
        ) : (
          <ul className="members-modal__list">
            {members.map((member) => (
              <li key={member.userId}>
                <span className="members-modal__name">
                  {member.displayName}
                  {member.isYou ? " (you)" : ""}
                </span>
                <span className="members-modal__meta">
                  {member.flightCount} flight
                  {member.flightCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
