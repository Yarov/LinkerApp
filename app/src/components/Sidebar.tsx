"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMikrotik } from "@/contexts/MikrotikContext";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/red", label: "Red", icon: Network },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/planes", label: "Planes", icon: Package },
  { href: "/pagos", label: "Pagos", icon: CreditCard },
  { href: "/seguridad", label: "Seguridad de Red", icon: Shield },
  { href: "/mikrotik", label: "MikroTik", icon: Server },
  { href: "/alertas", label: "Alertas", icon: Bell },
  { href: "/vpn", label: "VPN", icon: Globe, hasBadge: true },
  { href: "/configuracion", label: "Configuracion", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { vpnConnected } = useMikrotik();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="group/sidebar fixed left-0 top-0 z-40 flex h-screen w-[72px] flex-col border-r border-[#e2e8f0] bg-white transition-all duration-300 ease-in-out hover:w-[240px]">
      {/* Logo */}
      <div className="flex h-[72px] items-center gap-3 border-b border-[#e2e8f0] px-0 transition-all duration-300">
        <div className="flex w-[72px] shrink-0 items-center justify-center">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-[#006fff] text-sm font-bold tracking-tight text-white shadow-lg shadow-[#006fff]/20">
            LK
          </div>
        </div>
        <span className="truncate text-lg font-semibold tracking-tight text-[#0f172a] opacity-0 transition-opacity duration-300 group-hover/sidebar:opacity-100">
          Linker
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group/item relative flex items-center gap-3 rounded-xl px-0 py-2.5 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? "bg-[#eff6ff] text-[#006fff]"
                  : "text-[#475569] hover:bg-[#f5f7fa] hover:text-[#0f172a]"
              }`}
            >
              {/* Active indicator */}
              {isActive && (
                <div className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-[#006fff]" />
              )}
              <div className="relative flex w-[48px] shrink-0 items-center justify-center">
                <Icon className="h-5 w-5" />
                {/* VPN badge */}
                {item.hasBadge && (
                  <span
                    title={vpnConnected ? "VPN Conectada" : "VPN Desconectada"}
                    className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${
                      vpnConnected ? "bg-[#16a34a] animate-pulse" : "bg-[#dc2626]"
                    }`}
                  />
                )}
              </div>
              <span className="truncate opacity-0 transition-opacity duration-300 group-hover/sidebar:opacity-100">
                {item.label}
              </span>
              {/* Tooltip when collapsed */}
              <div className="pointer-events-none absolute left-[72px] top-1/2 z-50 -translate-y-1/2 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-[#0f172a] opacity-0 shadow-xl ring-1 ring-[#e2e8f0] transition-opacity duration-200 group-hover/item:opacity-100 group-hover/sidebar:!opacity-0">
                {item.label}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-[#e2e8f0] px-3 py-3">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-0 py-2.5 text-sm font-medium text-[#94a3b8] transition-all duration-200 hover:bg-red-50 hover:text-red-500"
        >
          <div className="flex w-[48px] shrink-0 items-center justify-center">
            <LogOut className="h-5 w-5" />
          </div>
          <span className="truncate opacity-0 transition-opacity duration-300 group-hover/sidebar:opacity-100">
            Cerrar sesion
          </span>
        </button>
        <div className="mt-2 flex w-[48px] items-center justify-center opacity-0 transition-opacity duration-300 group-hover/sidebar:w-auto group-hover/sidebar:opacity-100">
          <span className="truncate text-[10px] text-[#94a3b8]">v0.1.0</span>
        </div>
      </div>
    </aside>
  );
}
