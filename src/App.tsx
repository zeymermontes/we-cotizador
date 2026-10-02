import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { getAppMode, panelUrl } from './lib/host';
import { loginPath } from './lib/paths';
import PanelLayout from './pages/PanelLayout';
import CotizarPage from './pages/CotizarPage';
import LoginPage from './pages/LoginPage';
import AdminLayout from './pages/AdminLayout';
import DashboardPage from './pages/DashboardPage';
import QuotationsPage from './pages/QuotationsPage';
import QuotationDetailPage from './pages/QuotationDetailPage';
import ClientsPage from './pages/ClientsPage';
import PaymentsPage from './pages/PaymentsPage';
import RotuladoPage from './pages/RotuladoPage';
import RotuladoDetailPage from './pages/RotuladoDetailPage';
import EventsPage from './pages/eventos/EventsPage';
import EventDetailPage from './pages/eventos/EventDetailPage';
import RegistroPage from './pages/public/RegistroPage';
import AccesoPage from './pages/public/AccesoPage';
import PublicHome from './pages/public/PublicHome';
import type { ReactNode } from 'react';

function Splash() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#BBEBE8',
      fontFamily: "'Playfair Display', serif",
      fontSize: '1.5rem',
      fontStyle: 'italic',
      background: '#0a0a0f',
    }}>
      We.Page
    </div>
  );
}

/** Admin global: solo el equipo. Un admin de evento con sesión va a su panel. */
function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, profile, isSuper, loading } = useAuth();
  if (loading) return <Splash />;
  if (!session) return <Navigate to="/admin/login" replace />;
  if (profile && !isSuper) {
    window.location.replace(panelUrl());
    return <Splash />;
  }
  return <>{children}</>;
}

/** Panel de clientes: cualquier usuario con sesión (el equipo también, para dar soporte). */
function PanelProtected({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <Splash />;
  if (!session) return <Navigate to={loginPath()} replace />;
  return <>{children}</>;
}

/** Rutas del panel, relativas: se montan en la raíz de panel.we.page y bajo /panel en local. */
function PanelRoutes() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage variant="panel" />} />
      <Route element={<PanelProtected><PanelLayout /></PanelProtected>}>
        <Route index element={<Navigate to="eventos" replace />} />
        <Route path="eventos" element={<EventsPage />} />
        <Route path="eventos/:id" element={<EventDetailPage />} />
        <Route path="eventos/:id/:tab" element={<EventDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="eventos" replace />} />
    </Routes>
  );
}

/** Solo el equipo We.Page. Un admin de evento aterriza en sus eventos. */
function SuperRoute({ children }: { children: ReactNode }) {
  const { isSuper, loading } = useAuth();
  if (loading) return <Splash />;
  if (!isSuper) return <Navigate to="/admin/eventos" replace />;
  return <>{children}</>;
}

function AdminApp() {
  return (
    <Routes>
      {/* Public form */}
      <Route path="/cotizar" element={<CotizarPage />} />

      {/* Vistas públicas de eventos, para probar en local sin subdominios */}
      <Route path="/r/:slug" element={<RegistroPage />} />
      <Route path="/s/:slug" element={<AccesoPage />} />
      <Route path="/panel/*" element={<PanelRoutes />} />

      {/* Admin login */}
      <Route path="/admin/login" element={<LoginPage />} />

      {/* Protected admin routes */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<SuperRoute><DashboardPage /></SuperRoute>} />
        <Route path="cotizaciones" element={<SuperRoute><QuotationsPage /></SuperRoute>} />
        <Route path="cotizaciones/:id" element={<SuperRoute><QuotationDetailPage /></SuperRoute>} />
        <Route path="clientes" element={<SuperRoute><ClientsPage /></SuperRoute>} />
        <Route path="pagos" element={<SuperRoute><PaymentsPage /></SuperRoute>} />
        <Route path="rotulado" element={<SuperRoute><RotuladoPage /></SuperRoute>} />
        <Route path="rotulado/:id" element={<SuperRoute><RotuladoDetailPage /></SuperRoute>} />
        <Route path="eventos" element={<EventsPage />} />
        <Route path="eventos/:id" element={<EventDetailPage />} />
        <Route path="eventos/:id/:tab" element={<EventDetailPage />} />
      </Route>

      {/* Redirects */}
      <Route path="/" element={<Navigate to="/cotizar" replace />} />
      <Route path="*" element={<Navigate to="/cotizar" replace />} />
    </Routes>
  );
}

function RegistroApp() {
  return (
    <Routes>
      <Route path="/:slug" element={<RegistroPage />} />
      <Route path="*" element={<PublicHome kind="registro" />} />
    </Routes>
  );
}

function AccesoApp() {
  return (
    <Routes>
      <Route path="/:slug" element={<AccesoPage />} />
      <Route path="*" element={<PublicHome kind="acceso" />} />
    </Routes>
  );
}

function App() {
  const mode = getAppMode();
  return (
    <BrowserRouter>
      {mode === 'registro' ? <RegistroApp /> : mode === 'acceso' ? <AccesoApp /> : mode === 'panel' ? <PanelRoutes /> : <AdminApp />}
    </BrowserRouter>
  );
}

export default App;
