export default function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton-shimmer rounded-lg bg-[#e2e8f0] ${className}`} />;
}
