import { Skeleton } from '@devias/ui';

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 pt-6">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="mt-2 h-48 w-full" />
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1 p-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}
