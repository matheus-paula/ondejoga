import { useEffect, useState } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { LayoutProvider } from './context/LayoutContext';
import { DashboardView } from './views/Dashboard';
import { SettingsView } from './views/Settings';
import { Admin } from './views/Admin';

/** Roteamento interno minúsculo via `window.location.hash` (sem biblioteca). */
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHashRoute();

  let view = <DashboardView />;
  if (hash.startsWith('#/admin')) view = <Admin />;
  else if (hash.startsWith('#/configuracoes')) view = <SettingsView />;

  return (
    <ThemeProvider>
      <AuthProvider>
        <LayoutProvider>{view}</LayoutProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
