interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

const statusConfig: Record<
  string,
  { bg: string; text: string; dot: string; dotClass: string; label: string }
> = {
  online: {
    bg: "bg-[#f0fdf4] border border-[#16a34a]/20",
    text: "text-[#16a34a]",
    dot: "bg-[#16a34a]",
    dotClass: "status-dot-online",
    label: "En Linea",
  },
  active: {
    bg: "bg-[#f0fdf4] border border-[#16a34a]/20",
    text: "text-[#16a34a]",
    dot: "bg-[#16a34a]",
    dotClass: "status-dot-online",
    label: "Activo",
  },
  activo: {
    bg: "bg-[#f0fdf4] border border-[#16a34a]/20",
    text: "text-[#16a34a]",
    dot: "bg-[#16a34a]",
    dotClass: "status-dot-online",
    label: "Activo",
  },
  degraded: {
    bg: "bg-[#fffbeb] border border-[#f59e0b]/20",
    text: "text-[#f59e0b]",
    dot: "bg-[#f59e0b]",
    dotClass: "",
    label: "Degradado",
  },
  suspended: {
    bg: "bg-[#fef2f2] border border-[#dc2626]/20",
    text: "text-[#dc2626]",
    dot: "bg-[#dc2626]",
    dotClass: "",
    label: "Suspendido",
  },
  suspendido: {
    bg: "bg-[#fef2f2] border border-[#dc2626]/20",
    text: "text-[#dc2626]",
    dot: "bg-[#dc2626]",
    dotClass: "",
    label: "Suspendido",
  },
  warning: {
    bg: "bg-[#fffbeb] border border-[#f59e0b]/20",
    text: "text-[#f59e0b]",
    dot: "bg-[#f59e0b]",
    dotClass: "",
    label: "Advertencia",
  },
  offline: {
    bg: "bg-[#fef2f2] border border-[#dc2626]/20",
    text: "text-[#dc2626]",
    dot: "bg-[#dc2626]",
    dotClass: "",
    label: "Sin Conexion",
  },
  disconnected: {
    bg: "bg-[#fef2f2] border border-[#dc2626]/20",
    text: "text-[#dc2626]",
    dot: "bg-[#dc2626]",
    dotClass: "",
    label: "Desconectado",
  },
  desconectado: {
    bg: "bg-[#fef2f2] border border-[#dc2626]/20",
    text: "text-[#dc2626]",
    dot: "bg-[#dc2626]",
    dotClass: "",
    label: "Desconectado",
  },
  error: {
    bg: "bg-[#fef2f2] border border-[#dc2626]/20",
    text: "text-[#dc2626]",
    dot: "bg-[#dc2626]",
    dotClass: "",
    label: "Error",
  },
};

const defaultConfig = {
  bg: "bg-[#f5f7fa] border border-[#e2e8f0]",
  text: "text-[#475569]",
  dot: "bg-[#475569]",
  dotClass: "",
  label: "Desconocido",
};

export default function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const key = (status ?? "").toLowerCase();
  const config = statusConfig[key] ?? defaultConfig;
  const label = config.label || status || "Desconocido";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${config.bg} ${config.text} ${
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-xs"
      }`}
    >
      <span
        className={`inline-block rounded-full ${config.dot} ${config.dotClass} ${
          size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2"
        }`}
      />
      {label}
    </span>
  );
}
