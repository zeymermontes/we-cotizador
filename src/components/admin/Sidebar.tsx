import { NavLink } from 'react-router-dom';
import logo from '../../assets/logo.png';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  onLogout: () => void;
  /** Equipo We.Page: ve todo. Un admin de evento solo ve "Eventos". */
  isSuper: boolean;
}

export default function Sidebar({ isOpen, onClose, onLogout, isSuper }: SidebarProps) {
  const item = ({ isActive }: { isActive: boolean }) => `admin-nav-item ${isActive ? 'active' : ''}`;

  return (
    <aside className={`admin-sidebar ${isOpen ? 'open' : ''}`}>
      <div className="admin-sidebar-logo" style={{ textAlign: 'center', position: 'relative' }}>
        <img src={logo} alt="We.Page Logo" style={{ height: 40, width: 'auto' }} />
        <button
          className="admin-sidebar-close no-desktop"
          onClick={onClose}
          aria-label="Cerrar menú"
        >
          ✕
        </button>
      </div>

      <nav className="admin-nav">
        {isSuper && (
          <>
            <NavLink to="/admin" end className={item} onClick={onClose}>
              <span>📊</span> Panel principal
            </NavLink>
            <NavLink to="/admin/cotizaciones" className={item} onClick={onClose}>
              <span>📋</span> Cotizaciones
            </NavLink>
            <NavLink to="/admin/clientes" className={item} onClick={onClose}>
              <span>👥</span> Clientes
            </NavLink>
            <NavLink to="/admin/pagos" className={item} onClick={onClose}>
              <span>💰</span> Pagos
            </NavLink>
            <NavLink to="/admin/rotulado" className={item} onClick={onClose}>
              <span>🏷️</span> Rotulado
            </NavLink>

            <div style={{ margin: 'var(--space-md) var(--space-sm)', height: 1, background: 'var(--border-subtle)' }}></div>
            <p style={{ padding: '0 var(--space-md)', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 8 }}>REGISTRO DE EVENTOS</p>
          </>
        )}

        <NavLink to="/admin/eventos" className={item} onClick={onClose}>
          <span>🎟️</span> Eventos
        </NavLink>

        {isSuper && (
          <>
            <div style={{ margin: 'var(--space-md) var(--space-sm)', height: 1, background: 'var(--border-subtle)' }}></div>
            <p style={{ padding: '0 var(--space-md)', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 8 }}>OTROS SERVICIOS</p>

            <a
              href="https://we-page-confirm.web.app/super-admin"
              target="_blank"
              rel="noopener noreferrer"
              className="admin-nav-item"
            >
              <span>✅</span> We Confirm
            </a>

            <a
              href="https://we-bot-server.onrender.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="admin-nav-item"
            >
              <span>🤖</span> We Bot
            </a>
          </>
        )}
      </nav>

      <div style={{ padding: '0 var(--space-sm)', marginTop: 'auto' }}>
        <button className="admin-nav-item" onClick={onLogout} style={{ color: 'var(--color-error)' }}>
          <span>🚪</span> Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
