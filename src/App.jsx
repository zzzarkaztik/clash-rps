import { useEffect } from "react";
import { useGameStore, useAdminStore } from "./state";
import { account } from "./appwrite";

import HomeScreen from "./components/HomeScreen";
import LobbyScreen from "./components/LobbyScreen";
import WaitingRoom from "./components/WaitingRoom";
import GameScreen from "./components/GameScreen";
import SpectateJoin from "./components/SpectateJoin";
import PublicSpectate from "./components/PublicSpectate";
import AdminLogin from "./components/AdminLogin";
import AdminDashboard from "./components/AdminDashboard";
import AdminSpectate from "./components/AdminSpectate";
import ForceEndDialog from "./components/ForceEndDialog";
import DashForceEndDialog from "./components/DashForceEndDialog";

export default function App() {
  const screen = useGameStore((s) => s.screen);
  const setAdminSession = useAdminStore((s) => s.setSession);

  // Check existing admin session on mount
  useEffect(() => {
    account
      .get()
      .then((user) => setAdminSession(user))
      .catch(() => setAdminSession(null));
  }, []);

  // Auto-fill join code from URL e.g. /clash-rps/XK9A
  useEffect(() => {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && /^[A-Z0-9]{4}$/i.test(last)) {
      // Set a flag that LobbyScreen will pick up via useGameStore
      useGameStore.setState({ urlCode: last.toUpperCase() });
    }
  }, []);

  const screens = {
    home: <HomeScreen />,
    lobby: <LobbyScreen />,
    waiting: <WaitingRoom />,
    game: <GameScreen />,
    "spectate-join": <SpectateJoin />,
    "public-spectate": <PublicSpectate />,
    "admin-login": <AdminLogin />,
    "admin-dashboard": <AdminDashboard />,
    "admin-spectate": <AdminSpectate />,
  };

  return (
    <div className="app">
      <header>
        <div className="logo">CLASH</div>
        <div className="tagline">Rock · Paper · Scissors · Multiplayer</div>
      </header>

      {screens[screen] ?? <HomeScreen />}

      {/* Global dialogs — rendered outside screen flow so they overlay everything */}
      <ForceEndDialog />
      <DashForceEndDialog />
    </div>
  );
}
