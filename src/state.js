import { create } from 'zustand';
import { ID } from 'appwrite';

// ─── Persist player identity across sessions ───────────────────
const storedPid = localStorage.getItem('clash_pid') || ID.unique();
const storedSid = sessionStorage.getItem('clash_sid') || ID.unique();
localStorage.setItem('clash_pid', storedPid);
sessionStorage.setItem('clash_sid', storedSid);

// ─── Game Store ────────────────────────────────────────────────
export const useGameStore = create((set, get) => ({

  // ── Screen navigation ────────────────────────────────────────
  screen: 'home', // 'home' | 'lobby' | 'waiting' | 'game' | 'spectate-join' | 'public-spectate' | 'admin-login' | 'admin-dashboard' | 'admin-spectate'
  setScreen: (screen) => set({ screen }),

  // ── Player identity ──────────────────────────────────────────
  playerName: '',
  playerId: storedPid,
  sessionId: storedSid,
  setPlayerName: (name) => set({ playerName: name }),

  // ── Room ─────────────────────────────────────────────────────
  roomCode: null,
  roomDocId: null,
  isPlayer1: false,
  setRoom: ({ roomCode, roomDocId, isPlayer1 }) =>
    set({ roomCode, roomDocId, isPlayer1 }),
  clearRoom: () =>
    set({ roomCode: null, roomDocId: null, isPlayer1: false }),

  // ── Game ─────────────────────────────────────────────────────
  currentRound: 1,
  myChoice: null,
  opponentName: '',
  opponentId: '',
  score: { me: 0, opp: 0 },
  roundResolved: false,
  iReadyForRound: false,

  setCurrentRound: (r) => set({ currentRound: r }),
  setMyChoice: (choice) => set({ myChoice: choice }),
  setOpponent: ({ opponentName, opponentId }) =>
    set({ opponentName, opponentId }),
  setScore: (score) => set({ score }),
  incrementScore: (who) =>
    set((s) => ({
      score: {
        ...s.score,
        [who]: s.score[who] + 1,
      },
    })),
  setRoundResolved: (val) => set({ roundResolved: val }),
  setIReadyForRound: (val) => set({ iReadyForRound: val }),

  // ── Countdown ────────────────────────────────────────────────
  countdownInterval: null,
  countdownStart: null,
  setCountdownInterval: (id) => set({ countdownInterval: id }),
  setCountdownStart: (t) => set({ countdownStart: t }),
  clearCountdown: () => {
    const { countdownInterval } = get();
    if (countdownInterval) clearInterval(countdownInterval);
    set({ countdownInterval: null, countdownStart: null });
  },

  // ── Realtime subscriptions ───────────────────────────────────
  // These hold the Appwrite unsubscribe functions.
  // Stored as refs rather than reactive state — setting them
  // does not trigger re-renders (we use a plain object for this,
  // see `subscriptions` below). Kept here for convenience.
  realtimeUnsub: null,
  waitingUnsub: null,
  roomWatchUnsub: null,
  setRealtimeUnsub: (fn) => set({ realtimeUnsub: fn }),
  setWaitingUnsub: (fn) => set({ waitingUnsub: fn }),
  setRoomWatchUnsub: (fn) => set({ roomWatchUnsub: fn }),

  // ── Full reset (leave room / go home) ────────────────────────
  resetGame: () => {
    const { realtimeUnsub, waitingUnsub, roomWatchUnsub, countdownInterval } = get();
    if (realtimeUnsub) realtimeUnsub();
    if (waitingUnsub) waitingUnsub();
    if (roomWatchUnsub) roomWatchUnsub();
    if (countdownInterval) clearInterval(countdownInterval);
    set({
      roomCode: null,
      roomDocId: null,
      isPlayer1: false,
      currentRound: 1,
      myChoice: null,
      opponentName: '',
      opponentId: '',
      score: { me: 0, opp: 0 },
      roundResolved: false,
      iReadyForRound: false,
      countdownInterval: null,
      countdownStart: null,
      realtimeUnsub: null,
      waitingUnsub: null,
      roomWatchUnsub: null,
    });
  },

  // ── Round reset (between rounds) ─────────────────────────────
  resetRound: () =>
    set({
      myChoice: null,
      roundResolved: false,
      iReadyForRound: false,
    }),
}));

// ─── Admin Store ───────────────────────────────────────────────
export const useAdminStore = create((set) => ({
  session: null,
  spectateRoomId: null,
  spectateUnsub: null,
  spectateMovesUnsub: null,
  pendingDeleteId: null,
  pendingDeleteCode: null,
  _showDashDialog: false,
  _showForceEndDialog: false,
  _dashRefresh: 0,

  setSession: (session) => set({ session }),
  setSpectateRoom: (id) => set({ spectateRoomId: id }),
  setSpectateUnsub: (fn) => set({ spectateUnsub: fn }),
  setSpectateMovesUnsub: (fn) => set({ spectateMovesUnsub: fn }),
  setPendingDelete: ({ id, code }) =>
    set({ pendingDeleteId: id, pendingDeleteCode: code }),
  clearPendingDelete: () =>
    set({ pendingDeleteId: null, pendingDeleteCode: null }),

  stopSpectating: () => {
    set((s) => {
      if (s.spectateUnsub) s.spectateUnsub();
      if (s.spectateMovesUnsub) s.spectateMovesUnsub();
      return {
        spectateRoomId: null,
        spectateUnsub: null,
        spectateMovesUnsub: null,
      };
    });
  },

  logout: () =>
    set({
      session: null,
      spectateRoomId: null,
      spectateUnsub: null,
      spectateMovesUnsub: null,
      pendingDeleteId: null,
      pendingDeleteCode: null,
    }),
}));

// ─── Spectator Store ───────────────────────────────────────────
export const useSpectatorStore = create((set, get) => ({
  roomId: null,
  roomDoc: null,
  currentRound: 1,
  roundResolved: false,
  roomUnsub: null,
  movesUnsub: null,
  countdownInterval: null,
  countdownStarted: false,

  setRoomId: (id) => set({ roomId: id }),
  setRoomDoc: (doc) => set({ roomDoc: doc }),
  setCurrentRound: (r) => set({ currentRound: r }),
  setRoundResolved: (val) => set({ roundResolved: val }),
  setRoomUnsub: (fn) => set({ roomUnsub: fn }),
  setMovesUnsub: (fn) => set({ movesUnsub: fn }),
  setCountdownInterval: (id) => set({ countdownInterval: id }),
  setCountdownStarted: (val) => set({ countdownStarted: val }),

  clearCountdown: () => {
    const { countdownInterval } = get();
    if (countdownInterval) clearInterval(countdownInterval);
    set({ countdownInterval: null, countdownStarted: false });
  },

  resetRound: () =>
    set({
      roundResolved: false,
      countdownStarted: false,
    }),

  leave: () => {
    const { roomUnsub, movesUnsub, countdownInterval } = get();
    if (roomUnsub) roomUnsub();
    if (movesUnsub) movesUnsub();
    if (countdownInterval) clearInterval(countdownInterval);
    set({
      roomId: null,
      roomDoc: null,
      currentRound: 1,
      roundResolved: false,
      roomUnsub: null,
      movesUnsub: null,
      countdownInterval: null,
      countdownStarted: false,
    });
  },
}));
