import Skeleton from "@/components/Skeleton";

interface CardGridSkeletonProps { count?: number; }

export default function CardGridSkeleton({ count = 3 }: CardGridSkeletonProps) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
          <div className="h-1 w-full bg-[#e2e8f0]" />
          <div className="p-5">
            <div className="flex items-start justify-between">
              <div><Skeleton className="h-5 w-28" /><Skeleton className="mt-3 h-8 w-20" /></div>
              <div className="flex gap-1"><Skeleton className="h-8 w-8 rounded-xl" /><Skeleton className="h-8 w-8 rounded-xl" /></div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex-1 rounded-xl bg-[#f5f7fa] px-3.5 py-2.5"><Skeleton className="h-3 w-16" /><Skeleton className="mt-2 h-6 w-12" /></div>
              <div className="flex-1 rounded-xl bg-[#f5f7fa] px-3.5 py-2.5"><Skeleton className="h-3 w-14" /><Skeleton className="mt-2 h-6 w-12" /></div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-[#e2e8f0] pt-4"><Skeleton className="h-5 w-20 rounded-lg" /><Skeleton className="h-4 w-16" /></div>
          </div>
        </div>
      ))}
    </div>
  );
}
