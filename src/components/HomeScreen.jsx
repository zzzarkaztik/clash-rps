import { useState } from 'react';
import { useGameStore } from '../state';

export default function HomeScreen() {
  const [name, setName]   = useState('');
  const [error, setError] = useState('');
  const setScreen      = useGameStore((s) => s.setScreen);
  const setPlayerName  = useGameStore((s) => s.setPlayerName);

  function goToLobby() {
    const trimmed = name.trim();
    if (!trimmed) { setError('Enter your name first!'); return; }
    setPlayerName(trimmed);
    setScreen('lobby');
  }

  return (
    <div id="screen-home">
      <div className="card">
        <div className="card-title">Enter Arena</div>
        <div className="field">
          <label>Your Name</label>
          <input
            type="text"
            placeholder="Enter your name..."
            maxLength={16}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && goToLobby()}
          />
        </div>
        {error && <div className="message error">{error}</div>}
        <button className="btn btn-primary" onClick={goToLobby}>Continue →</button>
      </div>

      <div className="text-center mt-2" style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
        <button className="btn btn-ghost" style={{ width: 'auto' }} onClick={() => setScreen('spectate-join')}>👁 Watch</button>
        <button className="btn btn-ghost" style={{ width: 'auto' }} onClick={() => setScreen('admin-login')}>Admin ⚙️</button>
      </div>
    </div>
  );
}
