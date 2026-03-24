export function SkeletonCard() {
  return (
    <div
      className="animate-pulse rounded-xl border border-slate-100 bg-white p-6"
      aria-hidden="true"
    >
      <div className="mb-4 h-10 w-10 rounded-lg bg-slate-200" />
      <div className="mb-2 h-5 w-24 rounded bg-slate-200" />
      <div className="h-4 w-32 rounded bg-slate-100" />
    </div>
  )
}
