import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import logo from '../assets/logo.png';

export default function AdminLayout() {
  const { signOut, loading } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate('/admin/login');
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-primary)',
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--text-xl)',
        fontStyle: 'italic',
      }}>
        <img src={logo} alt="We.Page Logo" style={{ height: 40 }} />
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-logo" style={{ textAlign: 'center' }}>
          <img src={logo} alt="We.Page Logo" style={{ height: 40, width: 'auto' }} />
        </div>

        <nav className="admin-nav">
          <NavLink
            to="/admin"
            end
            className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
          >
            <span>📊</span> Panel principal
          </NavLink>

          <NavLink
            to="/admin/cotizaciones"
            className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
          >
            <span>📋</span> Cotizaciones
          </NavLink>

          <NavLink
            to="/admin/clientes"
            className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
          >
            <span>👥</span> Clientes
          </NavLink>

          <NavLink
            to="/admin/pagos"
            className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
          >
            <span>💰</span> Pagos
          </NavLink>
        </nav>

        <div style={{ padding: '0 var(--space-sm)', marginTop: 'auto' }}>
          <button className="admin-nav-item" onClick={handleLogout} style={{ color: 'var(--color-error)' }}>
            <span>🚪</span> Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
