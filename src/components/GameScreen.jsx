import { useEffect, useRef, useState, useCallback } from 'react';
import { useGameStore } from '../state';
import {
  client, databases, ID, Query,
  DATABASE_ID, ROOMS_COLLECTION, MOVES_COLLECTION,
  ROUND_COUNTDOWN_SECS, EMOJI, BEATS, LOSES_TO,
} from '../appwrite';

// ─── Status bar component ─────────────────────────────────────
function StatusBar({ status }) {
  return (
    <div
      id="game-status"
      className={`status-bar${status.abandoned ? ' status-abandoned' : ''}`}
    >
      <div className={`status-dot ${status.dot}`} />
      <span dangerouslySetInnerHTML={{ __html: status.text }} />
      {status.readyBtn && (
        <button className="btn-ready-round" onClick={status.readyBtn.onClick} id="btn-ready">
          ✓ Ready
        </button>
      )}
    </div>
  );
}

export default function GameScreen() {
  const {
    playerName, playerId, sessionId,
    roomDocId, isPlayer1,
    currentRound, opponentName, opponentId,
    score, myChoice,
    roundResolved, iReadyForRound,
  } = useGameStore();

  const setScreen        = useGameStore((s) => s.setScreen);
  const setMyChoice      = useGameStore((s) => s.setMyChoice);
  const setScore         = useGameStore((s) => s.setScore);
  const setCurrentRound  = useGameStore((s) => s.setCurrentRound);
  const setRoundResolved = useGameStore((s) => s.setRoundResolved);
  const setIReady        = useGameStore((s) => s.setIReadyForRound);
  const resetGame        = useGameStore((s) => s.resetGame);

  // Local display state
  const [oppChoice, setOppChoice]   = useState(null); // revealed after both pick
  const [phase, setPhase]           = useState('choose'); // 'choose' | 'waiting-confirm' | 'result'
  const [result, setResult]         = useState(null);     // { outcome, myC, oppC }
  const [statusBar, setStatusBar]   = useState({ dot: 'waiting', text: 'Make your choice!' });
  const [countdown, setCountdown]   = useState(ROUND_COUNTDOWN_SECS);
  const [nextBtnState, setNextBtn]  = useState({ disabled: false, text: 'Next Round ▶' });
  const [readyStatusText, setReadyStatusText] = useState('');

  const countdownRef    = useRef(null);
  const countdownStart  = useRef(null);
  const resolvedRef     = useRef(false); // mirrors roundResolved without re-render lag
  const realtimeRef     = useRef(null);
  const roomWatchRef    = useRef(null);
  const pollRef         = useRef(null);

  // ── Countdown ──────────────────────────────────────────────
  const stopCountdown = useCallback(() => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  const startCountdown = useCallback(() => {
    stopCountdown();
    countdownStart.current = Date.now();
    resolvedRef.current = false;

    function tick() {
      if (resolvedRef.current) { stopCountdown(); return; }
      const elapsed    = Math.floor((Date.now() - countdownStart.current) / 1000);
      const remaining  = Math.max(0, ROUND_COUNTDOWN_SECS - elapsed);
      const urgentCls  = remaining <= 3 ? 'urgent' : '';
      setCountdown(remaining);

      const badge = `<span class="countdown-badge ${urgentCls}">${remaining}s</span>`;
      setStatusBar((prev) => {
        if (prev.abandoned) return prev;
        return {
          dot: 'waiting',
          text: useGameStore.getState().myChoice
            ? `Waiting for opponent &nbsp;${badge}`
            : `Make your choice! &nbsp;${badge}`,
        };
      });

      if (remaining <= 0) { stopCountdown(); handleTimeout(); }
    }

    tick();
    countdownRef.current = setInterval(tick, 500);
  }, [stopCountdown]);

  // ── Reset for new round ────────────────────────────────────
  const resetRound = useCallback((startImmediately = false) => {
    resolvedRef.current = false;
    setRoundResolved(false);
    setMyChoice(null);
    setIReady(false);
    setOppChoice(null);
    setResult(null);
    setPhase(startImmediately ? 'choose' : 'waiting-confirm');
    setNextBtn({ disabled: false, text: 'Next Round ▶' });
    setReadyStatusText('');
    stopCountdown();

    if (startImmediately) {
      startCountdown();
      setStatusBar({ dot: 'waiting', text: 'Make your choice!' });
    } else {
      setStatusBar({
        dot: 'waiting',
        text: '<span id="round-ready-text">Waiting for both players...</span>',
        readyBtn: { onClick: handleNextRound },
      });
    }
  }, [startCountdown, stopCountdown]);

  // ── Enter next round after both confirm ────────────────────
  const enterNextRound = useCallback((newRound) => {
    if (newRound <= useGameStore.getState().currentRound) return;
    setCurrentRound(newRound);
    resetRound(true);
    if (isPlayer1) {
      databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, roomDocId, { status: 'playing' }).catch(console.error);
    }
  }, [isPlayer1, roomDocId, resetRound, setCurrentRound]);

  // ── Resolve round ──────────────────────────────────────────
  const resolveRound = useCallback((myC, oppC) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    setRoundResolved(true);
    stopCountdown();
    setIReady(false);
    setNextBtn({ disabled: false, text: 'Next Round ▶' });
    setReadyStatusText('');
    setOppChoice(oppC);

    let outcome;
    const state = useGameStore.getState();
    const newScore = { ...state.score };
    if (myC === oppC) {
      outcome = 'draw';
    } else if (BEATS[myC] === oppC) {
      outcome = 'win';
      newScore.me++;
    } else {
      outcome = 'lose';
      newScore.opp++;
    }
    setScore(newScore);
    setResult({ outcome, myC, oppC });
    setPhase('result');

    if (isPlayer1) {
      databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, roomDocId, {
        score1: newScore.me,
        score2: newScore.opp,
      }).catch(console.error);
    }
  }, [isPlayer1, roomDocId, setRoundResolved, setIReady, setScore, stopCountdown]);

  // ── Check both moves ───────────────────────────────────────
  const checkBothMoves = useCallback(async () => {
    if (resolvedRef.current) return;
    try {
      const state = useGameStore.getState();
      const res = await databases.listDocuments(DATABASE_ID, MOVES_COLLECTION, [
        Query.equal('room', state.roomDocId),
        Query.equal('round', state.currentRound),
      ]);
      if (res.documents.length < 2) return;
      const myMove  = res.documents.find((d) => d.playerId === state.playerId);
      const oppMove = res.documents.find((d) => d.playerId !== state.playerId);
      if (!myMove || !oppMove) return;
      resolveRound(myMove.choice, oppMove.choice);
    } catch (e) { console.error(e); }
  }, [resolveRound]);

  // ── Handle timeout ─────────────────────────────────────────
  const handleTimeout = useCallback(async () => {
    const state = useGameStore.getState();
    if (resolvedRef.current || !state.isPlayer1) return;
    try {
      const res = await databases.listDocuments(DATABASE_ID, MOVES_COLLECTION, [
        Query.equal('room', state.roomDocId),
        Query.equal('round', state.currentRound),
      ]);
      const p1Doc = res.documents.find((d) => d.playerId === state.playerId);
      const p2Doc = res.documents.find((d) => d.playerId !== state.playerId);
      if (p1Doc && p2Doc) return;

      const write = (pid, choice) =>
        databases.createDocument(DATABASE_ID, MOVES_COLLECTION, ID.unique(), {
          room: state.roomDocId, playerId: pid, choice, round: state.currentRound,
        });

      if (!p1Doc && !p2Doc) {
        await write(state.playerId, 'rock');
        if (state.opponentId) await write(state.opponentId, 'rock');
      } else if (p1Doc && !p2Doc) {
        if (state.opponentId) await write(state.opponentId, LOSES_TO[p1Doc.choice]);
      } else if (!p1Doc && p2Doc) {
        await write(state.playerId, LOSES_TO[p2Doc.choice]);
      }
    } catch (e) { console.error('Timeout resolve error:', e); }
  }, []);

  // ── Subscribe to moves + room watch ───────────────────────
  useEffect(() => {
    const state = useGameStore.getState();

    // Moves subscription
    realtimeRef.current = client.subscribe(
      `databases.${DATABASE_ID}.collections.${MOVES_COLLECTION}.documents`,
      async ({ payload }) => {
        if (!payload) return;
        if (payload.room?.$id !== state.roomDocId) return;
        if (payload.round !== useGameStore.getState().currentRound) return;
        await checkBothMoves();
      }
    );

    // Room watch subscription
    roomWatchRef.current = client.subscribe(
      `databases.${DATABASE_ID}.collections.${ROOMS_COLLECTION}.documents.${state.roomDocId}`,
      ({ payload }) => {
        if (!payload) return;
        const cur = useGameStore.getState();

        if (payload.status === 'abandoned') {
          stopCountdown();
          setStatusBar({ dot: 'done', text: `😢 ${cur.opponentName || 'Your opponent'} left the game`, abandoned: true });
          setPhase((p) => p === 'result' ? p : 'abandoned');
          return;
        }
        if (payload.status === 'admin-ended') {
          stopCountdown();
          setStatusBar({ dot: 'done', text: '🛑 An admin has ended this room.', abandoned: true });
          setNextBtn({ disabled: true, text: 'Room Ended' });
          return;
        }

        const oppReadyStatus = cur.isPlayer1 ? 'p2-ready' : 'p1-ready';
        if (payload.status === oppReadyStatus && !cur.iReadyForRound) {
          // Update the text inside the ready banner
          setStatusBar((prev) => ({
            ...prev,
            text: '<span id="round-ready-text">Opponent is ready! Click Ready ✓</span>',
          }));
        }

        if (payload.status === 'room-ready') {
          enterNextRound(payload.round);
        }
      }
    );

    // Fallback poll
    pollRef.current = setInterval(async () => {
      const s = useGameStore.getState();
      if (s.roomCode && s.myChoice && !resolvedRef.current) {
        await checkBothMoves();
      }
    }, 3000);

    // Start round 1 immediately
    resetRound(true);

    return () => {
      if (realtimeRef.current) realtimeRef.current();
      if (roomWatchRef.current) roomWatchRef.current();
      if (pollRef.current) clearInterval(pollRef.current);
      stopCountdown();
    };
  }, []);// eslint-disable-line react-hooks/exhaustive-deps

  // ── Make choice ────────────────────────────────────────────
  async function makeChoice(choice) {
    if (myChoice || phase !== 'choose') return;
    setMyChoice(choice);

    const state = useGameStore.getState();
    try {
      const existing = await databases.listDocuments(DATABASE_ID, MOVES_COLLECTION, [
        Query.equal('room', state.roomDocId),
        Query.equal('playerId', state.playerId),
        Query.equal('round', state.currentRound),
      ]);
      if (existing.documents.length > 0) {
        await databases.updateDocument(DATABASE_ID, MOVES_COLLECTION, existing.documents[0].$id, { choice });
      } else {
        await databases.createDocument(DATABASE_ID, MOVES_COLLECTION, ID.unique(), {
          room: state.roomDocId, playerId: state.playerId, choice, round: state.currentRound,
        });
      }
    } catch (e) { console.error('Move submit error:', e); }
  }

  // ── Next round confirmation ────────────────────────────────
  async function handleNextRound() {
    const state = useGameStore.getState();
    if (state.iReadyForRound) return;
    setIReady(true);
    setNextBtn({ disabled: true, text: 'Waiting...' });

    const myReadyStatus  = state.isPlayer1 ? 'p1-ready' : 'p2-ready';
    const oppReadyStatus = state.isPlayer1 ? 'p2-ready' : 'p1-ready';

    try {
      const room = await databases.getDocument(DATABASE_ID, ROOMS_COLLECTION, state.roomDocId);
      if (room.status === 'room-ready' || room.round > state.currentRound) {
        enterNextRound(room.round); return;
      }
      if (room.status === oppReadyStatus) {
        await databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, state.roomDocId, {
          status: 'room-ready', round: room.round + 1,
        });
        enterNextRound(room.round + 1);
      } else {
        await databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, state.roomDocId, { status: myReadyStatus });
        setReadyStatusText('Waiting for opponent...');
      }
    } catch (e) {
      console.error('nextRound error:', e);
      setIReady(false);
      setNextBtn({ disabled: false, text: 'Next Round ▶' });
    }
  }

  // ── Leave room ─────────────────────────────────────────────
  async function leaveRoom() {
    const state = useGameStore.getState();
    stopCountdown();
    if (realtimeRef.current) realtimeRef.current();
    if (roomWatchRef.current) roomWatchRef.current();
    if (pollRef.current) clearInterval(pollRef.current);
    resetGame();
    try {
      await databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, state.roomDocId, { status: 'abandoned' });
    } catch (_) {}
    setScreen('lobby');
  }

  // ── Result helpers ─────────────────────────────────────────
  const titles = { win: 'YOU WIN!', lose: 'YOU LOSE', draw: 'DRAW!' };
  const subs = result ? {
    win:  `${EMOJI[result.myC]} beats ${EMOJI[result.oppC]}`,
    lose: `${EMOJI[result.oppC]} beats ${EMOJI[result.myC]}`,
    draw: `Both chose ${EMOJI[result.myC]}`,
  } : {};

  const abandoned = phase === 'abandoned' || statusBar.abandoned;

  return (
    <div id="screen-game">
      <div className="back-row">
        <button className="btn btn-ghost" onClick={leaveRoom}>← Leave</button>
        <span className="text-muted">Round {currentRound}</span>
      </div>

      <div className="card">
        {/* Score */}
        <div className="score-row">
          <div className="score-item">
            <div className="score-num">{score.me}</div>
            <div className="score-name">{playerName}</div>
          </div>
          <div className="score-divider">—</div>
          <div className="score-item">
            <div className="score-num">{score.opp}</div>
            <div className="score-name">{opponentName || 'Opponent'}</div>
          </div>
        </div>

        <div className="divider" />

        {/* Arena */}
        <div className="arena">
          <div className="arena-player">
            <div className="arena-choice">{myChoice ? EMOJI[myChoice] : '🤔'}</div>
            <div className="arena-name">You</div>
          </div>
          <div className="arena-vs">VS</div>
          <div className="arena-player">
            <div className={`arena-choice ${oppChoice ? '' : 'hidden'}`}>{oppChoice ? EMOJI[oppChoice] : '❓'}</div>
            <div className="arena-name">{opponentName || 'Opponent'}</div>
          </div>
        </div>

        {/* Choice section */}
        {phase !== 'result' && (
          <div id="choice-section">
            <div
              id="game-status"
              className={`status-bar${abandoned ? ' status-abandoned' : ''}`}
            >
              <div className={`status-dot ${statusBar.dot}`} />
              <span dangerouslySetInnerHTML={{ __html: statusBar.text }} />
              {statusBar.readyBtn && phase === 'waiting-confirm' && (
                <button className="btn-ready-round" onClick={statusBar.readyBtn.onClick} id="btn-ready">
                  ✓ Ready
                </button>
              )}
            </div>

            <div className="choices">
              {['rock', 'paper', 'scissors'].map((c) => (
                <button
                  key={c}
                  className={`choice-btn${myChoice === c ? ' selected' : ''}`}
                  data-choice={c}
                  disabled={!!myChoice || phase !== 'choose' || abandoned}
                  onClick={() => makeChoice(c)}
                >
                  <span className="choice-emoji">{EMOJI[c]}</span>
                  <span>{c.charAt(0).toUpperCase() + c.slice(1)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Result section */}
        {phase === 'result' && result && (
          <div id="result-section">
            <div className={`result-display ${result.outcome}`}>
              <div className="result-title">{titles[result.outcome]}</div>
              <div className="result-sub">{subs[result.outcome]}</div>
            </div>
            <div className="gap-row mt-2">
              <button
                className="btn btn-primary"
                id="result-next-btn"
                disabled={nextBtnState.disabled}
                onClick={handleNextRound}
              >
                {nextBtnState.text}
              </button>
            </div>
            {readyStatusText && (
              <div id="result-ready-status" className="text-center text-muted mt-1" style={{ fontSize: '0.7rem' }}>
                {readyStatusText}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
