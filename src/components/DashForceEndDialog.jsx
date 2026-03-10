import { useAdminStore } from '../state';
import { databases, DATABASE_ID, ROOMS_COLLECTION } from '../appwrite';

export default function DashForceEndDialog() {
  const show            = useAdminStore((s) => s._showDashDialog);
  const pendingId       = useAdminStore((s) => s.pendingDeleteId);
  const pendingCode     = useAdminStore((s) => s.pendingDeleteCode);
  const clearPending    = useAdminStore((s) => s.clearPendingDelete);

  function hide(e) {
    if (e && e.target !== e.currentTarget) return;
    useAdminStore.setState({ _showDashDialog: false });
    clearPending();
  }

  async function confirm() {
    const id = pendingId;
    useAdminStore.setState({ _showDashDialog: false });
    clearPending();
    try {
      await databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, id, {
        status: 'admin-ended',
      });
      // Trigger a dashboard refresh by toggling a refresh counter
      useAdminStore.setState((s) => ({ _dashRefresh: (s._dashRefresh || 0) + 1 }));
    } catch (e) {
      console.error('Failed to end room:', e.message);
    }
  }

  if (!show) return null;

  return (
    <div className="dialog-overlay" onClick={hide}>
      <div className="dialog-box">
        <div className="dialog-header">
          <span className="dialog-title">End room {pendingCode}?</span>
          <button
            className="dialog-close"
            onClick={() => { useAdminStore.setState({ _showDashDialog: false }); clearPending(); }}
          >
            ✕
          </button>
        </div>
        <p className="dialog-body">
          This will immediately end the game for both players and notify them that an admin ended the session.
        </p>
        <div className="dialog-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { useAdminStore.setState({ _showDashDialog: false }); clearPending(); }}
          >
            Cancel
          </button>
          <button className="btn btn-danger btn-sm" onClick={confirm}>
            ⛔ Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
