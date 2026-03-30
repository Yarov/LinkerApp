"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import ConnectionBanner from "./ConnectionBanner";
import { MikrotikProvider } from "@/contexts/MikrotikContext";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";
  const isOnboarding = pathname === "/onboarding";

  if (isLoginPage || isOnboarding) {
    return <>{children}</>;
  }

  return (
    <MikrotikProvider>
      <Sidebar />
      <main className="ml-[72px] h-screen overflow-y-auto">
        <ConnectionBanner />
        <div className="mx-auto max-w-[1400px] p-6 lg:p-8 pb-20">{children}</div>
      </main>
    </MikrotikProvider>
  );
}
