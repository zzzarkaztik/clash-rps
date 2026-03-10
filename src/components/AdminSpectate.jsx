import { useEffect, useRef, useState } from "react";
import { useGameStore, useAdminStore } from "../state";
import { client, databases, Query, DATABASE_ID, ROOMS_COLLECTION, MOVES_COLLECTION, EMOJI, BEATS } from "../appwrite";

function buildRounds(documents, room) {
  const rounds = {};
  documents.forEach((m) => {
    if (!rounds[m.round]) rounds[m.round] = {};
    const isP1 = m.playerId === room.player1id;
    rounds[m.round][isP1 ? "p1" : "p2"] = m.choice;
  });
  return rounds;
}

export default function AdminSpectate() {
  const setScreen = useGameStore((s) => s.setScreen);
  const spectateRoomId = useAdminStore((s) => s.spectateRoomId);
  const stopSpectating = useAdminStore((s) => s.stopSpectating);

  const [room, setRoom] = useState(null);
  const [historyRows, setHistory] = useState([]);
  const [arenaChoices, setArena] = useState({ c1: null, c2: null });
  const [error, setError] = useState("");

  const roomRef = useRef(null);
  const roomUnsubRef = useRef(null);
  const movesUnsubRef = useRef(null);

  async function loadRoom(id) {
    try {
      const doc = await databases.getDocument(DATABASE_ID, ROOMS_COLLECTION, id);
      roomRef.current = doc;
      setRoom(doc);
      await loadMoves(id, doc);
    } catch (e) {
      setError("Could not load room: " + e.message);
    }
  }

  async function loadMoves(roomId, roomDoc) {
    try {
      const res = await databases.listDocuments(DATABASE_ID, MOVES_COLLECTION, [
        Query.equal("room", roomId),
        Query.orderAsc("round"),
        Query.limit(100),
      ]);

      const rounds = buildRounds(res.documents, roomDoc);

      // Arena choices for current round
      const curMoves = rounds[roomDoc.round] || {};
      setArena({ c1: curMoves.p1 || null, c2: curMoves.p2 || null });

      // Build history rows
      const rows = Object.entries(rounds).map(([r, moves]) => {
        let resultText = "—";
        if (moves.p1 && moves.p2) {
          if (moves.p1 === moves.p2) resultText = "Draw";
          else if (BEATS[moves.p1] === moves.p2) resultText = `${roomDoc.player1 || "P1"} wins`;
          else resultText = `${roomDoc.player2 || "P2"} wins`;
        }
        return { round: r, p1: moves.p1, p2: moves.p2, result: resultText };
      });
      setHistory(rows);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    if (!spectateRoomId) return;
    loadRoom(spectateRoomId);

    // Room subscription
    roomUnsubRef.current = client.subscribe(
      `databases.${DATABASE_ID}.collections.${ROOMS_COLLECTION}.documents.${spectateRoomId}`,
      ({ payload }) => {
        if (!payload) return;
        roomRef.current = payload;
        setRoom(payload);
        loadMoves(spectateRoomId, payload);
      },
    );

    // Moves subscription
    movesUnsubRef.current = client.subscribe(`databases.${DATABASE_ID}.collections.${MOVES_COLLECTION}.documents`, async ({ payload }) => {
      if (!payload) return;
      if (payload.room?.$id !== spectateRoomId) return;
      const r = await databases.getDocument(DATABASE_ID, ROOMS_COLLECTION, spectateRoomId).catch(() => null);
      if (r) loadMoves(spectateRoomId, r);
    });

    return () => {
      if (roomUnsubRef.current) roomUnsubRef.current();
      if (movesUnsubRef.current) movesUnsubRef.current();
    };
  }, [spectateRoomId]);

  function handleBack() {
    if (roomUnsubRef.current) roomUnsubRef.current();
    if (movesUnsubRef.current) movesUnsubRef.current();
    useAdminStore.setState({ spectateRoomId: null, spectateUnsub: null, spectateMovesUnsub: null });
    setScreen("admin-dashboard");
    // Refresh dashboard
    setTimeout(() => {
      // AdminDashboard re-mounts and auto-refreshes via useEffect
    }, 0);
  }

  function openForceEnd() {
    if (!spectateRoomId || !room) return;
    useAdminStore.setState({ _showForceEndDialog: true });
  }

  if (error)
    return (
      <div id="screen-spectate">
        <div className="back-row">
          <button className="btn btn-ghost" onClick={handleBack}>
            ← Back
          </button>
        </div>
        <div className="message error">{error}</div>
      </div>
    );

  if (!room)
    return (
      <div id="screen-spectate">
        <div className="back-row">
          <button className="btn btn-ghost" onClick={handleBack}>
            ← Back
          </button>
        </div>
        <div className="status-bar">
          <div className="status-dot waiting" />
          <span>Loading...</span>
        </div>
      </div>
    );

  const isLive = room.status === "playing";

  return (
    <div id="screen-spectate">
      <div className="back-row">
        <button className="btn btn-ghost" onClick={handleBack}>
          ← Back
        </button>
        <span className="text-muted">Room {room.code}</span>
      </div>

      <div className="card">
        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
          <div>
            <div className="card-title" style={{ marginBottom: "0.25rem" }}>
              {room.player1 || "Player 1"} vs {room.player2 || "Player 2"}
            </div>
            <div id="spectate-status-text" className="text-muted" style={{ fontSize: "0.75rem" }}>
              {room.status === "playing" ? `Live — Round ${room.round}` : `Game ${room.status}`}
            </div>
          </div>
          {isLive && (
            <button className="btn btn-danger btn-sm" onClick={openForceEnd}>
              ⛔ Force End
            </button>
          )}
        </div>

        {/* Score */}
        <div className="score-row">
          <div className="score-item">
            <div className="score-num">{room.score1 ?? 0}</div>
            <div className="score-name">{room.player1 || "Player 1"}</div>
          </div>
          <div className="score-divider">—</div>
          <div className="score-item">
            <div className="score-num">{room.score2 ?? 0}</div>
            <div className="score-name">{room.player2 || "Player 2"}</div>
          </div>
        </div>

        <div className="divider" />

        {/* Arena */}
        <div className="arena">
          <div className="arena-player">
            <div className={`arena-choice ${arenaChoices.c1 ? "" : ""}`}>{arenaChoices.c1 ? EMOJI[arenaChoices.c1] : "🤔"}</div>
            <div className="arena-name">{room.player1 || "Player 1"}</div>
          </div>
          <div className="arena-vs">VS</div>
          <div className="arena-player">
            <div className="arena-choice">{arenaChoices.c2 ? EMOJI[arenaChoices.c2] : "🤔"}</div>
            <div className="arena-name">{room.player2 || "Player 2"}</div>
          </div>
        </div>
      </div>

      {/* Moves history */}
      <div className="card" style={{ marginTop: "1rem" }}>
        <div className="card-title" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          Round History
        </div>
        {historyRows.length === 0 ? (
          <div className="admin-empty" style={{ padding: "1rem" }}>
            No moves yet.
          </div>
        ) : (
          <div id="spectate-moves">
            <div className="moves-row header">
              <div>RND</div>
              <div>{room.player1 || "P1"}</div>
              <div>{room.player2 || "P2"}</div>
              <div>Result</div>
            </div>
            {historyRows.map((row) => (
              <div className="moves-row" key={row.round}>
                <div className="moves-round">{row.round}</div>
                <div>{row.p1 ? `${EMOJI[row.p1]} ${row.p1}` : "⏳ —"}</div>
                <div>{row.p2 ? `${EMOJI[row.p2]} ${row.p2}` : "⏳ —"}</div>
                <div style={{ color: "var(--muted)", fontSize: "0.65rem" }}>{row.result}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
