import { useState } from 'react';
import { useGameStore, useAdminStore } from '../state';
import { account } from '../appwrite';

export default function AdminLogin() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const setScreen  = useGameStore((s) => s.setScreen);
  const setSession = useAdminStore((s) => s.setSession);

  async function adminLogin() {
    if (!email || !password) { setError('Enter your email and password.'); return; }
    setLoading(true);
    setError('');
    try {
      try { await account.deleteSession('current'); } catch (_) {}
      const session = await account.createEmailPasswordSession(email, password);
      setSession(session);
      setPassword('');
      setScreen('admin-dashboard');
    } catch (e) {
      setError('Login failed: ' + (e.message || 'Invalid credentials'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div id="screen-admin-login">
      <div className="back-row">
        <button className="btn btn-ghost" onClick={() => setScreen('home')}>← Back</button>
      </div>

      <div className="card">
        <div className="card-title">Admin Login</div>

        <div className="field">
          <label>Email</label>
          <input
            type="email"
            placeholder="admin@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && adminLogin()}
          />
        </div>

        <div className="field">
          <label>Password</label>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && adminLogin()}
          />
        </div>

        {error && <div className="message error">{error}</div>}

        <button className="btn btn-admin" onClick={adminLogin} disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In →'}
        </button>
      </div>
    </div>
  );
}
