import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client.ts";
import {
  fetchPendingApprovals,
  reviewAttendanceRecord,
  reviewMachineLogRecord,
  reviewProductionRecord,
} from "../../api/operations.ts";
import { Icon } from "../../components/ui/Icon.tsx";
import type { PendingApprovalsPayload } from "../../types/operations.ts";
import { RevisionHistoryModal } from "../operations/RevisionHistoryModal.tsx";

type RecordKind = "ATTENDANCE" | "MACHINE_LOG" | "PRODUCTION_LOG";

export function OwnerApprovalsPage() {
  const [data, setData] = useState<PendingApprovalsPayload>({
    attendance: [],
    machineLogs: [],
    productionLogs: [],
  });
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [returnTarget, setReturnTarget] = useState<{
    kind: RecordKind;
    id: number;
    version: number;
    label: string;
  } | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [historyTarget, setHistoryTarget] = useState<{
    recordType: RecordKind;
    recordId: number;
    title: string;
  } | null>(null);

  const loadPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pending = await fetchPendingApprovals();
      setData({
        attendance: Array.isArray(pending?.attendance) ? pending.attendance : [],
        machineLogs: Array.isArray(pending?.machineLogs) ? pending.machineLogs : [],
        productionLogs: Array.isArray(pending?.productionLogs)
          ? pending.productionLogs
          : [],
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load pending approvals queue."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  async function handleApprove(kind: RecordKind, id: number, version: number) {
    const key = `${kind}-${id}`;
    setBusyKey(key);
    setError(null);
    setNotice(null);
    try {
      if (kind === "ATTENDANCE") {
        await reviewAttendanceRecord(id, {
          decision: "APPROVED",
          expectedVersion: version,
        });
      } else if (kind === "MACHINE_LOG") {
        await reviewMachineLogRecord(id, {
          decision: "APPROVED",
          expectedVersion: version,
        });
      } else {
        await reviewProductionRecord(id, {
          decision: "APPROVED",
          expectedVersion: version,
        });
      }
      setNotice(`${kind.replace("_", " ")} #${id} approved and locked for reporting.`);
      await loadPending();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to approve record.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleConfirmReturn(e: React.FormEvent) {
    e.preventDefault();
    if (!returnTarget) return;
    if (returnReason.trim().length < 5) {
      setError("Please enter a clear correction reason (min 5 characters).");
      return;
    }
    const { kind, id, version } = returnTarget;
    setBusyKey(`${kind}-${id}`);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        decision: "RETURNED_FOR_CORRECTION" as const,
        reason: returnReason.trim(),
        expectedVersion: version,
      };
      if (kind === "ATTENDANCE") {
        await reviewAttendanceRecord(id, payload);
      } else if (kind === "MACHINE_LOG") {
        await reviewMachineLogRecord(id, payload);
      } else {
        await reviewProductionRecord(id, payload);
      }
      setReturnTarget(null);
      setReturnReason("");
      setNotice(`${kind.replace("_", " ")} #${id} returned to staff for correction.`);
      await loadPending();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to return submission.");
    } finally {
      setBusyKey(null);
    }
  }

  const attendance = Array.isArray(data?.attendance) ? data.attendance : [];
  const machineLogs = Array.isArray(data?.machineLogs) ? data.machineLogs : [];
  const productionLogs = Array.isArray(data?.productionLogs)
    ? data.productionLogs
    : [];

  const totalPending =
    attendance.length +
    machineLogs.length +
    productionLogs.length;

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-8 lg:p-10">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#f58220]">
            Mobile &amp; Desktop Owner Review
          </p>
          <h1 className="mt-1 text-2xl font-extrabold text-[#092547] md:text-3xl">
            Pending Approvals ({totalPending})
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Submitted workshop logs require Owner sign-off before counting toward reports or payroll.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPending()}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#092547] hover:bg-slate-50"
        >
          Refresh Queue
        </button>
      </div>

      {error && totalPending > 0 && (
        <div role="alert" className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          Loading submitted records...
        </div>
      ) : error && totalPending === 0 ? (
        <div className="rounded-2xl border border-rose-200 bg-white p-10 text-center shadow-sm">
          <p className="text-base font-extrabold text-rose-700">
            Failed to Load Approvals Queue
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {error}
          </p>
          <button
            type="button"
            onClick={() => void loadPending()}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#092547] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#124f8c]"
          >
            Retry Connection
          </button>
        </div>
      ) : totalPending === 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-10 text-center">
          <p className="text-base font-extrabold text-emerald-900">
            All Caught Up
          </p>
          <p className="mt-1 text-sm text-emerald-700">
            Zero pending attendance, machine, or production submissions await your approval.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Worker Attendance Submissions */}
          {attendance.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-600">
                Worker Attendance ({attendance.length})
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {attendance.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-extrabold text-[#092547]">
                          {item.workerName} ({item.workerCode})
                        </p>
                        <p className="text-xs text-slate-500">
                          {item.workDate} &middot; {item.startTime}&ndash;{item.endTime}
                          {item.crossesMidnight ? " (+1d)" : ""} &middot; Break {item.breakMinutes}m
                        </p>
                      </div>
                      <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-extrabold text-blue-800">
                        {item.hoursWorked} h (OT {item.overtimeHours} h)
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      Submitted by <strong>{item.enteredByName}</strong>
                      {item.remarks ? ` — "${item.remarks}"` : ""}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyKey === `ATTENDANCE-${item.id}`}
                        onClick={() =>
                          void handleApprove("ATTENDANCE", item.id, item.version)
                        }
                        className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyKey === `ATTENDANCE-${item.id}`}
                        onClick={() => {
                          setReturnTarget({
                            kind: "ATTENDANCE",
                            id: item.id,
                            version: item.version,
                            label: `${item.workerName} (${item.workDate})`,
                          });
                          setReturnReason("");
                        }}
                        className="flex-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                      >
                        Return
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setHistoryTarget({
                            recordType: "ATTENDANCE",
                            recordId: item.id,
                            title: `Attendance #${item.id} — ${item.workerName}`,
                          })
                        }
                        className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        History
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* Machine Work Logs */}
          {machineLogs.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-600">
                Machine Operating Logs ({machineLogs.length})
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {machineLogs.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-extrabold text-[#092547]">
                          {item.machineName} ({item.machineCode})
                        </p>
                        <p className="text-xs text-slate-500">
                          {item.workDate} &middot; {item.startTime}&ndash;{item.endTime} &middot; Downtime {item.downtimeMinutes}m
                        </p>
                      </div>
                      <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-extrabold text-blue-800">
                        {item.netOperatingHours} net hrs
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      Operator: {item.operatorWorkerName ?? "Unassigned"} &middot; Entered by{" "}
                      <strong>{item.enteredByName}</strong>
                      {item.downtimeReason ? ` — Downtime: ${item.downtimeReason}` : ""}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyKey === `MACHINE_LOG-${item.id}`}
                        onClick={() =>
                          void handleApprove("MACHINE_LOG", item.id, item.version)
                        }
                        className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyKey === `MACHINE_LOG-${item.id}`}
                        onClick={() => {
                          setReturnTarget({
                            kind: "MACHINE_LOG",
                            id: item.id,
                            version: item.version,
                            label: `${item.machineName} (${item.workDate})`,
                          });
                          setReturnReason("");
                        }}
                        className="flex-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                      >
                        Return
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setHistoryTarget({
                            recordType: "MACHINE_LOG",
                            recordId: item.id,
                            title: `Machine Log #${item.id} — ${item.machineName}`,
                          })
                        }
                        className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        History
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* Production Logs */}
          {productionLogs.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-600">
                Crushed Metal Production ({productionLogs.length})
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {productionLogs.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-extrabold text-[#092547]">
                          {item.materialName} &mdash; {item.quantityProduced} m³
                        </p>
                        <p className="text-xs text-slate-500">
                          {item.productionDate} &middot;{" "}
                          {item.machineName ?? "General"} &middot;{" "}
                          {item.shiftLabel ?? "No shift label"}
                        </p>
                      </div>
                      <span className="rounded-lg bg-orange-50 px-2.5 py-1 text-xs font-extrabold text-[#f58220]">
                        {item.quantityProduced} m³
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      Submitted by <strong>{item.enteredByName}</strong>
                      {item.remarks ? ` — "${item.remarks}"` : ""}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyKey === `PRODUCTION_LOG-${item.id}`}
                        onClick={() =>
                          void handleApprove("PRODUCTION_LOG", item.id, item.version)
                        }
                        className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyKey === `PRODUCTION_LOG-${item.id}`}
                        onClick={() => {
                          setReturnTarget({
                            kind: "PRODUCTION_LOG",
                            id: item.id,
                            version: item.version,
                            label: `${item.materialName} (${item.productionDate})`,
                          });
                          setReturnReason("");
                        }}
                        className="flex-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                      >
                        Return
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setHistoryTarget({
                            recordType: "PRODUCTION_LOG",
                            recordId: item.id,
                            title: `Production #${item.id} — ${item.materialName}`,
                          })
                        }
                        className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        History
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {returnTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Return submission for correction"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#092547]/55 p-4 backdrop-blur-sm"
        >
          <form
            onSubmit={handleConfirmReturn}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-[#092547]">
                Return for Correction
              </h3>
              <button
                type="button"
                onClick={() => setReturnTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                aria-label="Close return dialog"
              >
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-4 text-xs text-slate-500">
              Item: <strong className="text-[#092547]">{returnTarget.label}</strong>
            </p>
            <label
              htmlFor="return-reason-input"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600"
            >
              Reason / Instructions for Staff (Required)
            </label>
            <textarea
              id="return-reason-input"
              rows={3}
              required
              minLength={5}
              placeholder="Explain what needs correcting..."
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-[#092547]"
            />
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setReturnTarget(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700"
              >
                Send Back for Correction
              </button>
            </div>
          </form>
        </div>
      )}

      {historyTarget && (
        <RevisionHistoryModal
          recordType={historyTarget.recordType}
          recordId={historyTarget.recordId}
          title={historyTarget.title}
          onClose={() => setHistoryTarget(null)}
        />
      )}
    </div>
  );
}

