import { useEffect, useRef } from "react";
import { Users, UserCheck, DollarSign, Wifi, WifiOff, AlertTriangle, RefreshCw, Activity, Bell, Server, Cpu, HardDrive, Clock, Rocket, ArrowRight, Package, Network, Shield, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import StatCard from "@/components/StatCard";
import Skeleton from "@/components/Skeleton";
import DashboardSkeleton from "@/components/skeletons/DashboardSkeleton";
import { useMikrotikStore } from "@/stores/useMikrotikStore";
import { useAppStore } from "@/stores/useAppStore";

type DashboardState = "welcome" | "setup" | "normal";

export default function DashboardPage() {
  const mikrotikConnected = useMikrotikStore(s => s.connected);
  const dashboard = useAppStore(s => s.dashboard);
  const dashboardLoaded = useAppStore(s => s.dashboardLoaded);
  const dashboardLoading = useAppStore(s => s.dashboardLoading);
  const dashboardError = useAppStore(s => s.dashboardError);
  const fetchDashboard = useAppStore(s => s.fetchDashboard);
  const invalidateDashboard = useAppStore(s => s.invalidateDashboard);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!dashboardLoaded && !dashboardLoading) fetchDashboard();
  }, [dashboardLoaded, dashboardLoading, fetchDashboard]);

  // Auto-refresh every 90s silently (no skeleton flash)
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        // Don't invalidate - just re-fetch in background
        // This updates data without showing skeleton
        fetchDashboard();
      }
    }, 90000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchDashboard]);

  const {
    totalClients, totalPlans, activeClients, monthlyRevenue,
    onlineNodes, totalNodes, recentPayments, unreadAlerts,
    mikrotikStatus, mikrotikLoaded, pppoeActive, pppoeConfigured,
    recentAlerts, lastUpdate,
  } = dashboard;

  const formatTimeAgo = (dateStr?: string) => { if (!dateStr) return ""; try { return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: es }); } catch { return ""; } };
  const cpuNum = parseInt((mikrotikStatus?.cpu ?? "0").replace("%", ""), 10) || 0;
  const memNum = parseInt((mikrotikStatus?.memory ?? "0").replace("%", ""), 10) || 0;

  // Determine dashboard state
  const dashboardState: DashboardState = (() => {
    if (!mikrotikConnected && totalClients === 0 && totalPlans === 0) return "welcome";
    if (totalClients === 0 || totalPlans === 0) return "setup";
    return "normal";
  })();

  const loading = dashboardLoading && !dashboardLoaded;
  const handleRefresh = () => { invalidateDashboard(); fetchDashboard(); };

  if (loading) return <DashboardSkeleton />;
  if (dashboardError) return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto h-10 w-10 text-[#dc2626]" />
        <p className="mt-4 text-sm text-[#dc2626]">{dashboardError}</p>
        <button onClick={handleRefresh} className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0057cc]">Reintentar</button>
      </div>
    </div>
  );

  // ── Welcome state: no MikroTik, no data ──
  if (dashboardState === "welcome") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">Bienvenido a Linker</h1>
          <p className="mt-1 text-sm text-[#475569]">Configura tu red WISP en minutos</p>
        </div>

        <div className="rounded-2xl border border-[#006fff]/20 bg-gradient-to-br from-[#eff6ff] via-white to-[#f0f9ff] p-8 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#006fff]/10">
              <Server className="h-8 w-8 text-[#006fff]" />
            </div>
            <h2 className="mt-5 text-xl font-semibold text-[#0f172a]">Conecta tu MikroTik</h2>
            <p className="mt-2 max-w-md text-sm text-[#475569]">
              Para comenzar, necesitas conectar Linker a tu router MikroTik. Ve a Configuracion para ingresar la IP, usuario y contrasena de tu equipo.
            </p>
            <div className="mt-6 flex gap-3">
              <Link
                to="/configuracion"
                className="flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 transition-colors hover:bg-[#0057cc]"
              >
                <Server className="h-4 w-4" />
                Conectar MikroTik
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>

        {/* Quick start steps */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#006fff]/10 text-sm font-bold text-[#006fff]">1</div>
              <div>
                <h3 className="text-sm font-semibold text-[#0f172a]">Conectar MikroTik</h3>
                <p className="mt-1 text-xs text-[#475569]">Ingresa los datos de conexion de tu router</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm opacity-60">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#94a3b8]/10 text-sm font-bold text-[#94a3b8]">2</div>
              <div>
                <h3 className="text-sm font-semibold text-[#475569]">Importar o crear planes</h3>
                <p className="mt-1 text-xs text-[#94a3b8]">Define los planes de velocidad que ofreces</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm opacity-60">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#94a3b8]/10 text-sm font-bold text-[#94a3b8]">3</div>
              <div>
                <h3 className="text-sm font-semibold text-[#475569]">Agregar clientes</h3>
                <p className="mt-1 text-xs text-[#94a3b8]">Importa desde MikroTik o registra manualmente</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Setup state: has MikroTik but missing plans or clients ──
  if (dashboardState === "setup") {
    const needsPppoe = mikrotikConnected && !pppoeConfigured;
    const needsPlans = totalPlans === 0;
    const needsClients = totalClients === 0 && totalPlans > 0;

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">Dashboard</h1>
            <p className="mt-1 text-sm text-[#475569]">Completa la configuracion de tu red</p>
          </div>
          {mikrotikConnected && (
            <div className="flex items-center gap-2 rounded-xl border border-[#16a34a]/20 bg-[#f0fdf4] px-3 py-1.5 text-xs text-[#16a34a]">
              <div className="h-1.5 w-1.5 rounded-full bg-[#16a34a] status-dot-online" />
              MikroTik conectado
            </div>
          )}
        </div>

        {/* Single primary CTA based on state */}
        {needsPppoe ? (
          <div className="rounded-2xl border border-[#f59e0b]/30 bg-gradient-to-r from-[#fffbeb] to-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#f59e0b]/10"><Rocket className="h-6 w-6 text-[#f59e0b]" /></div>
                <div>
                  <h3 className="text-base font-semibold text-[#0f172a]">Configura tu servidor PPPoE</h3>
                  <p className="mt-1 text-sm text-[#475569]">Tu MikroTik esta conectado pero no tiene un servidor PPPoE. Usa el wizard para configurarlo en minutos.</p>
                </div>
              </div>
              <Link to="/setup" className="flex shrink-0 items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 hover:bg-[#0057cc]">
                <Rocket className="h-4 w-4" />
                Configurar ahora
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        ) : needsPlans ? (
          <div className="rounded-2xl border border-[#006fff]/20 bg-gradient-to-r from-[#eff6ff] to-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#006fff]/10"><Package className="h-6 w-6 text-[#006fff]" /></div>
                <div>
                  <h3 className="text-base font-semibold text-[#0f172a]">Crea tus planes de velocidad</h3>
                  <p className="mt-1 text-sm text-[#475569]">
                    {mikrotikConnected
                      ? "Importa los perfiles PPPoE de tu MikroTik como planes, o crealos manualmente."
                      : "Define los planes de internet que ofreces a tus clientes."
                    }
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                {mikrotikConnected && (
                  <Link to="/onboarding" className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 hover:bg-[#0057cc]">
                    Importar de MikroTik
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
                <Link to="/planes" className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-5 py-2.5 text-sm font-medium text-[#475569] hover:bg-[#f5f7fa]">
                  Crear manualmente
                </Link>
              </div>
            </div>
          </div>
        ) : needsClients ? (
          <div className="rounded-2xl border border-[#006fff]/20 bg-gradient-to-r from-[#eff6ff] to-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#006fff]/10"><Users className="h-6 w-6 text-[#006fff]" /></div>
                <div>
                  <h3 className="text-base font-semibold text-[#0f172a]">Agrega tu primer cliente</h3>
                  <p className="mt-1 text-sm text-[#475569]">
                    {mikrotikConnected
                      ? "Importa los secretos PPPoE de tu MikroTik como clientes, o registra uno manualmente."
                      : "Ya tienes planes creados. Ahora registra a tus clientes."
                    }
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                {mikrotikConnected && (
                  <Link to="/onboarding" className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 hover:bg-[#0057cc]">
                    Importar de MikroTik
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
                <Link to="/clientes" className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-5 py-2.5 text-sm font-medium text-[#475569] hover:bg-[#f5f7fa]">
                  Crear manualmente
                </Link>
              </div>
            </div>
          </div>
        ) : null}

        {/* Progress steps */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className={`rounded-2xl border p-5 shadow-sm ${mikrotikConnected ? "border-[#16a34a]/20 bg-[#f0fdf4]" : "border-[#e2e8f0] bg-white"}`}>
            <div className="flex items-start gap-3">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${mikrotikConnected ? "bg-[#16a34a]/10 text-[#16a34a]" : "bg-[#006fff]/10 text-[#006fff]"}`}>
                {mikrotikConnected ? <Shield className="h-4 w-4" /> : "1"}
              </div>
              <div>
                <h3 className={`text-sm font-semibold ${mikrotikConnected ? "text-[#16a34a]" : "text-[#0f172a]"}`}>
                  {mikrotikConnected ? "MikroTik conectado" : "Conectar MikroTik"}
                </h3>
                <p className="mt-1 text-xs text-[#475569]">
                  {mikrotikConnected && mikrotikStatus ? `${mikrotikStatus.board} - RouterOS ${mikrotikStatus.version}` : "Router accesible"}
                </p>
              </div>
            </div>
          </div>
          <div className={`rounded-2xl border p-5 shadow-sm ${totalPlans > 0 ? "border-[#16a34a]/20 bg-[#f0fdf4]" : "border-[#e2e8f0] bg-white"}`}>
            <div className="flex items-start gap-3">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${totalPlans > 0 ? "bg-[#16a34a]/10 text-[#16a34a]" : "bg-[#94a3b8]/10 text-[#94a3b8]"}`}>
                {totalPlans > 0 ? <Shield className="h-4 w-4" /> : "2"}
              </div>
              <div>
                <h3 className={`text-sm font-semibold ${totalPlans > 0 ? "text-[#16a34a]" : "text-[#475569]"}`}>
                  {totalPlans > 0 ? `${totalPlans} plan${totalPlans !== 1 ? "es" : ""} creado${totalPlans !== 1 ? "s" : ""}` : "Crear planes"}
                </h3>
                <p className="mt-1 text-xs text-[#94a3b8]">Planes de velocidad para tus clientes</p>
              </div>
            </div>
          </div>
          <div className={`rounded-2xl border p-5 shadow-sm ${totalClients > 0 ? "border-[#16a34a]/20 bg-[#f0fdf4]" : "border-[#e2e8f0] bg-white"}`}>
            <div className="flex items-start gap-3">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${totalClients > 0 ? "bg-[#16a34a]/10 text-[#16a34a]" : "bg-[#94a3b8]/10 text-[#94a3b8]"}`}>
                {totalClients > 0 ? <Shield className="h-4 w-4" /> : "3"}
              </div>
              <div>
                <h3 className={`text-sm font-semibold ${totalClients > 0 ? "text-[#16a34a]" : "text-[#475569]"}`}>
                  {totalClients > 0 ? `${totalClients} cliente${totalClients !== 1 ? "s" : ""}` : "Agregar clientes"}
                </h3>
                <p className="mt-1 text-xs text-[#94a3b8]">Registra a tus suscriptores</p>
              </div>
            </div>
          </div>
        </div>

        {/* Still show system status if MikroTik is connected */}
        {mikrotikConnected && mikrotikStatus && (
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center gap-2"><Server className="h-4 w-4 text-[#006fff]" /><h2 className="text-base font-semibold tracking-tight text-[#0f172a]">Estado del Sistema</h2></div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-xl bg-[#f5f7fa] px-4 py-3"><div className="flex items-center gap-2 text-xs text-[#475569]"><Cpu className="h-3.5 w-3.5" />CPU</div><span className="text-sm font-mono font-medium text-[#0f172a]">{mikrotikStatus.cpu}</span></div>
              <div className="rounded-xl bg-[#f5f7fa] px-4 py-3"><div className="flex items-center gap-2 text-xs text-[#475569]"><HardDrive className="h-3.5 w-3.5" />Memoria</div><span className="text-sm font-mono font-medium text-[#0f172a]">{mikrotikStatus.memory}</span></div>
              <div className="rounded-xl bg-[#f5f7fa] px-4 py-3"><div className="flex items-center gap-2 text-xs text-[#475569]"><Clock className="h-3.5 w-3.5" />Uptime</div><span className="text-sm font-mono font-medium text-[#0f172a]">{mikrotikStatus.uptime}</span></div>
              <div className="rounded-xl bg-[#f5f7fa] px-4 py-3"><div className="flex items-center gap-2 text-xs text-[#475569]"><Wifi className="h-3.5 w-3.5" />PPPoE</div><span className="text-sm font-bold text-[#006fff]">{pppoeActive}</span></div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Normal state: has clients and plans ──
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">Dashboard</h1>
          <p className="mt-1 text-sm text-[#475569]">Vista general de la red</p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdate && <span className="text-xs text-[#94a3b8]">Ultima actualizacion: {formatDistanceToNow(lastUpdate, { addSuffix: false, locale: es }).replace("menos de un minuto", "ahora")} </span>}
          <div className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs text-[#94a3b8]"><div className="h-1.5 w-1.5 rounded-full bg-[#16a34a] status-dot-online" />Auto-refresco 60s</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Clientes" value={totalClients} icon={Users} color="blue" />
        <StatCard label="Clientes Activos" value={activeClients} icon={UserCheck} color="green" />
        <StatCard label="Ingresos del Mes" value={`$${Number(monthlyRevenue).toLocaleString("es-MX")}`} icon={DollarSign} color="purple" />
        <StatCard label="PPPoE Activos" value={mikrotikConnected ? pppoeActive : "-"} icon={Wifi} color="cyan" />
      </div>

      {/* Quick actions row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link to="/clientes" className="flex items-center gap-3 rounded-xl border border-[#e2e8f0] bg-white px-4 py-3 text-sm font-medium text-[#475569] shadow-sm transition-all hover:border-[#006fff]/30 hover:bg-[#eff6ff] hover:text-[#006fff]">
          <Users className="h-4 w-4" />
          Ver clientes
        </Link>
        <Link to="/pagos" className="flex items-center gap-3 rounded-xl border border-[#e2e8f0] bg-white px-4 py-3 text-sm font-medium text-[#475569] shadow-sm transition-all hover:border-[#16a34a]/30 hover:bg-[#f0fdf4] hover:text-[#16a34a]">
          <DollarSign className="h-4 w-4" />
          Registrar pago
        </Link>
        <Link to="/red" className="flex items-center gap-3 rounded-xl border border-[#e2e8f0] bg-white px-4 py-3 text-sm font-medium text-[#475569] shadow-sm transition-all hover:border-[#8b5cf6]/30 hover:bg-[#f5f3ff] hover:text-[#8b5cf6]">
          <Network className="h-4 w-4" />
          Topologia
        </Link>
        <Link to="/mikrotik" className="flex items-center gap-3 rounded-xl border border-[#e2e8f0] bg-white px-4 py-3 text-sm font-medium text-[#475569] shadow-sm transition-all hover:border-[#f59e0b]/30 hover:bg-[#fffbeb] hover:text-[#f59e0b]">
          <Server className="h-4 w-4" />
          MikroTik
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm lg:col-span-3">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-[#006fff]" /><h2 className="text-base font-semibold tracking-tight text-[#0f172a]">Estado de Red</h2></div>
            <div className="flex items-center gap-3"><span className="text-xs text-[#94a3b8]">{onlineNodes}/{totalNodes} nodos en linea</span><Link to="/red" className="rounded-lg px-2.5 py-1 text-xs font-medium text-[#006fff] transition-colors hover:bg-[#eff6ff]">Ver todo</Link></div>
          </div>
          {totalNodes === 0 ? <p className="py-8 text-center text-sm text-[#94a3b8]">No hay nodos registrados</p> : (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <span className="text-sm text-[#475569]">Nodos en linea</span>
                <span className="text-sm font-bold text-[#16a34a]">{onlineNodes}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <span className="text-sm text-[#475569]">Nodos fuera de linea</span>
                <span className="text-sm font-bold text-[#dc2626]">{totalNodes - onlineNodes}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <span className="text-sm text-[#475569]">Alertas sin leer</span>
                <span className="text-sm font-bold text-[#f59e0b]">{unreadAlerts}</span>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-5 flex items-center gap-2"><Server className="h-4 w-4 text-[#006fff]" /><h2 className="text-base font-semibold tracking-tight text-[#0f172a]">Estado del Sistema</h2></div>
          {mikrotikStatus ? (
            <div className="space-y-5">
              <div><div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2 text-xs text-[#475569]"><Cpu className="h-3.5 w-3.5" />CPU</div><span className="text-xs font-mono font-medium text-[#0f172a]">{mikrotikStatus.cpu ?? "0%"}</span></div><div className="h-2 overflow-hidden rounded-full bg-[#e2e8f0]"><div className={`h-full rounded-full transition-all duration-500 ${cpuNum > 80 ? "bg-gradient-to-r from-[#dc2626] to-[#ef4444]" : cpuNum > 50 ? "bg-gradient-to-r from-[#f59e0b] to-[#fbbf24]" : "bg-gradient-to-r from-[#16a34a] to-[#4ade80]"}`} style={{ width: `${cpuNum}%` }} /></div></div>
              <div><div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2 text-xs text-[#475569]"><HardDrive className="h-3.5 w-3.5" />Memoria</div><span className="text-xs font-mono font-medium text-[#0f172a]">{mikrotikStatus.memory ?? "0%"}</span></div><div className="h-2 overflow-hidden rounded-full bg-[#e2e8f0]"><div className={`h-full rounded-full transition-all duration-500 ${memNum > 80 ? "bg-gradient-to-r from-[#dc2626] to-[#ef4444]" : memNum > 50 ? "bg-gradient-to-r from-[#f59e0b] to-[#fbbf24]" : "bg-gradient-to-r from-[#16a34a] to-[#4ade80]"}`} style={{ width: `${memNum}%` }} /></div></div>
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3"><div className="flex items-center gap-2 text-xs text-[#475569]"><Clock className="h-3.5 w-3.5" />Uptime</div><span className="text-xs font-mono font-medium text-[#0f172a]">{mikrotikStatus.uptime ?? "-"}</span></div>
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3"><div className="flex items-center gap-2 text-xs text-[#475569]"><Wifi className="h-3.5 w-3.5" />Conexiones PPPoE</div><span className="text-sm font-bold text-[#006fff]">{pppoeActive}</span></div>
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3"><span className="text-xs text-[#475569]">RouterOS</span><span className="text-xs font-mono text-[#94a3b8]">{mikrotikStatus.version ?? "-"}</span></div>
            </div>
          ) : !mikrotikLoaded ? (
            <div className="space-y-5">
              <div><div className="mb-2 flex items-center justify-between"><Skeleton className="h-3 w-12" /><Skeleton className="h-3 w-8" /></div><Skeleton className="h-2 w-full rounded-full" /></div>
              <div><div className="mb-2 flex items-center justify-between"><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-8" /></div><Skeleton className="h-2 w-full rounded-full" /></div>
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3"><Skeleton className="h-4 w-16" /><Skeleton className="h-4 w-24" /></div>)}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8"><Server className="h-8 w-8 text-[#94a3b8]" /><p className="mt-3 text-xs text-[#94a3b8]">Sin conexion a MikroTik</p><button onClick={handleRefresh} className="mt-3 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[#006fff] transition-colors hover:bg-[#eff6ff]"><RefreshCw className="h-3 w-3" />Reintentar</button></div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-[#16a34a]" /><h2 className="text-base font-semibold tracking-tight text-[#0f172a]">Actividad Reciente</h2></div><Link to="/pagos" className="rounded-lg px-2.5 py-1 text-xs font-medium text-[#006fff] transition-colors hover:bg-[#eff6ff]">Ver todo</Link></div>
          <div className="space-y-1">
            {(recentPayments ?? []).length === 0 ? <p className="py-8 text-center text-sm text-[#94a3b8]">No hay actividad reciente</p> : (recentPayments ?? []).slice(0, 5).map((payment, idx) => (
              <div key={payment?.id ?? idx} className="flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200 hover:bg-[#f8f9fb]">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f0fdf4]"><DollarSign className="h-4 w-4 text-[#16a34a]" /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm text-[#0f172a]"><span className="font-medium">${(payment?.amount ?? 0).toLocaleString("es-MX")}</span><span className="text-[#475569]"> {"\u2014"} {payment?.client_name ?? "Cliente"}</span></p><p className="mt-0.5 text-xs text-[#94a3b8]">{formatTimeAgo(payment?.paid_at ?? undefined)}</p></div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-2"><Bell className="h-4 w-4 text-[#f59e0b]" /><h2 className="text-base font-semibold tracking-tight text-[#0f172a]">Alertas</h2>{unreadAlerts > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#dc2626] px-1.5 text-[10px] font-bold text-white">{unreadAlerts}</span>}</div><Link to="/alertas" className="rounded-lg px-2.5 py-1 text-xs font-medium text-[#006fff] transition-colors hover:bg-[#eff6ff]">Ver todas</Link></div>
          <div className="space-y-1">
            {recentAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <ShieldCheck className="h-8 w-8 text-[#16a34a]" />
                <p className="mt-3 text-xs text-[#16a34a] font-medium">Todo esta funcionando correctamente</p>
              </div>
            ) : (
              <div className="space-y-1">
                {recentAlerts.slice(0, 3).map(alert => (
                  <div key={alert.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-200 hover:bg-[#f8f9fb]">
                    <div className={`h-2 w-2 shrink-0 rounded-full ${alert.type === "NODE_DOWN" ? "bg-[#dc2626]" : alert.type === "NODE_UP" ? "bg-[#16a34a]" : "bg-[#f59e0b]"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-[#0f172a]">
                        <span className="font-medium">{alert.node_name || "Sistema"}</span>
                        <span className="text-[#475569]"> - {alert.message}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-[#94a3b8]">{formatTimeAgo(alert.created_at)}</p>
                    </div>
                    {alert.type === "NODE_DOWN" ? <WifiOff className="h-4 w-4 shrink-0 text-[#dc2626]" /> : <Wifi className="h-4 w-4 shrink-0 text-[#16a34a]" />}
                  </div>
                ))}
                {unreadAlerts > 3 && (
                  <Link to="/alertas" className="block rounded-lg px-3 py-2 text-center text-xs font-medium text-[#006fff] hover:bg-[#eff6ff]">
                    Ver {unreadAlerts - 3} alerta{unreadAlerts - 3 !== 1 ? "s" : ""} mas
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
