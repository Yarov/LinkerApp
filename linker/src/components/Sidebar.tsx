import { memo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Network,
  Users,
  Package,
  CreditCard,
  Bell,
  Server,
  Settings,
  Shield,
  LogOut,
  Globe,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useMikrotikStore } from "@/stores/useMikrotikStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { useAppStore } from "@/stores/useAppStore";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  hasBadge?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: "PRINCIPAL",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "RED",
    items: [
      { href: "/red", label: "Topologia & IPs", icon: Network },
      { href: "/seguridad", label: "Seguridad", icon: Shield },
    ],
  },
  {
    label: "NEGOCIO",
    items: [
      { href: "/clientes", label: "Clientes", icon: Users },
      { href: "/planes", label: "Planes", icon: Package },
      { href: "/pagos", label: "Pagos", icon: CreditCard },
    ],
  },
  {
    label: "SISTEMA",
    items: [
      { href: "/mikrotik", label: "MikroTik", icon: Server },
      { href: "/vpn", label: "VPN", icon: Globe, hasBadge: true },
      { href: "/alertas", label: "Alertas", icon: Bell },
      { href: "/configuracion", label: "Configuracion", icon: Settings },
    ],
  },
];

export default memo(function Sidebar() {
  const location = useLocation();
  const pathname = location.pathname;
  const navigate = useNavigate();
  const vpnConnected = useMikrotikStore(s => s.vpnConnected);
  const logout = useAuthStore(s => s.logout);
  const sidebarPinned = useAppStore(s => s.sidebarPinned);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);

  const expanded = sidebarPinned;

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <aside
      className={`fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-[#e2e8f0] bg-white transition-all duration-200 ease-out ${
        expanded ? "w-[220px]" : "w-[64px]"
      }`}
    >
      {/* Logo + pin button */}
      <div className="flex h-[56px] items-center justify-between border-b border-[#e2e8f0] px-2">
        <div className="flex items-center gap-2">
          <div className="flex w-[48px] shrink-0 items-center justify-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#006fff] text-xs font-bold text-white shadow-md shadow-[#006fff]/20">
              LK
            </div>
          </div>
          {expanded && (
            <span className="text-base font-semibold tracking-tight text-[#0f172a]">
              Linker
            </span>
          )}
        </div>
        <button
          onClick={toggleSidebar}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[#94a3b8] transition-colors hover:bg-[#f5f7fa] hover:text-[#475569]"
          title={sidebarPinned ? "Colapsar menu" : "Expandir menu"}
        >
          {sidebarPinned ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2">
        {navSections.map((section, sectionIdx) => (
          <div key={section.label}>
            {sectionIdx > 0 && (
              <div className="mx-2 my-1.5 border-t border-[#f1f5f9]" />
            )}
            {expanded && (
              <div className="mb-0.5 px-2 pt-1">
                <span className="text-[9px] font-semibold uppercase tracking-widest text-[#cbd5e1]">
                  {section.label}
                </span>
              </div>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    title={!expanded ? item.label : undefined}
                    className={`relative flex items-center gap-2.5 rounded-lg px-0 py-2 text-[13px] font-medium transition-all duration-100 ${
                      isActive
                        ? "bg-[#eff6ff] text-[#006fff]"
                        : "text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0f172a]"
                    }`}
                  >
                    {isActive && (
                      <div className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#006fff]" />
                    )}
                    <div className="relative flex w-[48px] shrink-0 items-center justify-center">
                      <Icon className="h-[18px] w-[18px]" />
                      {item.hasBadge && (
                        <span
                          className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-[1.5px] border-white ${
                            vpnConnected
                              ? "bg-[#16a34a] animate-pulse"
                              : "bg-[#dc2626]"
                          }`}
                        />
                      )}
                    </div>
                    {expanded && (
                      <span className="truncate">{item.label}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="border-t border-[#f1f5f9] px-2 py-2">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-lg px-0 py-2 text-[13px] font-medium text-[#94a3b8] transition-all duration-100 hover:bg-red-50 hover:text-red-500"
        >
          <div className="flex w-[48px] shrink-0 items-center justify-center">
            <LogOut className="h-[18px] w-[18px]" />
          </div>
          {expanded && <span className="truncate">Cerrar sesion</span>}
        </button>
      </div>
    </aside>
  );
});
