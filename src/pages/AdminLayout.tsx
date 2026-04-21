import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import logo from '../assets/logo.png';
import Sidebar from '../components/admin/Sidebar';

export default function AdminLayout() {
  const { signOut, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Close sidebar on navigation in mobile
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await signOut();
    navigate('/admin/login');
  };

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  const closeSidebar = () => setIsSidebarOpen(false);

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
    <div className={`admin-layout ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      {/* Mobile Header */}
      <header className="admin-mobile-header no-desktop">
        <button className="hamburger-btn" onClick={toggleSidebar} aria-label="Abrir menú">
          <div className="hamburger-line"></div>
          <div className="hamburger-line"></div>
          <div className="hamburger-line"></div>
        </button>
        <img src={logo} alt="We.Page Logo" style={{ height: 32 }} />
        <div style={{ width: 44 }}></div> {/* Spacer for centering the logo */}
      </header>

      {/* Backdrop for mobile drawer */}
      <div 
        className={`admin-sidebar-backdrop no-desktop ${isSidebarOpen ? 'visible' : ''}`} 
        onClick={closeSidebar}
      ></div>

      <Sidebar 
        isOpen={isSidebarOpen} 
        onClose={closeSidebar} 
        onLogout={handleLogout} 
      />

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
