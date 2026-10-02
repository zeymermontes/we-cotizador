import { Outlet, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { eventsBase, loginPath } from '../lib/paths';
import logo from '../assets/logo.png';

/** Marco del panel de clientes: logo, quién está dentro y salir. Sin menú del equipo. */
export default function PanelLayout() {
  const { profile, session, signOut, loading } = useAuth();
  const navigate = useNavigate();

  const logout = async () => {
    await signOut();
    navigate(loginPath());
  };

  if (loading) {
    return (
      <div className="panel-splash">
        <img src={logo} alt="We.Page" style={{ height: 40 }} />
      </div>
    );
  }

  return (
    <div className="panel-layout">
      <header className="panel-header">
        <Link to={eventsBase()} className="panel-brand">
          <img src={logo} alt="We.Page" />
          <span>Panel de eventos</span>
        </Link>
        <div className="panel-user">
          <span className="panel-user-name">{profile?.full_name || session?.user.email}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={logout}>Salir</button>
        </div>
      </header>
      <main className="panel-main">
        <Outlet />
      </main>
    </div>
  );
}
