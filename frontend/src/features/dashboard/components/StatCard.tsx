import { Icon } from "../../../components/ui/Icon";
import type { StatCardData } from "../../../types/invoice";

interface StatCardProps {
  stat: StatCardData;
}

export function StatCard({ stat }: StatCardProps) {
  return (
    <article className="stat-card relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_4px_18px_rgba(15,39,71,.045)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-semibold text-slate-500">{stat.label}</p>
          <p className="mt-3 whitespace-nowrap text-[22px] font-extrabold tracking-tight text-[#092547]">
            {stat.value}
          </p>
        </div>
        <div className={`stat-icon stat-${stat.tone}`}>
          <Icon name={stat.icon} className="h-[22px] w-[22px]" />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
        {stat.tone === "blue" && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-600">
            +12%
          </span>
        )}
        <p className="text-[11px] font-medium text-slate-400">{stat.note}</p>
      </div>
    </article>
  );
}
