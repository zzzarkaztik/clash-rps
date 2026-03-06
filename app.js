// ============================================================
//  CONFIGURATION — Update these values for your Appwrite project
// ============================================================
const APPWRITE_ENDPOINT = "https://sgp.cloud.appwrite.io/v1"; // e.g. https://sgp.cloud.appwrite.io/v1
const PROJECT_ID = "69aa2248001ede62df80"; // ← Replace
const DATABASE_ID = "69aa22dc003e3e411118"; // ← Replace
const ROOMS_COLLECTION = "rooms";
const MOVES_COLLECTION = "moves";

/*
  ROOMS Collection attributes:
    - code        (string, size 4, required)
    - player1     (string, size 64)
    - player2     (string, size 64)
    - player1id   (string, size 64)
    - player2id   (string, size 64)
    - status      (string, size 32, default: "waiting")
    - score1      (integer, default: 0)
    - score2      (integer, default: 0)
    - round       (integer, default: 1)

  MOVES Collection attributes:
    - room        (relationship → rooms, many-to-one, key: "room")
    - playerId    (string, size 64, required)
    - choice      (string, size 16, required)
    - round       (integer, required)

  Index on ROOMS: key=code (unique)
  Index on MOVES: key=room (index)

  ADMIN SETUP:
    - Go to Appwrite Console → Auth → Users → Create User
    - Use that email/password to log in via the Admin screen
    - No extra config needed — Appwrite handles the session
*/
// ============================================================

const { Client, Databases, Account, Query, ID } = Appwrite;

const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(PROJECT_ID);

const databases = new Databases(client);
const account = new Account(client);

// ─── Player State ─────────────────────────────────────────────

let state = {
  playerName: "",
  playerId: localStorage.getItem("clash_pid") || ID.unique(),
  roomCode: null,
  roomDocId: null,
  isPlayer1: false,
  currentRound: 1,
  myChoice: null,
  opponentName: "",
  score: { me: 0, opp: 0 },
  realtimeUnsub: null,
  waitingUnsub: null,
};

localStorage.setItem("clash_pid", state.playerId);

// ─── Admin State ───────────────────────────────────────────────

let admin = {
  session: null,
  spectateRoomId: null,
  spectateUnsub: null,
  spectateMovesUnsub: null,
};

// ─── Navigation ───────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function showMsg(id, text, type = "error") {
  const el = document.getElementById(id);
  el.className = `message ${type}`;
  el.textContent = text;
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 4000);
}

function goHome() {
  cleanup();
  showScreen("screen-home");
}

function goToLobby() {
  const name = document.getElementById("player-name").value.trim();
  if (!name) {
    alert("Enter your name first!");
    return;
  }
  state.playerName = name;
  document.getElementById("display-name-lobby").textContent = name;
  showScreen("screen-lobby");
}

// ─── Room Creation ─────────────────────────────────────────────

function genCode() {
  return Math.random()
    .toString(36)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4)
    .padEnd(4, "X");
}

async function createRoom() {
  const code = genCode();
  try {
    const doc = await databases.createDocument(DATABASE_ID, ROOMS_COLLECTION, ID.unique(), {
      code,
      player1: state.playerName,
      player1id: state.playerId,
      player2: "",
      player2id: "",
      status: "waiting",
      score1: 0,
      score2: 0,
      round: 1,
    });
    state.roomCode = code;
    state.roomDocId = doc.$id;
    state.isPlayer1 = true;
    state.currentRound = 1;
    state.score = { me: 0, opp: 0 };
    enterWaitingRoom();
  } catch (e) {
    showMsg("lobby-msg", "Failed to create room: " + (e.message || e), "error");
  }
}

async function joinRoom() {
  const code = document.getElementById("join-code").value.trim().toUpperCase();
  if (code.length !== 4) {
    showMsg("lobby-msg", "Enter a 4-character room code.", "error");
    return;
  }

  try {
    const res = await databases.listDocuments(DATABASE_ID, ROOMS_COLLECTION, [Query.equal("code", code)]);

    if (!res.documents.length) {
      showMsg("lobby-msg", "Room not found. Check the code!", "error");
      return;
    }

    const room = res.documents[0];

    if (room.status !== "waiting") {
      showMsg("lobby-msg", "That game is already in progress.", "error");
      return;
    }

    if (room.player1id === state.playerId) {
      state.roomCode = code;
      state.roomDocId = room.$id;
      state.isPlayer1 = true;
      state.currentRound = room.round || 1;
      state.score = { me: room.score1, opp: room.score2 };
      enterWaitingRoom();
      return;
    }

    if (room.player2 && room.player2id !== state.playerId) {
      showMsg("lobby-msg", "Room is full!", "error");
      return;
    }

    await databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, room.$id, {
      player2: state.playerName,
      player2id: state.playerId,
    });

    state.roomCode = code;
    state.roomDocId = room.$id;
    state.isPlayer1 = false;
    state.opponentName = room.player1;
    state.currentRound = room.round || 1;
    state.score = { me: room.score2, opp: room.score1 };
    enterWaitingRoom();
  } catch (e) {
    showMsg("lobby-msg", "Error: " + (e.message || e), "error");
  }
}

// ─── Waiting Room ──────────────────────────────────────────────

function enterWaitingRoom() {
  document.getElementById("waiting-code").textContent = state.roomCode;
  renderPlayers(null);
  showScreen("screen-waiting");
  subscribeWaiting();
}

function renderPlayers(room) {
  const list = document.getElementById("players-list");
  const p1name = room ? room.player1 : state.isPlayer1 ? state.playerName : "";
  const p2name = room ? room.player2 : !state.isPlayer1 ? state.playerName : "";
  const hasP2 = !!p2name;

  list.innerHTML = `
    <div class="player-slot ${state.isPlayer1 ? "you" : "filled"}">
      <div class="player-avatar">🧑</div>
      <div class="player-name">${p1name || "—"}</div>
      <div class="player-badge ${state.isPlayer1 ? "" : "ready"}">${state.isPlayer1 ? "YOU" : "HOST"}</div>
    </div>
    <div class="player-slot ${hasP2 ? (state.isPlayer1 ? "filled" : "you") : ""}">
      <div class="player-avatar">${hasP2 ? "🧑" : "⏳"}</div>
      <div class="player-name">${p2name || "Waiting..."}</div>
      ${hasP2 ? `<div class="player-badge ${!state.isPlayer1 ? "" : "ready"}">${!state.isPlayer1 ? "YOU" : "GUEST"}</div>` : ""}
    </div>
  `;

  const statusEl = document.getElementById("waiting-status");
  const startBtn = document.getElementById("btn-start");

  if (hasP2) {
    if (state.isPlayer1) {
      statusEl.innerHTML = `<div class="status-dot live"></div><span>Both players ready!</span>`;
      startBtn.style.display = "block";
    } else {
      statusEl.innerHTML = `<div class="status-dot waiting"></div><span>Waiting for host to start...</span>`;
      startBtn.style.display = "none";
    }
  } else {
    statusEl.innerHTML = `<div class="status-dot waiting"></div><span>Waiting for opponent to join...</span>`;
    startBtn.style.display = "none";
  }
}

function subscribeWaiting() {
  if (state.waitingUnsub) state.waitingUnsub();

  state.waitingUnsub = client.subscribe(
    `databases.${DATABASE_ID}.collections.${ROOMS_COLLECTION}.documents.${state.roomDocId}`,
    ({ payload }) => {
      if (!payload) return;
      renderPlayers(payload);
      if (payload.status === "playing") {
        if (state.waitingUnsub) {
          state.waitingUnsub();
          state.waitingUnsub = null;
        }
        state.opponentName = state.isPlayer1 ? payload.player2 : payload.player1;
        state.currentRound = payload.round || 1;
        enterGame();
      }
    },
  );

  refreshRoomDoc();
}

async function refreshRoomDoc() {
  try {
    const room = await databases.getDocument(DATABASE_ID, ROOMS_COLLECTION, state.roomDocId);
    renderPlayers(room);
    if (room.status === "playing") {
      state.opponentName = state.isPlayer1 ? room.player2 : room.player1;
      state.currentRound = room.round || 1;
      if (state.waitingUnsub) {
        state.waitingUnsub();
        state.waitingUnsub = null;
      }
      enterGame();
    }
  } catch (e) {
    console.error(e);
  }
}

async function startGame() {
  try {
    await databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, state.roomDocId, {
      status: "playing",
    });
  } catch (e) {
    alert("Could not start game: " + e.message);
  }
}

function copyRoomCode() {
  const link = `https://zzzarkaztik.github.io/clash-rps/${state.roomCode}`;
  navigator.clipboard.writeText(link).then(() => {
    const el = document.querySelector(".copy-hint");
    el.textContent = "copied! ✓";
    setTimeout(() => (el.textContent = "click to copy"), 1500);
  });
}

// ─── Game ──────────────────────────────────────────────────────

const EMOJI = { rock: "✊", paper: "✋", scissors: "✌️" };
const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };

function enterGame() {
  state.myChoice = null;
  document.getElementById("game-round-label").textContent = `Round ${state.currentRound}`;
  document.getElementById("score-you-name").textContent = state.playerName;
  document.getElementById("score-opp-name").textContent = state.opponentName || "Opponent";
  document.getElementById("arena-opp-name").textContent = state.opponentName || "Opponent";
  updateScoreDisplay();
  resetChoiceUI();
  showScreen("screen-game");
  subscribeGame();
}

function updateScoreDisplay() {
  document.getElementById("score-you").textContent = state.score.me;
  document.getElementById("score-opp").textContent = state.score.opp;
}

function resetChoiceUI() {
  document.getElementById("arena-you").textContent = "🤔";
  document.getElementById("arena-opp").textContent = "❓";
  document.getElementById("arena-opp").className = "arena-choice hidden";
  document.getElementById("choice-section").style.display = "";
  document.getElementById("result-section").style.display = "none";
  document.querySelectorAll(".choice-btn").forEach((b) => {
    b.classList.remove("selected");
    b.disabled = false;
  });
  document.getElementById("game-status").innerHTML = `<div class="status-dot waiting"></div><span>Make your choice!</span>`;
}

async function makeChoice(choice) {
  if (state.myChoice) return;
  state.myChoice = choice;

  document.getElementById("arena-you").textContent = EMOJI[choice];
  document.querySelectorAll(".choice-btn").forEach((b) => {
    b.disabled = true;
    if (b.dataset.choice === choice) b.classList.add("selected");
  });
  document.getElementById("game-status").innerHTML =
    `<div class="status-dot waiting"></div><span>Waiting for opponent <span class="waiting-dots"><span>.</span><span>.</span><span>.</span></span></span>`;

  const playerId = state.playerId;
  const round = state.currentRound;

  try {
    const existing = await databases.listDocuments(DATABASE_ID, MOVES_COLLECTION, [
      Query.equal("room", state.roomDocId),
      Query.equal("playerId", playerId),
      Query.equal("round", round),
    ]);
    if (existing.documents.length > 0) {
      await databases.updateDocument(DATABASE_ID, MOVES_COLLECTION, existing.documents[0].$id, { choice });
    } else {
      await databases.createDocument(DATABASE_ID, MOVES_COLLECTION, ID.unique(), {
        room: state.roomDocId,
        playerId,
        choice,
        round,
      });
    }
  } catch (e) {
    console.error("Move submit error:", e);
  }
}

function subscribeGame() {
  if (state.realtimeUnsub) state.realtimeUnsub();

  state.realtimeUnsub = client.subscribe(`databases.${DATABASE_ID}.collections.${MOVES_COLLECTION}.documents`, async ({ payload }) => {
    if (!payload) return;
    if (payload.room?.$id !== state.roomDocId) return;
    if (payload.round !== state.currentRound) return;
    await checkBothMoves();
  });
}

async function checkBothMoves() {
  try {
    const res = await databases.listDocuments(DATABASE_ID, MOVES_COLLECTION, [
      Query.equal("room", state.roomDocId),
      Query.equal("round", state.currentRound),
    ]);

    if (res.documents.length < 2) return;

    const myMove = res.documents.find((d) => d.playerId === state.playerId);
    const oppMove = res.documents.find((d) => d.playerId !== state.playerId);

    if (!myMove || !oppMove) return;

    resolveRound(myMove.choice, oppMove.choice);
  } catch (e) {
    console.error(e);
  }
}

function resolveRound(myChoice, oppChoice) {
  document.getElementById("arena-opp").textContent = EMOJI[oppChoice];
  document.getElementById("arena-opp").className = "arena-choice";

  let outcome;
  if (myChoice === oppChoice) {
    outcome = "draw";
  } else if (BEATS[myChoice] === oppChoice) {
    outcome = "win";
    state.score.me++;
  } else {
    outcome = "lose";
    state.score.opp++;
  }

  updateScoreDisplay();

  const titles = { win: "YOU WIN!", lose: "YOU LOSE", draw: "DRAW!" };
  const subs = {
    win: `${EMOJI[myChoice]} beats ${EMOJI[oppChoice]}`,
    lose: `${EMOJI[oppChoice]} beats ${EMOJI[myChoice]}`,
    draw: `Both chose ${EMOJI[myChoice]}`,
  };

  const rd = document.getElementById("result-display");
  rd.className = `result-display ${outcome}`;
  document.getElementById("result-title").textContent = titles[outcome];
  document.getElementById("result-sub").textContent = subs[outcome];

  document.getElementById("choice-section").style.display = "none";
  document.getElementById("result-section").style.display = "";

  if (state.isPlayer1) {
    databases
      .updateDocument(DATABASE_ID, ROOMS_COLLECTION, state.roomDocId, {
        score1: state.score.me,
        score2: state.score.opp,
      })
      .catch(console.error);
  }
}

async function nextRound() {
  state.currentRound++;
  state.myChoice = null;
  document.getElementById("game-round-label").textContent = `Round ${state.currentRound}`;

  if (state.isPlayer1) {
    await databases
      .updateDocument(DATABASE_ID, ROOMS_COLLECTION, state.roomDocId, {
        round: state.currentRound,
      })
      .catch(console.error);
  }

  resetChoiceUI();
}

// ─── Cleanup ───────────────────────────────────────────────────

async function leaveRoom() {
  cleanup();
  if (state.roomDocId) {
    try {
      await databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, state.roomDocId, {
        status: "abandoned",
      });
    } catch (e) {}
  }
  state.roomCode = null;
  state.roomDocId = null;
  showScreen("screen-lobby");
}

function cleanup() {
  if (state.realtimeUnsub) {
    state.realtimeUnsub();
    state.realtimeUnsub = null;
  }
  if (state.waitingUnsub) {
    state.waitingUnsub();
    state.waitingUnsub = null;
  }
}

// ══════════════════════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════════════════════

// ─── Admin Login ───────────────────────────────────────────────

async function adminLogin() {
  const email = document.getElementById("admin-email").value.trim();
  const password = document.getElementById("admin-password").value;

  if (!email || !password) {
    showMsg("admin-login-msg", "Enter your email and password.", "error");
    return;
  }

  const btn = document.querySelector("#screen-admin-login .btn-admin");
  btn.disabled = true;
  btn.textContent = "Signing in...";

  try {
    // Clear any lingering session before creating a new one
    try {
      await account.deleteSession("current");
    } catch (_) {}
    admin.session = await account.createEmailPasswordSession(email, password);
    btn.textContent = "Sign In →";
    btn.disabled = false;
    document.getElementById("admin-password").value = "";
    showScreen("screen-admin");
    adminRefreshRooms();
  } catch (e) {
    btn.textContent = "Sign In →";
    btn.disabled = false;
    showMsg("admin-login-msg", "Login failed: " + (e.message || "Invalid credentials"), "error");
  }
}

async function adminLogout() {
  try {
    await account.deleteSession("current");
  } catch (e) {}
  admin.session = null;
  stopSpectating();
  showScreen("screen-home");
}

// ─── Admin Dashboard ───────────────────────────────────────────

async function adminRefreshRooms() {
  const statusEl = document.getElementById("admin-status");
  const listEl = document.getElementById("admin-rooms-list");

  statusEl.innerHTML = `<div class="status-dot waiting"></div><span>Loading rooms...</span>`;
  statusEl.style.display = "flex";
  listEl.innerHTML = "";

  try {
    const res = await databases.listDocuments(DATABASE_ID, ROOMS_COLLECTION, [Query.orderDesc("$createdAt"), Query.limit(50)]);

    const rooms = res.documents;

    statusEl.style.display = "none";

    if (!rooms.length) {
      listEl.innerHTML = `<div class="admin-empty">No active rooms found.</div>`;
      return;
    }

    listEl.innerHTML = rooms
      .map((room) => {
        const p1 = room.player1 || "—";
        const p2 = room.player2 || "Waiting...";
        const statusClass = room.status === "playing" ? "playing" : room.status === "waiting" ? "waiting" : "abandoned";
        const canSpectate = room.status === "playing";

        return `
        <div class="admin-room-row">
          <div class="admin-room-code">${room.code}</div>
          <div class="admin-room-info">
            <strong>${p1}</strong> vs <strong>${p2}</strong><br>
            Round ${room.round || 1} &nbsp;·&nbsp; Score ${room.score1 ?? 0}–${room.score2 ?? 0}
          </div>
          <div class="admin-room-status ${statusClass}">${room.status}</div>
          <div class="admin-room-actions">
            ${canSpectate ? `<button class="btn btn-secondary btn-sm" onclick="adminSpectate('${room.$id}')">👁 Watch</button>` : ""}
            <button class="btn btn-danger btn-sm" onclick="adminDeleteRoom('${room.$id}', '${room.code}')">✕</button>
          </div>
        </div>
      `;
      })
      .join("");
  } catch (e) {
    statusEl.innerHTML = `<div class="status-dot done"></div><span>Error: ${e.message}</span>`;
  }
}

// ─── Admin Delete Room ─────────────────────────────────────────

async function adminDeleteRoom(roomId, code) {
  if (!confirm(`Force-end room ${code}? This will mark it as abandoned.`)) return;

  try {
    await databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, roomId, {
      status: "abandoned",
    });
    adminRefreshRooms();
  } catch (e) {
    alert("Failed to end room: " + e.message);
  }
}

// ─── Admin Spectate ────────────────────────────────────────────

async function adminSpectate(roomId) {
  admin.spectateRoomId = roomId;

  try {
    const room = await databases.getDocument(DATABASE_ID, ROOMS_COLLECTION, roomId);
    renderSpectateRoom(room);
    await renderSpectateMoves(roomId, room);
    showScreen("screen-spectate");
    subscribeSpectate(roomId);
  } catch (e) {
    alert("Could not load room: " + e.message);
  }
}

function renderSpectateRoom(room) {
  document.getElementById("spectate-title").textContent = `Room ${room.code}`;
  document.getElementById("spectate-name1").textContent = room.player1 || "Player 1";
  document.getElementById("spectate-name2").textContent = room.player2 || "Player 2";
  document.getElementById("spectate-label1").textContent = room.player1 || "Player 1";
  document.getElementById("spectate-label2").textContent = room.player2 || "Player 2";
  document.getElementById("spectate-score1").textContent = room.score1 ?? 0;
  document.getElementById("spectate-score2").textContent = room.score2 ?? 0;
  document.getElementById("spectate-status-text").textContent =
    room.status === "playing" ? `Live — Round ${room.round}` : `Game ${room.status}`;
}

async function renderSpectateMoves(roomId, room) {
  try {
    const res = await databases.listDocuments(DATABASE_ID, MOVES_COLLECTION, [
      Query.equal("room", roomId),
      Query.orderAsc("round"),
      Query.limit(100),
    ]);

    const movesEl = document.getElementById("spectate-moves");

    if (!res.documents.length) {
      movesEl.innerHTML = `<div class="admin-empty" style="padding:1rem;">No moves yet.</div>`;
      return;
    }

    // Group by round
    const rounds = {};
    res.documents.forEach((m) => {
      if (!rounds[m.round]) rounds[m.round] = {};
      const isP1 = m.playerId === room.player1id;
      rounds[m.round][isP1 ? "p1" : "p2"] = m.choice;
    });

    const rows = Object.entries(rounds).map(([round, moves]) => {
      const p1choice = moves.p1 ? EMOJI[moves.p1] : "⏳";
      const p2choice = moves.p2 ? EMOJI[moves.p2] : "⏳";

      let result = "—";
      if (moves.p1 && moves.p2) {
        if (moves.p1 === moves.p2) result = "Draw";
        else if (BEATS[moves.p1] === moves.p2) result = `${room.player1 || "P1"} wins`;
        else result = `${room.player2 || "P2"} wins`;
      }

      return `
        <div class="moves-row">
          <div class="moves-round">${round}</div>
          <div>${p1choice} ${moves.p1 || "—"}</div>
          <div>${p2choice} ${moves.p2 || "—"}</div>
          <div style="color:var(--muted); font-size:0.65rem;">${result}</div>
        </div>
      `;
    });

    movesEl.innerHTML = `
      <div class="moves-row header">
        <div>RND</div>
        <div>${room.player1 || "P1"}</div>
        <div>${room.player2 || "P2"}</div>
        <div>Result</div>
      </div>
      ${rows.join("")}
    `;

    // Show current round choices in arena (hide until both submit)
    const currentMoves = rounds[room.round] || {};
    document.getElementById("spectate-choice1").textContent = currentMoves.p1 ? EMOJI[currentMoves.p1] : "🤔";
    document.getElementById("spectate-choice2").textContent = currentMoves.p2 ? EMOJI[currentMoves.p2] : "🤔";
  } catch (e) {
    console.error(e);
  }
}

function subscribeSpectate(roomId) {
  if (admin.spectateUnsub) admin.spectateUnsub();
  if (admin.spectateMovesUnsub) admin.spectateMovesUnsub();

  // Watch room doc for score/round changes
  admin.spectateUnsub = client.subscribe(`databases.${DATABASE_ID}.collections.${ROOMS_COLLECTION}.documents.${roomId}`, ({ payload }) => {
    if (!payload) return;
    renderSpectateRoom(payload);
    renderSpectateMoves(roomId, payload);
  });

  // Watch moves collection for new moves in this room
  admin.spectateMovesUnsub = client.subscribe(`databases.${DATABASE_ID}.collections.${MOVES_COLLECTION}.documents`, async ({ payload }) => {
    if (!payload) return;
    if (payload.room?.$id !== roomId) return;
    const room = await databases.getDocument(DATABASE_ID, ROOMS_COLLECTION, roomId).catch(() => null);
    if (room) renderSpectateMoves(roomId, room);
  });
}

function stopSpectating() {
  if (admin.spectateUnsub) {
    admin.spectateUnsub();
    admin.spectateUnsub = null;
  }
  if (admin.spectateMovesUnsub) {
    admin.spectateMovesUnsub();
    admin.spectateMovesUnsub = null;
  }
  admin.spectateRoomId = null;
  showScreen("screen-admin");
  adminRefreshRooms();
}

async function adminEndRoom() {
  if (!admin.spectateRoomId) return;
  if (!confirm("Force-end this room?")) return;

  try {
    await databases.updateDocument(DATABASE_ID, ROOMS_COLLECTION, admin.spectateRoomId, {
      status: "abandoned",
    });
    stopSpectating();
  } catch (e) {
    alert("Failed: " + e.message);
  }
}

// ─── Init ──────────────────────────────────────────────────────

// Auto-fill room code if URL contains one e.g. /clash-rps/XK9A
(function () {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && /^[A-Z0-9]{4}$/.test(last.toUpperCase())) {
    document.getElementById("join-code").value = last.toUpperCase();
  }
})();

// Check if already logged in as admin on page load
account
  .get()
  .then((user) => {
    admin.session = user;
  })
  .catch(() => {
    admin.session = null;
  });

// Fallback poll for missed move events
setInterval(async () => {
  const resultHidden = document.getElementById("result-section").style.display === "none";
  if (state.roomCode && state.myChoice && resultHidden) {
    await checkBothMoves().catch(() => {});
  }
}, 3000);
