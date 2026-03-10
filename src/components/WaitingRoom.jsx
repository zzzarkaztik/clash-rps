import { useEffect, useState, useCallback } from 'react';
import { useGameStore } from '../state';
import { client, databases, DATABASE_ID, ROOMS_COLLECTION } from '../appwrite';

export default function WaitingRoom() {
  const { roomCode, roomDocId, isPlayer1, playerName, playerId, sessionId } = useGameStore();
  const setScreen      = useGameStore((s) => s.setScreen);
  const setOpponent    = useGameStore((s) => s.setOpponent);
  const setCurrentRound = useGameStore((s) => s.setCurrentRound);
  const setWaitingUnsub = useGameStore((s) => s.setWaitingUnsub);
  const waitingUnsub   = useGameStore((s) => s.waitingUnsub);
  const resetGame      = useGameStore((s) => s.resetGame);

  const [room, setRoom]       = useState(null);
  const [error, setError]     = useState('');
  const [copyHint, setCopyHint] = useState('click to copy');

  const handleRoomPayload = useCallback((payload) => {
    if (!payload) return;
    setRoom(payload);
    if (payload.status === 'playing') {
      useGameStore.setState({
        opponentName: isPlayer1 ? payload.player2 : payload.player1,
        opponentId:   isPlayer1 ? payload.player2id || '' : payload.player1id || '',
        currentRound: payload.round || 1,
      });
      setScreen('game');
    }
  }, [isPlayer1, setScreen]);

  useEffect(() => {
    // Subscribe to room doc changes
    const unsub = client.subscribe(
      `databases.${DATABASE_ID}.collections.${ROOMS_COLLECTION}.documents.${roomDocId}`,
      ({ payload }) => handleRoomPayload(payload)
    );
    useGameStore.setState({ waitingUnsub: unsub });

    // Also fetch immediately in case we missed a transition
    databases.getDocument(DATABASE_ID, ROOMS_COLLECTION, roomDocId)
      .then((doc) => handleRoomPayload(doc))
      .catch(console.error);

    return () => { unsub(); };
  }, [roomDocId, handleRoomPayload]);

  async function startGame() {
    try {
      await databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, roomDocId, { status: 'playing' });
    } catch (e) {
      setError('Could not start game: ' + e.message);
    }
  }

  async function leaveRoom() {
    resetGame();
    try {
      await databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, roomDocId, { status: 'abandoned' });
    } catch (_) {}
    setScreen('lobby');
  }

  function copyRoomCode() {
    const link = `https://zzzarkaztik.github.io/clash-rps/${roomCode}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopyHint('copied! ✓');
      setTimeout(() => setCopyHint('click to copy'), 1500);
    });
  }

  const p1name  = room ? room.player1 : isPlayer1 ? playerName : '';
  const p2name  = room ? room.player2 : !isPlayer1 ? playerName : '';
  const hasP2   = !!p2name;

  return (
    <div id="screen-waiting">
      <div className="back-row">
        <button className="btn btn-ghost" onClick={leaveRoom}>← Leave</button>
      </div>

      <div className="card">
        <div className="card-title">Waiting Room</div>

        <div className="room-code-display" onClick={copyRoomCode}>
          <div className="room-code-label">Room Code</div>
          <div className="room-code-value">{roomCode}</div>
          <div className="copy-hint">{copyHint}</div>
        </div>

        <div className="players-list">
          <div className={`player-slot ${isPlayer1 ? 'you' : 'filled'}`}>
            <div className="player-avatar">🧑</div>
            <div className="player-name">{p1name || '—'}</div>
            <div className={`player-badge ${isPlayer1 ? '' : 'ready'}`}>{isPlayer1 ? 'YOU' : 'HOST'}</div>
          </div>
          <div className={`player-slot ${hasP2 ? (isPlayer1 ? 'filled' : 'you') : ''}`}>
            <div className="player-avatar">{hasP2 ? '🧑' : '⏳'}</div>
            <div className="player-name">{p2name || 'Waiting...'}</div>
            {hasP2 && <div className={`player-badge ${!isPlayer1 ? '' : 'ready'}`}>{!isPlayer1 ? 'YOU' : 'GUEST'}</div>}
          </div>
        </div>

        <div id="waiting-status" className="status-bar">
          {hasP2 ? (
            isPlayer1
              ? <><div className="status-dot live" /><span>Both players ready!</span></>
              : <><div className="status-dot waiting" /><span>Waiting for host to start...</span></>
          ) : (
            <><div className="status-dot waiting" /><span>Waiting for opponent to join...</span></>
          )}
        </div>

        {error && <div className="message error">{error}</div>}

        {hasP2 && isPlayer1 && (
          <button className="btn btn-primary" onClick={startGame}>Start Game ⚔️</button>
        )}
      </div>
    </div>
  );
}
