import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/useAuthStore';
import { useMikrotikStore } from './stores/useMikrotikStore';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import Plans from './pages/Plans';
import Payments from './pages/Payments';
import Network from './pages/Network';
import NodeDetail from './pages/NodeDetail';
import Security from './pages/Security';
import WanManager from './pages/WanManager';
import Mikrotik from './pages/Mikrotik';
import Alerts from './pages/Alerts';
import VPN from './pages/VPN';
import VPNSetup from './pages/VPNSetup';
import Settings from './pages/Settings';
import Onboarding from './pages/Onboarding';
import Setup from './pages/Setup';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

function MikrotikPoller({ children }: { children: React.ReactNode }) {
  const startPolling = useMikrotikStore(s => s.startPolling);

  useEffect(() => {
    const cleanup = startPolling();
    return cleanup;
  }, [startPolling]);

  return <>{children}</>;
}

function AuthInit({ children }: { children: React.ReactNode }) {
  const loading = useAuthStore(s => s.loading);
  const checkSession = useAuthStore(s => s.checkSession);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  if (loading) return null;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthInit>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/setup" element={
          <ProtectedRoute>
            <MikrotikPoller>
              <Setup />
            </MikrotikPoller>
          </ProtectedRoute>
        } />
        <Route path="/*" element={
          <ProtectedRoute>
            <MikrotikPoller>
              <Layout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/clientes" element={<Clients />} />
                  <Route path="/clientes/:id" element={<ClientDetail />} />
                  <Route path="/planes" element={<Plans />} />
                  <Route path="/pagos" element={<Payments />} />
                  <Route path="/red" element={<Network />} />
                  <Route path="/red/:id" element={<NodeDetail />} />
                  <Route path="/red/discover" element={<Navigate to="/red" replace />} />
                  <Route path="/red/wans" element={<WanManager />} />
                  <Route path="/seguridad" element={<Security />} />
                  <Route path="/mikrotik" element={<Mikrotik />} />
                  <Route path="/alertas" element={<Alerts />} />
                  <Route path="/vpn" element={<VPN />} />
                  <Route path="/vpn/setup" element={<VPNSetup />} />
                  <Route path="/ips" element={<Navigate to="/red" replace />} />
                  <Route path="/configuracion" element={<Settings />} />
                </Routes>
              </Layout>
            </MikrotikPoller>
          </ProtectedRoute>
        } />
      </Routes>
    </AuthInit>
  );
}
