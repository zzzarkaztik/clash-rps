import { useEffect, useRef, useState, useCallback } from 'react';
import { useGameStore, useSpectatorStore } from '../state';
import {
  client, databases, Query,
  DATABASE_ID, ROOMS_COLLECTION, MOVES_COLLECTION,
  ROUND_COUNTDOWN_SECS, EMOJI, BEATS,
} from '../appwrite';

function buildRounds(documents, room) {
  const rounds = {};
  documents.forEach((m) => {
    if (!rounds[m.round]) rounds[m.round] = {};
    const isP1 = m.playerId === room.player1id;
    rounds[m.round][isP1 ? 'p1' : 'p2'] = m.choice;
  });
  return rounds;
}

export default function PublicSpectate() {
  const setScreen      = useGameStore((s) => s.setScreen);
  const {
    roomId, roomDoc,
    currentRound, roundResolved,
  } = useSpectatorStore();
  const setRoomDoc        = useSpectatorStore((s) => s.setRoomDoc);
  const setCurrentRound   = useSpectatorStore((s) => s.setCurrentRound);
  const setRoundResolved  = useSpectatorStore((s) => s.setRoundResolved);
  const leave             = useSpectatorStore((s) => s.leave);

  const [liveScore, setLiveScore]       = useState({ s1: roomDoc?.score1 ?? 0, s2: roomDoc?.score2 ?? 0 });
  const [liveRound, setLiveRound]       = useState(roomDoc?.round ?? 1);
  const [statusHtml, setStatusHtml]     = useState('');
  const [statusAbandoned, setAbandoned] = useState(false);
  const [arenaChoices, setArenaChoices] = useState({ c1: null, c2: null }); // null = hidden
  const [readiness, setReadiness]       = useState({ p1: false, p2: false });
  const [roundResult, setRoundResult]   = useState(null);
  const [historyRows, setHistoryRows]   = useState([]);

  const resolvedRef     = useRef(false);
  const cdStartRef      = useRef(null);
  const cdRef           = useRef(null);
  const cdStartedRef    = useRef(false);
  const roomDocRef      = useRef(roomDoc);
  const roomUnsubRef    = useRef(null);
  const movesUnsubRef   = useRef(null);

  // ── Countdown ─────────────────────────────────────────────
  const stopCountdown = useCallback(() => {
    if (cdRef.current) { clearInterval(cdRef.current); cdRef.current = null; }
  }, []);

  const startCountdown = useCallback(() => {
    if (cdStartedRef.current) return;
    cdStartedRef.current = true;
    cdStartRef.current = Date.now();

    function tick() {
      if (resolvedRef.current) { stopCountdown(); return; }
      const elapsed    = Math.floor((Date.now() - cdStartRef.current) / 1000);
      const remaining  = Math.max(0, ROUND_COUNTDOWN_SECS - elapsed);
      const urgentCls  = remaining <= 3 ? 'urgent' : '';
      setStatusHtml(
        `<div class="status-dot live"></div><span>Waiting for picks &nbsp;<span class="countdown-badge ${urgentCls}">${remaining}s</span></span>`
      );
      if (remaining <= 0) stopCountdown();
    }

    tick();
    cdRef.current = setInterval(tick, 500);
  }, [stopCountdown]);

  // ── Process moves for current round ───────────────────────
  const processMoves = useCallback(async (room) => {
    try {
      const res = await databases.listDocuments(DATABASE_ID, MOVES_COLLECTION, [
        Query.equal('room', room.$id),
        Query.orderAsc('round'),
        Query.limit(200),
      ]);

      const rounds      = buildRounds(res.documents, room);
      const curRound    = room.round || 1;
      const liveMoves   = rounds[curRound] || {};
      const p1Locked    = !!liveMoves.p1;
      const p2Locked    = !!liveMoves.p2;

      setReadiness({ p1: p1Locked, p2: p2Locked });

      // Reveal arena + result
      if (p1Locked && p2Locked && !resolvedRef.current) {
        resolvedRef.current = true;
        stopCountdown();
        setArenaChoices({ c1: liveMoves.p1, c2: liveMoves.p2 });

        let resClass, resTitle, resSub;
        if (liveMoves.p1 === liveMoves.p2) {
          resClass = 'draw'; resTitle = 'DRAW!'; resSub = `Both chose ${EMOJI[liveMoves.p1]}`;
        } else if (BEATS[liveMoves.p1] === liveMoves.p2) {
          resClass = 'win';
          resTitle = `${(room.player1 || 'Player 1').toUpperCase()} WINS!`;
          resSub   = `${EMOJI[liveMoves.p1]} beats ${EMOJI[liveMoves.p2]}`;
        } else {
          resClass = 'lose';
          resTitle = `${(room.player2 || 'Player 2').toUpperCase()} WINS!`;
          resSub   = `${EMOJI[liveMoves.p2]} beats ${EMOJI[liveMoves.p1]}`;
        }
        setRoundResult({ resClass, resTitle, resSub });
        setStatusHtml(`<div class="status-dot live"></div><span>Live — Round ${curRound}</span>`);
      }

      // Build history table
      const pastRounds = Object.entries(rounds).filter(([r]) => {
        const n = parseInt(r);
        if (n < curRound) return true;
        return n === curRound && rounds[r].p1 && rounds[r].p2;
      });

      setHistoryRows(pastRounds.map(([r, moves]) => {
        let resultText = '—';
        if (moves.p1 && moves.p2) {
          if (moves.p1 === moves.p2) resultText = 'Draw';
          else if (BEATS[moves.p1] === moves.p2) resultText = `${room.player1 || 'P1'} wins`;
          else resultText = `${room.player2 || 'P2'} wins`;
        }
        return { round: r, p1: moves.p1, p2: moves.p2, result: resultText };
      }));
    } catch (e) { console.error(e); }
  }, [stopCountdown]);

  // ── Reset for new round ────────────────────────────────────
  const resetRound = useCallback((room) => {
    resolvedRef.current = false;
    cdStartedRef.current = false;
    stopCountdown();
    setArenaChoices({ c1: null, c2: null });
    setReadiness({ p1: false, p2: false });
    setRoundResult(null);
    setLiveRound(room.round);
    setLiveScore({ s1: room.score1 ?? 0, s2: room.score2 ?? 0 });
    setStatusHtml(`<div class="status-dot live"></div><span>Live — Round ${room.round}</span>`);
    startCountdown();
  }, [stopCountdown, startCountdown]);

  // ── Subscribe ──────────────────────────────────────────────
  useEffect(() => {
    if (!roomId || !roomDoc) return;

    // Initial render
    setStatusHtml(`<div class="status-dot live"></div><span>Live — Round ${roomDoc.round}</span>`);
    processMoves(roomDoc);
    startCountdown();

    // Room watch
    roomUnsubRef.current = client.subscribe(
      `databases.${DATABASE_ID}.collections.${ROOMS_COLLECTION}.documents.${roomId}`,
      async ({ payload }) => {
        if (!payload) return;
        roomDocRef.current = payload;
        setRoomDoc(payload);
        setLiveScore({ s1: payload.score1 ?? 0, s2: payload.score2 ?? 0 });

        if (payload.round > useSpectatorStore.getState().currentRound) {
          setCurrentRound(payload.round);
          setRoundResolved(false);
          resetRound(payload);
        }

        if (payload.status === 'abandoned') {
          stopCountdown();
          setAbandoned(true);
          setStatusHtml(`<div class="status-dot done"></div><span class="opponent-left-text">😢 A player left — game ended</span>`);
        } else if (payload.status === 'admin-ended') {
          stopCountdown();
          setAbandoned(true);
          setStatusHtml(`<div class="status-dot done"></div><span class="opponent-left-text">🛑 Room ended by admin</span>`);
        } else if (payload.status !== 'playing') {
          setStatusHtml(`<div class="status-dot done"></div><span>Game ended</span>`);
        }

        await processMoves(payload);
      }
    );

    // Moves watch
    movesUnsubRef.current = client.subscribe(
      `databases.${DATABASE_ID}.collections.${MOVES_COLLECTION}.documents`,
      async ({ payload }) => {
        if (!payload) return;
        if (payload.room?.$id !== roomId) return;
        const room = roomDocRef.current;
        if (room) await processMoves(room);
      }
    );

    return () => {
      if (roomUnsubRef.current) roomUnsubRef.current();
      if (movesUnsubRef.current) movesUnsubRef.current();
      stopCountdown();
    };
  }, [roomId]);// eslint-disable-line react-hooks/exhaustive-deps

  function handleLeave() {
    leave();
    setScreen('home');
  }

  const room = roomDoc;
  if (!room) return null;

  return (
    <div id="screen-public-spectate">
      <div className="back-row">
        <button className="btn btn-ghost" onClick={handleLeave}>← Leave</button>
        <span className="text-muted">Room {room.code}</span>
      </div>

      <div className="card">
        {/* Score */}
        <div className="score-row">
          <div className="score-item">
            <div className="score-num">{liveScore.s1}</div>
            <div className="score-name">{room.player1 || 'Player 1'}</div>
          </div>
          <div className="score-divider">—</div>
          <div className="score-item">
            <div className="score-num">{liveScore.s2}</div>
            <div className="score-name">{room.player2 || 'Player 2'}</div>
          </div>
        </div>

        <div className="divider" />

        {/* Status bar */}
        <div
          id="pub-spectate-status"
          className={`status-bar${statusAbandoned ? ' status-abandoned' : ''}`}
          dangerouslySetInnerHTML={{ __html: statusHtml }}
        />

        {/* Arena */}
        <div className="arena">
          <div className="arena-player">
            <div className={`arena-choice ${arenaChoices.c1 ? '' : 'hidden'}`}>
              {arenaChoices.c1 ? EMOJI[arenaChoices.c1] : '❓'}
            </div>
            <div className="arena-name">{room.player1 || 'Player 1'}</div>
          </div>
          <div className="arena-vs">VS</div>
          <div className="arena-player">
            <div className={`arena-choice ${arenaChoices.c2 ? '' : 'hidden'}`}>
              {arenaChoices.c2 ? EMOJI[arenaChoices.c2] : '❓'}
            </div>
            <div className="arena-name">{room.player2 || 'Player 2'}</div>
          </div>
        </div>

        {/* Readiness indicators */}
        <div className="ready-indicators">
          <div className="ready-item">
            <span>{readiness.p1 ? '✅' : '⏳'}</span>
            <span>{room.player1 || 'Player 1'}</span>
          </div>
          <div className="ready-item">
            <span>{readiness.p2 ? '✅' : '⏳'}</span>
            <span>{room.player2 || 'Player 2'}</span>
          </div>
        </div>

        {/* Round result */}
        {roundResult && (
          <div className={`result-display ${roundResult.resClass}`} style={{ marginTop: '1rem' }}>
            <div className="result-title">{roundResult.resTitle}</div>
            <div className="result-sub">{roundResult.resSub}</div>
          </div>
        )}
      </div>

      {/* History table */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="card-title" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>Round History</div>
        {historyRows.length === 0 ? (
          <div className="admin-empty" style={{ padding: '1rem' }}>No completed rounds yet.</div>
        ) : (
          <div id="pub-spectate-moves">
            <div className="moves-row header">
              <div>RND</div>
              <div>{room.player1 || 'P1'}</div>
              <div>{room.player2 || 'P2'}</div>
              <div>Result</div>
            </div>
            {historyRows.map((row) => (
              <div className="moves-row" key={row.round}>
                <div className="moves-round">{row.round}</div>
                <div>{row.p1 ? EMOJI[row.p1] : '—'} {row.p1 || '—'}</div>
                <div>{row.p2 ? EMOJI[row.p2] : '—'} {row.p2 || '—'}</div>
                <div style={{ color: 'var(--muted)', fontSize: '0.65rem' }}>{row.result}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
