import { useState } from 'react';
import { useGameStore, useSpectatorStore } from '../state';
import { databases, Query, DATABASE_ID, ROOMS_COLLECTION } from '../appwrite';

function extractCodeFromPaste(e, setter) {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text').trim();
  const match = text.match(/[A-Z0-9]{4}(?=[^A-Z0-9]|$)/i);
  if (match) { setter(match[0].toUpperCase()); return; }
  setter(text.replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase());
}

export default function SpectateJoin() {
  const [code, setCode]   = useState('');
  const [error, setError] = useState('');

  const setScreen      = useGameStore((s) => s.setScreen);
  const setRoomId      = useSpectatorStore((s) => s.setRoomId);
  const setRoomDoc     = useSpectatorStore((s) => s.setRoomDoc);
  const setCurrentRound = useSpectatorStore((s) => s.setCurrentRound);
  const setRoundResolved = useSpectatorStore((s) => s.setRoundResolved);

  async function joinAsSpectator() {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 4) { setError('Enter a 4-character room code.'); return; }

    try {
      const res = await databases.listDocuments(DATABASE_ID, ROOMS_COLLECTION, [Query.equal('code', trimmed)]);
      if (!res.documents.length) { setError('Room not found. Check the code!'); return; }

      const room = res.documents[0];
      if (room.status !== 'playing') {
        setError(room.status === 'waiting' ? "Game hasn't started yet." : 'That game has ended.');
        return;
      }

      setRoomId(room.$id);
      setRoomDoc(room);
      setCurrentRound(room.round || 1);
      setRoundResolved(false);
      setScreen('public-spectate');
    } catch (e) {
      setError('Error: ' + (e.message || e));
    }
  }

  return (
    <div id="screen-spectate-join">
      <div className="back-row">
        <button className="btn btn-ghost" onClick={() => setScreen('home')}>← Back</button>
      </div>

      <div className="card">
        <div className="card-title">Watch a Game</div>
        <p className="text-muted" style={{ marginBottom: '1rem' }}>
          Enter a room code to spectate a live game.
        </p>

        <div className="field">
          <label>Room Code</label>
          <input
            type="text"
            placeholder="e.g. XK9A"
            maxLength={4}
            style={{ textTransform: 'uppercase', letterSpacing: '0.3em', fontSize: '1.2rem' }}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && joinAsSpectator()}
            onPaste={(e) => extractCodeFromPaste(e, setCode)}
          />
        </div>

        {error && <div className="message error">{error}</div>}

        <button className="btn btn-secondary" onClick={joinAsSpectator}>
          👁 Watch Game
        </button>
      </div>
    </div>
  );
}
