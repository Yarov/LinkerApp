import Skeleton from "@/components/Skeleton";

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

const columnWidths = ["w-32", "w-28", "w-24", "w-20", "w-16", "w-24", "w-20", "w-16"];

export default function TableSkeleton({
  rows = 5,
  columns = 5,
}: TableSkeletonProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[#e2e8f0] bg-[#f5f7fa]">
            {Array.from({ length: columns }).map((_, col) => (
              <th key={col} className="px-5 py-3.5">
                <Skeleton
                  className={`h-3 ${columnWidths[col % columnWidths.length]}`}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, row) => (
            <tr
              key={row}
              className={`border-b border-[#e2e8f0] last:border-b-0 ${
                row % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"
              }`}
            >
              {Array.from({ length: columns }).map((_, col) => (
                <td key={col} className="px-5 py-3.5">
                  <Skeleton
                    className={`h-4 ${
                      col === 0
                        ? "w-32"
                        : columnWidths[(col + 2) % columnWidths.length]
                    }`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
