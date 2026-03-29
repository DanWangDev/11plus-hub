export function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-6" aria-hidden="true">
      <div className="mb-4 h-10 w-10 rounded-lg bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 animate-[shimmer_1.5s_ease-in-out_infinite] bg-[length:200%_100%]" />
      <div className="mb-2 h-5 w-24 rounded bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 animate-[shimmer_1.5s_ease-in-out_infinite] bg-[length:200%_100%]" />
      <div className="h-4 w-32 rounded bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 animate-[shimmer_1.5s_ease-in-out_infinite] bg-[length:200%_100%]" />
    </div>
  )
}
