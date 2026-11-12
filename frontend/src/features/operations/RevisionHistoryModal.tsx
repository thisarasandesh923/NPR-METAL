import { useEffect, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { fetchOperationalApprovalHistory } from "../../api/operations.ts";
import { Icon } from "../../components/ui/Icon.tsx";
import type { OperationalApprovalHistoryItem } from "../../types/operations.ts";
import { formatColomboDateTime } from "../../utils/formatters.ts";

interface RevisionHistoryModalProps {
  recordType: "ATTENDANCE" | "MACHINE_LOG" | "PRODUCTION_LOG";
  recordId: number;
  title: string;
  onClose: () => void;
}

export function RevisionHistoryModal({
  recordType,
  recordId,
  title,
  onClose,
}: RevisionHistoryModalProps) {
  const [items, setItems] = useState<OperationalApprovalHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const rows = await fetchOperationalApprovalHistory(recordType, recordId);
        if (!cancelled) setItems(rows);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load approval history."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [recordId, recordType]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`History for ${title}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#092547]/55 p-4 backdrop-blur-sm"
    >
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#f58220]">
              Append-Only Audit Trail
            </p>
            <h3 className="text-lg font-extrabold text-[#092547]">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history modal"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">
            Loading history...
          </p>
        ) : error ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
            {error}
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            No revision entries recorded.
          </p>
        ) : (
          <ol className="space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-extrabold text-[#092547]">
                    {item.action} ({item.fromStatus ?? "NEW"} &rarr; {item.toStatus})
                  </span>
                  <span className="text-slate-500">
                    {formatColomboDateTime(item.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-slate-600">
                  Actor: <strong className="text-[#092547]">{item.actorName}</strong>
                </p>
                {item.reason && (
                  <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 font-medium text-amber-900">
                    Reason: {item.reason}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

