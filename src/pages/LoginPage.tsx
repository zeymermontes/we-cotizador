import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import logo from '../assets/logo.png';
import { eventsBase } from '../lib/paths';

/** admin: equipo We.Page (/admin). panel: clientes (panel.we.page). */
export default function LoginPage({ variant = 'admin' }: { variant?: 'admin' | 'panel' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }
    navigate(variant === 'panel' ? eventsBase() : '/admin');
  };

  return (
    <div className="login-page">
      <div className="login-card glass-card">
        <div className="form-logo" style={{ justifyContent: 'center', marginBottom: 'var(--space-md)' }}>
          <img src={logo} alt="We.Page Logo" style={{ height: 60 }} />
        </div>
        {variant === 'panel' && <h1 style={{ fontSize: 'var(--text-xl)', marginBottom: 4 }}>Panel de eventos</h1>}
        <p className="text-muted" style={{ marginBottom: 'var(--space-lg)' }}>{variant === 'panel' ? 'Entra con el correo y la contraseña que te dio el equipo We.Page.' : t('admin.login')}</p>

        <form className="login-form" onSubmit={handleLogin}>
          <div className="input-group">
            <label className="input-label">{t('admin.email')}</label>
            <input
              className="input-field"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@we.page"
              required
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="input-group">
            <label className="input-label">{t('admin.password')}</label>
            <input
              className="input-field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', textAlign: 'left' }}>
              {error}
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? t('common.loading') : t('admin.login')} →
          </button>
        </form>
      </div>
    </div>
  );
}
