import { useState, useEffect } from 'react';
import { useGameStore } from '../state';
import { databases, ID, Query, DATABASE_ID, ROOMS_COLLECTION } from '../appwrite';

function extractCodeFromPaste(e, setter) {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text').trim();
  const match = text.match(/[A-Z0-9]{4}(?=[^A-Z0-9]|$)/i);
  if (match) { setter(match[0].toUpperCase()); return; }
  setter(text.replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase());
}

export default function LobbyScreen() {
  const [joinCode, setJoinCode] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const playerName = useGameStore((s) => s.playerName);
  const playerId   = useGameStore((s) => s.playerId);
  const sessionId  = useGameStore((s) => s.sessionId);
  const urlCode    = useGameStore((s) => s.urlCode);
  const setScreen  = useGameStore((s) => s.setScreen);
  const setRoom    = useGameStore((s) => s.setRoom);
  const setScore   = useGameStore((s) => s.setScore);
  const setCurrentRound = useGameStore((s) => s.setCurrentRound);

  // Pre-fill from URL if present
  useEffect(() => {
    if (urlCode) { setJoinCode(urlCode); useGameStore.setState({ urlCode: null }); }
  }, [urlCode]);

  async function createRoom() {
    setLoading(true);
    const code = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4).padEnd(4, 'X');
    try {
      const doc = await databases.createDocument(DATABASE_ID, ROOMS_COLLECTION, ID.unique(), {
        code,
        player1: playerName,
        player1id: playerId,
        player1session: sessionId,
        player2: '',
        player2id: '',
        player2session: '',
        status: 'waiting',
        score1: 0,
        score2: 0,
        round: 1,
      });
      setRoom({ roomCode: code, roomDocId: doc.$id, isPlayer1: true });
      setCurrentRound(1);
      setScore({ me: 0, opp: 0 });
      setScreen('waiting');
    } catch (e) {
      setError('Failed to create room: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 4) { setError('Enter a 4-character room code.'); return; }
    setLoading(true);
    try {
      const res = await databases.listDocuments(DATABASE_ID, ROOMS_COLLECTION, [Query.equal('code', code)]);
      if (!res.documents.length) { setError('Room not found. Check the code!'); setLoading(false); return; }

      const room = res.documents[0];
      if (room.status !== 'waiting') { setError('That game is already in progress.'); setLoading(false); return; }

      // Rejoin as p1
      if (room.player1id === playerId) {
        if (room.player1session && room.player1session !== sessionId) {
          setError('⚠️ You already have this room open in another tab.');
          setLoading(false); return;
        }
        setRoom({ roomCode: code, roomDocId: room.$id, isPlayer1: true });
        setCurrentRound(room.round || 1);
        setScore({ me: room.score1, opp: room.score2 });
        setScreen('waiting');
        return;
      }

      // Rejoin as p2 (same playerId)
      if (room.player2id === playerId) {
        if (room.player2session && room.player2session !== sessionId) {
          setError('⚠️ You already have this room open in another tab.');
          setLoading(false); return;
        }
      } else if (room.player2 && room.player2id !== playerId) {
        setError('Room is full!');
        setLoading(false); return;
      }

      // Name clash
      if (room.player1 && room.player1.trim().toLowerCase() === playerName.trim().toLowerCase()) {
        setError('⚠️ That name is already taken in this room. Choose a different name.');
        setLoading(false); return;
      }

      await databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, room.$id, {
        player2: playerName,
        player2id: playerId,
        player2session: sessionId,
      });

      setRoom({ roomCode: code, roomDocId: room.$id, isPlayer1: false });
      useGameStore.setState({ opponentName: room.player1, opponentId: room.player1id || '' });
      setCurrentRound(room.round || 1);
      setScore({ me: room.score2, opp: room.score1 });
      setScreen('waiting');
    } catch (e) {
      setError('Error: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div id="screen-lobby">
      <div className="back-row">
        <button className="btn btn-ghost" onClick={() => setScreen('home')}>← Back</button>
        <span className="text-muted">Playing as: <strong>{playerName}</strong></span>
      </div>

      <div className="card">
        <div className="card-title">Create Room</div>
        <p className="text-muted" style={{ marginBottom: '1rem' }}>Start a new game and share the code with a friend.</p>
        <button className="btn btn-primary" onClick={createRoom} disabled={loading}>Create New Room</button>
      </div>

      <div className="card">
        <div className="card-title">Join Room</div>
        <div className="field">
          <label>Room Code</label>
          <input
            type="text"
            placeholder="e.g. XK9A"
            maxLength={4}
            style={{ textTransform: 'uppercase', letterSpacing: '0.3em', fontSize: '1.2rem' }}
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
            onPaste={(e) => extractCodeFromPaste(e, setJoinCode)}
          />
        </div>
        <button className="btn btn-secondary" onClick={joinRoom} disabled={loading}>Join Room</button>
      </div>

      {error && <div className="message error">{error}</div>}
    </div>
  );
}
