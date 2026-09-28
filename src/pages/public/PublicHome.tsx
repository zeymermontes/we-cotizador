import BrandedShell, { ShellMessage } from '../../components/public/BrandedShell';

/** Portada neutra cuando alguien entra al subdominio sin un evento en la URL. */
export default function PublicHome({ kind }: { kind: 'registro' | 'acceso' }) {
  return (
    <BrandedShell event={null} title="We.Page">
      <ShellMessage
        title={kind === 'registro' ? 'Registro de eventos' : 'Control de acceso'}
        text="Usa el enlace que te compartieron los organizadores."
      />
      <a href="https://we.page" className="branded-btn" style={{ marginTop: 16, textDecoration: 'none' }}>we.page</a>
    </BrandedShell>
  );
}
