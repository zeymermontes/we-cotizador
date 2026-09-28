import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import logo from '../assets/logo.png';

type Mode = 'password' | 'magic_link';

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [linkSent, setLinkSent] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (mode === 'magic_link') {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/admin/eventos` },
      });
      setLoading(false);
      if (otpError) return setError(otpError.message);
      setLinkSent(true);
      return;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
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
        <p className="text-muted" style={{ marginBottom: 'var(--space-lg)' }}>{t('admin.login')}</p>

        <div className="segmented" style={{ marginBottom: 'var(--space-lg)' }}>
          <button
            type="button"
            className={mode === 'password' ? 'active' : ''}
            onClick={() => { setMode('password'); setLinkSent(false); setError(''); }}
          >
            {t('admin.password_login')}
          </button>
          <button
            type="button"
            className={mode === 'magic_link' ? 'active' : ''}
            onClick={() => { setMode('magic_link'); setError(''); }}
          >
            {t('admin.magic_link')}
          </button>
        </div>

        {linkSent ? (
          <p style={{ textAlign: 'left', fontSize: 'var(--text-sm)' }}>✉️ {t('admin.magic_link_sent')}</p>
        ) : (
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
              />
            </div>

            {mode === 'password' ? (
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
            ) : (
              <p className="text-muted text-sm" style={{ textAlign: 'left' }}>{t('admin.magic_link_hint')}</p>
            )}

            {error && (
              <div style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', textAlign: 'left' }}>
                {error}
              </div>
            )}

            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? t('common.loading') : mode === 'password' ? t('admin.login') : t('admin.send_link')} →
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
