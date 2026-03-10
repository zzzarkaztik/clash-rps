import { useEffect, useState } from 'react';
import { useGameStore, useAdminStore } from '../state';
import { account, databases, Query, DATABASE_ID, ROOMS_COLLECTION } from '../appwrite';

const LIVE_STATUSES = ['playing', 'p1-ready', 'p2-ready', 'room-ready'];

function statusBadgeClass(status) {
  if (LIVE_STATUSES.includes(status)) return 'playing';
  if (status === 'waiting') return 'waiting';
  if (status === 'admin-ended') return 'admin-ended';
  return 'abandoned';
}

export default function AdminDashboard() {
  const [rooms, setRooms]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const setScreen       = useGameStore((s) => s.setScreen);
  const setSession      = useAdminStore((s) => s.setSession);
  const stopSpectating  = useAdminStore((s) => s.stopSpectating);
  const setPending      = useAdminStore((s) => s.setPendingDelete);
  const setSpectateRoom = useAdminStore((s) => s.setSpectateRoom);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const res = await databases.listDocuments(DATABASE_ID, ROOMS_COLLECTION, [
        Query.orderDesc('$createdAt'),
        Query.limit(50),
      ]);
      setRooms(res.documents);
    } catch (e) {
      setError('Error loading rooms: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  const dashRefresh = useAdminStore((s) => s._dashRefresh);
  useEffect(() => { refresh(); }, [dashRefresh]);

  async function adminLogout() {
    try { await account.deleteSession('current'); } catch (_) {}
    setSession(null);
    stopSpectating();
    setScreen('home');
  }

  function openSpectate(roomId) {
    setSpectateRoom(roomId);
    setScreen('admin-spectate');
  }

  function openForceEnd(roomId, code) {
    setPending({ id: roomId, code });
    // Show the dash dialog — it reads from store
    useAdminStore.setState({ _showDashDialog: true });
  }

  return (
    <div id="screen-admin">
      <div className="back-row">
        <button className="btn btn-ghost" onClick={adminLogout}>Logout →</button>
        <span className="text-muted">Admin Dashboard</span>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Active Rooms</div>
          <button className="btn btn-ghost" style={{ width: 'auto' }} onClick={refresh}>
            ↻ Refresh
          </button>
        </div>

        {loading && (
          <div id="admin-status" className="status-bar" style={{ display: 'flex' }}>
            <div className="status-dot waiting" /><span>Loading rooms...</span>
          </div>
        )}

        {error && <div className="message error">{error}</div>}

        {!loading && rooms.length === 0 && (
          <div className="admin-empty">No active rooms found.</div>
        )}

        <div id="admin-rooms-list">
          {rooms.map((room) => {
            const p1         = room.player1 || '—';
            const p2         = room.player2 || 'Waiting...';
            const badgeClass = statusBadgeClass(room.status);
            const canSpectate = room.status === 'playing';
            const canReview   = room.status === 'abandoned' || room.status === 'admin-ended';

            return (
              <div className="admin-room-row" key={room.$id}>
                <div className="admin-room-code">{room.code}</div>
                <div className="admin-room-info">
                  <strong>{p1}</strong> vs <strong>{p2}</strong><br />
                  Round {room.round || 1} &nbsp;·&nbsp; Score {room.score1 ?? 0}–{room.score2 ?? 0}
                </div>
                <div className={`admin-room-status ${badgeClass}`}>{room.status}</div>
                <div className="admin-room-actions">
                  {canSpectate && (
                    <button className="btn btn-secondary btn-sm" onClick={() => openSpectate(room.$id)}>
                      👁 Watch
                    </button>
                  )}
                  {canReview && (
                    <button className="btn btn-ghost btn-sm" onClick={() => openSpectate(room.$id)}>
                      📋 Review
                    </button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => openForceEnd(room.$id, room.code)}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
