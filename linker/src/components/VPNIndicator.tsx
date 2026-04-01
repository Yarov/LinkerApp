import { memo } from "react";
import { useMikrotikStore } from "@/stores/useMikrotikStore";

interface VPNIndicatorProps {
  showText?: boolean;
  size?: "sm" | "md";
}

export default memo(function VPNIndicator({ showText = true, size = "sm" }: VPNIndicatorProps) {
  const vpnConnected = useMikrotikStore(s => s.vpnConnected);
  const dotSize = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block rounded-full ${dotSize} ${vpnConnected ? "bg-[#16a34a] animate-pulse" : "bg-[#dc2626]"}`} />
      {showText && (
        <span className={`text-xs font-medium ${vpnConnected ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
          {vpnConnected ? "Conectada" : "Desconectada"}
        </span>
      )}
    </span>
  );
});
