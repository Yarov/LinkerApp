import Skeleton from "@/components/Skeleton";

export default function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><Skeleton className="h-7 w-36" /><Skeleton className="mt-2 h-4 w-52" /></div>
        <div className="flex items-center gap-2"><Skeleton className="h-8 w-40 rounded-xl" /></div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="absolute left-0 top-0 h-full w-[3px] bg-[#e2e8f0]" />
            <div className="flex items-center justify-between">
              <div><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-7 w-16" /></div>
              <Skeleton className="h-12 w-12 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm lg:col-span-3">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2"><Skeleton className="h-4 w-4 rounded-full" /><Skeleton className="h-5 w-36" /></div>
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="space-y-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl px-4 py-3">
                <Skeleton className="h-3 w-3 rounded-full" />
                <div className="flex flex-1 items-center justify-between">
                  <div className="flex items-center gap-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-5 w-12 rounded-md" /></div>
                  <Skeleton className="h-4 w-14" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-5 flex items-center gap-2"><Skeleton className="h-4 w-4 rounded-full" /><Skeleton className="h-5 w-36" /></div>
          <div className="space-y-5">
            <div><div className="mb-2 flex items-center justify-between"><Skeleton className="h-3 w-12" /><Skeleton className="h-3 w-8" /></div><Skeleton className="h-2 w-full rounded-full" /></div>
            <div><div className="mb-2 flex items-center justify-between"><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-8" /></div><Skeleton className="h-2 w-full rounded-full" /></div>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3"><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-24" /></div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, sectionIdx) => (
          <div key={sectionIdx} className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2"><Skeleton className="h-4 w-4 rounded-full" /><Skeleton className="h-5 w-32" /></div>
              <Skeleton className="h-4 w-14" />
            </div>
            <div className="space-y-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl px-4 py-3">
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <div className="flex-1"><Skeleton className="h-4 w-3/4" /><Skeleton className="mt-1.5 h-3 w-20" /></div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
