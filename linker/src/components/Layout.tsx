import Sidebar from "./Sidebar";
import ConnectionBanner from "./ConnectionBanner";
import { useAppStore } from "@/stores/useAppStore";

export default function Layout({ children }: { children: React.ReactNode }) {
  const sidebarPinned = useAppStore(s => s.sidebarPinned);

  return (
    <>
      <Sidebar />
      <main
        className="h-screen overflow-y-auto transition-all duration-200"
        style={{ marginLeft: sidebarPinned ? 220 : 64 }}
      >
        <ConnectionBanner />
        <div className="mx-auto max-w-[1400px] p-5 lg:p-6 pb-20">
          {children}
        </div>
      </main>
    </>
  );
}
