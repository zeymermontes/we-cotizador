import { NavLink } from 'react-router-dom';
import logo from '../../assets/logo.png';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  onLogout: () => void;
}

export default function Sidebar({ isOpen, onClose, onLogout }: SidebarProps) {
  return (
    <aside className={`admin-sidebar ${isOpen ? 'open' : ''}`}>
      <div className="admin-sidebar-logo" style={{ textAlign: 'center', position: 'relative' }}>
        <img src={logo} alt="We.Page Logo" style={{ height: 40, width: 'auto' }} />
        {/* Mobile close button (X) */}
        <button 
          className="admin-sidebar-close no-desktop" 
          onClick={onClose}
          aria-label="Cerrar menú"
        >
          ✕
        </button>
      </div>

      <nav className="admin-nav">
        <NavLink
          to="/admin"
          end
          className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
          onClick={onClose}
        >
          <span>📊</span> Panel principal
        </NavLink>

        <NavLink
          to="/admin/cotizaciones"
          className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
          onClick={onClose}
        >
          <span>📋</span> Cotizaciones
        </NavLink>

        <NavLink
          to="/admin/clientes"
          className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
          onClick={onClose}
        >
          <span>👥</span> Clientes
        </NavLink>

        <NavLink
          to="/admin/pagos"
          className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
          onClick={onClose}
        >
          <span>💰</span> Pagos
        </NavLink>

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
      </nav>

      <div style={{ padding: '0 var(--space-sm)', marginTop: 'auto' }}>
        <button className="admin-nav-item" onClick={onLogout} style={{ color: 'var(--color-error)' }}>
          <span>🚪</span> Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
