import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/i18n';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#c9a96e',
        fontFamily: "'Playfair Display', serif",
        fontSize: '1.5rem',
        fontStyle: 'italic',
      }}>
        We.Page
      </div>
    }>
      <App />
    </Suspense>
  </StrictMode>
);
