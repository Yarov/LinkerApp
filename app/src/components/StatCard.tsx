import { type LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  color?: "blue" | "green" | "yellow" | "red" | "purple" | "cyan";
}

const colorConfig = {
  blue: {
    icon: "bg-[#eff6ff] text-[#006fff]",
    gradient: "from-[#006fff]",
  },
  green: {
    icon: "bg-[#f0fdf4] text-[#16a34a]",
    gradient: "from-[#16a34a]",
  },
  yellow: {
    icon: "bg-[#fffbeb] text-[#f59e0b]",
    gradient: "from-[#f59e0b]",
  },
  red: {
    icon: "bg-[#fef2f2] text-[#dc2626]",
    gradient: "from-[#dc2626]",
  },
  purple: {
    icon: "bg-[#f5f3ff] text-[#7c4dff]",
    gradient: "from-[#7c4dff]",
  },
  cyan: {
    icon: "bg-[#ecfeff] text-[#00bcd4]",
    gradient: "from-[#00bcd4]",
  },
};

export default function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  color = "blue",
}: StatCardProps) {
  const config = colorConfig[color];

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:border-[#cbd5e1] hover:bg-[#f8f9fb]">
      {/* Left gradient accent */}
      <div
        className={`absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b ${config.gradient} to-transparent`}
      />
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-[#0f172a]">
            {value}
          </p>
          {trend && (
            <div className="mt-1.5 flex items-center gap-1">
              {trend.value >= 0 ? (
                <TrendingUp className="h-3 w-3 text-[#16a34a]" />
              ) : (
                <TrendingDown className="h-3 w-3 text-[#dc2626]" />
              )}
              <span
                className={`text-xs font-medium ${
                  trend.value >= 0 ? "text-[#16a34a]" : "text-[#dc2626]"
                }`}
              >
                {trend.value >= 0 ? "+" : ""}
                {trend.value}%
              </span>
              <span className="text-xs text-[#94a3b8]">{trend.label}</span>
            </div>
          )}
        </div>
        <div className={`rounded-xl p-3 ${config.icon}`}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}
