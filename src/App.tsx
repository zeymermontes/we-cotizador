import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import CotizarPage from './pages/CotizarPage';
import LoginPage from './pages/LoginPage';
import AdminLayout from './pages/AdminLayout';
import DashboardPage from './pages/DashboardPage';
import QuotationsPage from './pages/QuotationsPage';
import QuotationDetailPage from './pages/QuotationDetailPage';
import ClientsPage from './pages/ClientsPage';
import PaymentsPage from './pages/PaymentsPage';
import type { ReactNode } from 'react';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) {
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

  if (!session) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public form */}
        <Route path="/cotizar" element={<CotizarPage />} />

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
          <Route index element={<DashboardPage />} />
          <Route path="cotizaciones" element={<QuotationsPage />} />
          <Route path="cotizaciones/:id" element={<QuotationDetailPage />} />
          <Route path="clientes" element={<ClientsPage />} />
          <Route path="pagos" element={<PaymentsPage />} />
        </Route>

        {/* Redirects */}
        <Route path="/" element={<Navigate to="/cotizar" replace />} />
        <Route path="*" element={<Navigate to="/cotizar" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
