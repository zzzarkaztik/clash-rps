import { useGameStore, useAdminStore } from '../state';
import { databases, DATABASE_ID, ROOMS_COLLECTION } from '../appwrite';

export default function ForceEndDialog() {
  const spectateRoomId = useAdminStore((s) => s.spectateRoomId);
  const show           = useAdminStore((s) => s._showForceEndDialog);
  const setScreen      = useGameStore((s) => s.setScreen);

  function hide(e) {
    if (e && e.target !== e.currentTarget) return;
    useAdminStore.setState({ _showForceEndDialog: false });
  }

  async function confirm() {
    if (!spectateRoomId) return;
    useAdminStore.setState({ _showForceEndDialog: false });
    try {
      await databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, spectateRoomId, {
        status: 'admin-ended',
      });
      // Go back to dashboard
      useAdminStore.setState({ spectateRoomId: null, spectateUnsub: null, spectateMovesUnsub: null });
      setScreen('admin-dashboard');
    } catch (e) {
      console.error('Force end failed:', e.message);
    }
  }

  if (!show) return null;

  return (
    <div className="dialog-overlay" onClick={hide}>
      <div className="dialog-box">
        <div className="dialog-header">
          <span className="dialog-title">Force End Room?</span>
          <button className="dialog-close" onClick={() => useAdminStore.setState({ _showForceEndDialog: false })}>✕</button>
        </div>
        <p className="dialog-body">
          This will immediately end the game for both players and notify them that an admin ended the session.
        </p>
        <div className="dialog-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => useAdminStore.setState({ _showForceEndDialog: false })}>
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
