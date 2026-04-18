import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import logo from '../assets/logo.png';

export default function LoginPage() {
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

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    navigate('/admin');
  };

  return (
    <div className="login-page">
      <div className="login-card glass-card">
        <div className="form-logo" style={{ justifyContent: 'center', marginBottom: 'var(--space-md)' }}>
          <img src={logo} alt="We.Page Logo" style={{ height: 60 }} />
        </div>
        <p className="text-muted" style={{ marginBottom: 'var(--space-xl)' }}>{t('admin.login')}</p>

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
            />
          </div>

          {error && (
            <div style={{
              color: 'var(--color-error)',
              fontSize: 'var(--text-sm)',
              textAlign: 'left',
            }}>
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
