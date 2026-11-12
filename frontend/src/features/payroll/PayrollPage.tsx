import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client.ts";
import {
  approvePayrollEntry,
  createPayrollPeriod,
  downloadPayrollExport,
  fetchCompensationProfiles,
  fetchOperationalExpenses,
  fetchPayrollPeriodEntries,
  fetchPayrollPeriods,
  fetchSalaryPayments,
  fetchWorkerAdvances,
  fetchWorkers,
  preparePayrollPeriod,
  recordOperationalExpense,
  recordSalaryPayment,
  recordWorkerAdvance,
  updatePayrollDraftEntry,
  upsertCompensationProfile,
} from "../../api/operations.ts";
import { Icon } from "../../components/ui/Icon.tsx";
import type {
  CompensationProfileRecord,
  OperationalExpenseRecord,
  PayArrangement,
  PayrollEntryRecord,
  PayrollPeriodRecord,
  SalaryPaymentRecord,
  WorkerAdvanceRecord,
  WorkerRecord,
} from "../../types/operations.ts";
import { formatColomboDateTime, formatLkr } from "../../utils/formatters.ts";
import { colomboTodayIsoDate } from "../operations/spreadsheetUtils.ts";

type PayrollTab = "periods" | "arrangements" | "advances" | "expenses";

export function PayrollPage() {
  const today = colomboTodayIsoDate();
  const [tab, setTab] = useState<PayrollTab>("periods");
  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [profiles, setProfiles] = useState<CompensationProfileRecord[]>([]);
  const [periods, setPeriods] = useState<PayrollPeriodRecord[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [entries, setEntries] = useState<PayrollEntryRecord[]>([]);
  const [advances, setAdvances] = useState<WorkerAdvanceRecord[]>([]);
  const [salaryPayments, setSalaryPayments] = useState<SalaryPaymentRecord[]>([]);
  const [expenses, setExpenses] = useState<OperationalExpenseRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Create Period form
  const [periodLabel, setPeriodLabel] = useState("");
  const [periodStart, setPeriodStart] = useState(`${today.slice(0, 7)}-01`);
  const [periodEnd, setPeriodEnd] = useState(today);

  // Arrangement form
  const [compWorkerId, setCompWorkerId] = useState<number>(0);
  const [compArrangement, setCompArrangement] = useState<PayArrangement>("MANUAL");
  const [compBaseRate, setCompBaseRate] = useState("");
  const [compOtRate, setCompOtRate] = useState("");
  const [compEffectiveFrom, setCompEffectiveFrom] = useState(today);

  // Advance form
  const [advWorkerId, setAdvWorkerId] = useState<number>(0);
  const [advDate, setAdvDate] = useState(today);
  const [advAmount, setAdvAmount] = useState("");
  const [advReason, setAdvReason] = useState("");

  // Expense form
  const [expDate, setExpDate] = useState(today);
  const [expCategory, setExpCategory] = useState("FUEL");
  const [expDesc, setExpDesc] = useState("");
  const [expAmount, setExpAmount] = useState("");

  // Modals for Edit Entry & Pay Salary
  const [editingEntry, setEditingEntry] = useState<PayrollEntryRecord | null>(null);
  const [editBase, setEditBase] = useState("0.00");
  const [editOt, setEditOt] = useState("0.00");
  const [editAllow, setEditAllow] = useState("0.00");
  const [editDeduct, setEditDeduct] = useState("0.00");
  const [editAdvDeduct, setEditAdvDeduct] = useState("0.00");
  const [editNotes, setEditNotes] = useState("");

  const [payingEntry, setPayingEntry] = useState<PayrollEntryRecord | null>(null);
  const [payDate, setPayDate] = useState(today);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"CASH" | "BANK_TRANSFER">("CASH");
  const [payNote, setPayNote] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wList, profList, perList, advList, salList, expList] =
        await Promise.all([
          fetchWorkers(true),
          fetchCompensationProfiles(),
          fetchPayrollPeriods(),
          fetchWorkerAdvances(),
          fetchSalaryPayments(),
          fetchOperationalExpenses(),
        ]);
      setWorkers(wList);
      setProfiles(profList);
      setPeriods(perList);
      setAdvances(advList);
      setSalaryPayments(salList);
      setExpenses(expList);
      if (wList.length > 0 && compWorkerId === 0) {
        setCompWorkerId(wList[0].id);
        setAdvWorkerId(wList[0].id);
      }
      const nextPeriodId = selectedPeriodId ?? perList[0]?.id ?? null;
      if (nextPeriodId !== null) {
        setSelectedPeriodId(nextPeriodId);
        const periodEntries = await fetchPayrollPeriodEntries(nextPeriodId);
        setEntries(periodEntries);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load confidential owner payroll records."
      );
    } finally {
      setLoading(false);
    }
  }, [compWorkerId, selectedPeriodId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function selectPeriod(periodId: number) {
    setSelectedPeriodId(periodId);
    setError(null);
    try {
      const list = await fetchPayrollPeriodEntries(periodId);
      setEntries(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load entries.");
    }
  }

  async function handleCreatePeriod(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await createPayrollPeriod({
        periodLabel: periodLabel.trim(),
        startDate: periodStart,
        endDate: periodEnd,
      });
      setPeriodLabel("");
      setSelectedPeriodId(created.id);
      setNotice(`Payroll period "${created.periodLabel}" created.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create period.");
    }
  }

  async function handlePreparePeriod() {
    if (!selectedPeriodId) return;
    setError(null);
    try {
      const list = await preparePayrollPeriod(selectedPeriodId);
      setEntries(list);
      setNotice(
        `Prepared ${list.length} payroll draft entries from approved attendance.`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to prepare drafts.");
    }
  }

  async function handleSaveArrangement(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await upsertCompensationProfile({
        workerId: compWorkerId,
        payArrangement: compArrangement,
        baseRate: compBaseRate.trim() || null,
        overtimeHourlyRate: compOtRate.trim() || null,
        effectiveFrom: compEffectiveFrom,
      });
      setNotice("Compensation arrangement updated cleanly.");
      await loadAll();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to update compensation rule."
      );
    }
  }

  async function handleSaveEntryEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingEntry) return;
    setError(null);
    try {
      await updatePayrollDraftEntry(editingEntry.id, {
        expectedVersion: editingEntry.version,
        basePay: editBase.trim(),
        overtimePay: editOt.trim(),
        allowances: editAllow.trim(),
        deductions: editDeduct.trim(),
        advanceDeduction: editAdvDeduct.trim(),
        notes: editNotes.trim() || null,
      });
      setEditingEntry(null);
      setNotice("Payroll draft entry updated.");
      if (selectedPeriodId) await selectPeriod(selectedPeriodId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save draft.");
    }
  }

  async function handleApproveEntry(entry: PayrollEntryRecord) {
    setError(null);
    try {
      await approvePayrollEntry(entry.id, entry.version);
      setNotice(`Approved payroll for ${entry.workerName}. Ready for salary payment.`);
      if (selectedPeriodId) await selectPeriod(selectedPeriodId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to approve entry.");
    }
  }

  async function handleRecordSalaryPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payingEntry) return;
    setError(null);
    try {
      const res = await recordSalaryPayment(payingEntry.id, {
        paymentDate: payDate,
        amount: payAmount.trim(),
        paymentMethod: payMethod,
        referenceNote: payNote.trim() || null,
        idempotencyKey: `sal-${crypto.randomUUID()}`,
      });
      setPayingEntry(null);
      setNotice(
        `Salary receipt ${res.payment.salaryReceiptNumber} recorded for ${res.entry.workerName}.`
      );
      await loadAll();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to record salary payment."
      );
    }
  }

  async function handleRecordAdvance(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await recordWorkerAdvance({
        workerId: advWorkerId,
        advanceDate: advDate,
        amount: advAmount.trim(),
        reason: advReason.trim(),
        idempotencyKey: `adv-${crypto.randomUUID()}`,
      });
      setAdvAmount("");
      setAdvReason("");
      setNotice(`Advance voucher ${created.advanceNumber} recorded.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to record advance.");
    }
  }

  async function handleRecordExpense(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await recordOperationalExpense({
        expenseDate: expDate,
        category: expCategory,
        description: expDesc.trim(),
        amount: expAmount.trim(),
        idempotencyKey: `exp-${crypto.randomUUID()}`,
      });
      setExpDesc("");
      setExpAmount("");
      setNotice(`Workshop expense ${created.expenseNumber} saved.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to record expense.");
    }
  }

  async function handleExportPayroll(format: "csv" | "xlsx" | "pdf") {
    setError(null);
    try {
      await downloadPayrollExport({
        format,
        periodId: selectedPeriodId ?? undefined,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed.");
    }
  }

  return (
    <div className="mx-auto max-w-[1550px] p-4 md:p-8 lg:p-10">
      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-rose-700">
            <Icon name="lock" className="h-3.5 w-3.5" />
            Confidential Owner Workspace
          </span>
          <h1 className="mt-2 text-2xl font-extrabold text-[#092547] md:text-3xl">
            Payroll, Advances &amp; Operating Expenses
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Only authenticated Owner accounts can access pay rates, payroll drafts, advances, and salaries.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-1">
          {(
            [
              ["periods", "Payroll Runs"],
              ["arrangements", "Pay Rules"],
              ["advances", `Advances (${advances.length})`],
              ["expenses", `Expenses (${expenses.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-lg px-3.5 py-2 text-xs font-extrabold ${
                tab === id
                  ? "bg-[#092547] text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
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
          Loading payroll &amp; expenses...
        </div>
      ) : tab === "periods" ? (
        <div className="space-y-6">
          {/* Create period & controls */}
          <div className="grid gap-6 lg:grid-cols-2">
            <form
              onSubmit={handleCreatePeriod}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h2 className="mb-3 text-sm font-extrabold text-[#092547]">
                New Payroll Period
              </h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <input
                  type="text"
                  required
                  placeholder="Label (e.g. Nov 1-15)"
                  value={periodLabel}
                  onChange={(e) => setPeriodLabel(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs sm:col-span-3"
                />
                <input
                  type="date"
                  required
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
                />
                <input
                  type="date"
                  required
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-[#f58220] px-4 py-2 text-xs font-bold text-white hover:bg-[#df7318]"
                >
                  Create Period
                </button>
              </div>
            </form>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-extrabold text-[#092547]">
                Select Period &amp; Prepare / Export
              </h2>
              <div className="flex flex-wrap items-center gap-2.5">
                <select
                  aria-label="Select payroll period"
                  value={selectedPeriodId ?? ""}
                  onChange={(e) => void selectPeriod(Number(e.target.value))}
                  className="min-w-[200px] flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-[#092547]"
                >
                  {periods.length === 0 ? (
                    <option value="">No payroll periods yet</option>
                  ) : (
                    periods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.periodLabel} ({p.startDate} &ndash; {p.endDate})
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  disabled={!selectedPeriodId}
                  onClick={() => void handlePreparePeriod()}
                  className="rounded-xl bg-[#092547] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  Prepare Drafts from Attendance
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(["csv", "xlsx", "pdf"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    disabled={!selectedPeriodId}
                    onClick={() => void handleExportPayroll(fmt)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-bold text-[#092547] hover:bg-slate-50 disabled:opacity-50"
                  >
                    Export Payroll {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Entries table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[1050px] text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Worker</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3 text-right">Approved Days / Hrs</th>
                  <th className="px-4 py-3 text-right">Base + OT</th>
                  <th className="px-4 py-3 text-right">Adv Ded</th>
                  <th className="px-4 py-3 text-right">Net Payable</th>
                  <th className="px-4 py-3 text-right">Paid / Due</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                      Select a period and click &ldquo;Prepare Drafts from Attendance&rdquo; to build salary drafts.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-4 py-3">
                        <p className="font-bold text-[#092547]">{entry.workerName}</p>
                        <p className="text-[11px] text-slate-400">
                          {entry.workerCode} &middot; {entry.payArrangementSnapshot}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            entry.calculationMode === "CONFIGURED_AUTO"
                              ? "bg-blue-50 text-blue-800"
                              : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {entry.calculationMode === "CONFIGURED_AUTO"
                            ? "Auto Rule"
                            : "Owner Manual Draft"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {entry.approvedDaysCount}d / {entry.approvedRegularHours}h (+{entry.approvedOvertimeHours} OT)
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {formatLkr(entry.basePay)} + {formatLkr(entry.overtimePay)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {formatLkr(entry.advanceDeduction)}
                      </td>
                      <td className="px-4 py-3 text-right font-extrabold text-[#092547]">
                        {formatLkr(entry.netPayable)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-bold text-emerald-700">
                          {formatLkr(entry.paidAmount)}
                        </span>
                        {" / "}
                        <span className="font-bold text-[#e77418]">
                          {formatLkr(entry.remainingPayable)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold">{entry.status}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1.5">
                          {entry.status === "DRAFT" && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingEntry(entry);
                                  setEditBase(entry.basePay);
                                  setEditOt(entry.overtimePay);
                                  setEditAllow(entry.allowances);
                                  setEditDeduct(entry.deductions);
                                  setEditAdvDeduct(entry.advanceDeduction);
                                  setEditNotes(entry.notes ?? "");
                                }}
                                className="rounded-lg border border-slate-300 px-2.5 py-1 font-bold text-[#092547]"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleApproveEntry(entry)}
                                className="rounded-lg bg-emerald-600 px-2.5 py-1 font-bold text-white"
                              >
                                Approve
                              </button>
                            </>
                          )}
                          {entry.status === "APPROVED" &&
                            Number(entry.remainingPayable) > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPayingEntry(entry);
                                  setPayDate(today);
                                  setPayAmount(entry.remainingPayable);
                                  setPayMethod("CASH");
                                  setPayNote("");
                                }}
                                className="rounded-lg bg-[#f58220] px-2.5 py-1 font-bold text-white"
                              >
                                Pay Salary
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === "arrangements" ? (
        <div className="space-y-6">
          <form
            onSubmit={handleSaveArrangement}
            className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-6"
          >
            <select
              value={compWorkerId}
              onChange={(e) => setCompWorkerId(Number(e.target.value))}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold"
            >
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.fullName} ({w.workerCode})
                </option>
              ))}
            </select>
            <select
              value={compArrangement}
              onChange={(e) => setCompArrangement(e.target.value as PayArrangement)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold"
            >
              <option value="MANUAL">MANUAL (Owner Draft)</option>
              <option value="HOURLY">HOURLY Rate</option>
              <option value="DAILY">DAILY Rate</option>
              <option value="MONTHLY">MONTHLY Fixed</option>
            </select>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Base Rate (LKR)"
              value={compBaseRate}
              onChange={(e) => setCompBaseRate(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="OT Hourly Rate (LKR)"
              value={compOtRate}
              onChange={(e) => setCompOtRate(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
            <input
              type="date"
              required
              value={compEffectiveFrom}
              onChange={(e) => setCompEffectiveFrom(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
            <button
              type="submit"
              className="rounded-xl bg-[#092547] px-4 py-2 text-xs font-bold text-white"
            >
              Save Pay Rule
            </button>
          </form>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Worker</th>
                  <th className="px-5 py-3">Arrangement</th>
                  <th className="px-5 py-3 text-right">Base Rate</th>
                  <th className="px-5 py-3 text-right">OT Hourly</th>
                  <th className="px-5 py-3">Effective From</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {profiles.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-3 font-bold text-[#092547]">
                      {p.workerName} ({p.workerCode})
                    </td>
                    <td className="px-5 py-3 font-semibold">{p.payArrangement}</td>
                    <td className="px-5 py-3 text-right">
                      {p.baseRate ? formatLkr(p.baseRate) : "Manual"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {p.overtimeHourlyRate ? formatLkr(p.overtimeHourlyRate) : "-"}
                    </td>
                    <td className="px-5 py-3">{p.effectiveFrom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === "advances" ? (
        <div className="space-y-6">
          <form
            onSubmit={handleRecordAdvance}
            className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
          >
            <select
              value={advWorkerId}
              onChange={(e) => setAdvWorkerId(Number(e.target.value))}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold"
            >
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.fullName}
                </option>
              ))}
            </select>
            <input
              type="date"
              required
              value={advDate}
              onChange={(e) => setAdvDate(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
            <input
              type="number"
              step="0.01"
              min="1"
              required
              placeholder="Amount (LKR)"
              value={advAmount}
              onChange={(e) => setAdvAmount(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
            <input
              type="text"
              required
              minLength={3}
              placeholder="Reason"
              value={advReason}
              onChange={(e) => setAdvReason(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
            <button
              type="submit"
              className="rounded-xl bg-[#f58220] px-4 py-2 text-xs font-bold text-white"
            >
              Record Advance
            </button>
          </form>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Voucher</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Worker</th>
                  <th className="px-5 py-3">Reason</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {advances.map((a) => (
                  <tr key={a.id}>
                    <td className="px-5 py-3 font-mono font-bold">{a.advanceNumber}</td>
                    <td className="px-5 py-3">{a.advanceDate}</td>
                    <td className="px-5 py-3 font-bold text-[#092547]">{a.workerName}</td>
                    <td className="px-5 py-3 text-slate-600">{a.reason}</td>
                    <td className="px-5 py-3 text-right font-extrabold text-[#092547]">
                      {formatLkr(a.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <form
            onSubmit={handleRecordExpense}
            className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
          >
            <input
              type="date"
              required
              value={expDate}
              onChange={(e) => setExpDate(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
            <select
              value={expCategory}
              onChange={(e) => setExpCategory(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold"
            >
              <option value="FUEL">FUEL</option>
              <option value="ELECTRICITY">ELECTRICITY</option>
              <option value="MAINTENANCE">MAINTENANCE</option>
              <option value="BLASTING">BLASTING</option>
              <option value="TRANSPORT">TRANSPORT</option>
              <option value="OTHER">OTHER</option>
            </select>
            <input
              type="number"
              step="0.01"
              min="1"
              required
              placeholder="Amount (LKR)"
              value={expAmount}
              onChange={(e) => setExpAmount(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
            <input
              type="text"
              required
              minLength={3}
              placeholder="Expense description"
              value={expDesc}
              onChange={(e) => setExpDesc(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
            <button
              type="submit"
              className="rounded-xl bg-[#f58220] px-4 py-2 text-xs font-bold text-white"
            >
              Record Expense
            </button>
          </form>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Voucher</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.map((ex) => (
                  <tr key={ex.id}>
                    <td className="px-5 py-3 font-mono font-bold">{ex.expenseNumber}</td>
                    <td className="px-5 py-3">{ex.expenseDate}</td>
                    <td className="px-5 py-3 font-semibold">{ex.category}</td>
                    <td className="px-5 py-3 text-slate-600">{ex.description}</td>
                    <td className="px-5 py-3 text-right font-extrabold text-[#092547]">
                      {formatLkr(ex.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {salaryPayments.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                  Recent Disbursed Salary Receipts
                </h3>
              </div>
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-slate-100">
                  {salaryPayments.map((sp) => (
                    <tr key={sp.id}>
                      <td className="px-5 py-3 font-mono font-bold">{sp.salaryReceiptNumber}</td>
                      <td className="px-5 py-3">{sp.workerName}</td>
                      <td className="px-5 py-3">{sp.periodLabel}</td>
                      <td className="px-5 py-3 text-slate-500">{formatColomboDateTime(sp.createdAt)}</td>
                      <td className="px-5 py-3 text-right font-bold text-emerald-700">{formatLkr(sp.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Edit Draft Modal */}
      {editingEntry && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#092547]/55 p-4 backdrop-blur-sm"
        >
          <form
            onSubmit={handleSaveEntryEdit}
            className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-2xl"
          >
            <h3 className="text-base font-extrabold text-[#092547]">
              Edit Draft &mdash; {editingEntry.workerName}
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label>
                Base Pay
                <input type="number" step="0.01" min="0" value={editBase} onChange={(e) => setEditBase(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5" />
              </label>
              <label>
                Overtime Pay
                <input type="number" step="0.01" min="0" value={editOt} onChange={(e) => setEditOt(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5" />
              </label>
              <label>
                Allowances
                <input type="number" step="0.01" min="0" value={editAllow} onChange={(e) => setEditAllow(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5" />
              </label>
              <label>
                Deductions
                <input type="number" step="0.01" min="0" value={editDeduct} onChange={(e) => setEditDeduct(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5" />
              </label>
              <label className="col-span-2">
                Advance Deduction
                <input type="number" step="0.01" min="0" value={editAdvDeduct} onChange={(e) => setEditAdvDeduct(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5" />
              </label>
              <label className="col-span-2">
                Notes
                <input type="text" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5" />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <button type="button" onClick={() => setEditingEntry(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold">
                Cancel
              </button>
              <button type="submit" className="rounded-xl bg-[#092547] px-4 py-2 text-xs font-bold text-white">
                Save Draft Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Salary Payment Modal */}
      {payingEntry && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#092547]/55 p-4 backdrop-blur-sm"
        >
          <form
            onSubmit={handleRecordSalaryPayment}
            className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-2xl"
          >
            <h3 className="text-base font-extrabold text-[#092547]">
              Disburse Salary &mdash; {payingEntry.workerName}
            </h3>
            <p className="text-xs text-slate-500">
              Remaining Payable: <strong className="text-[#e77418]">{formatLkr(payingEntry.remainingPayable)}</strong>
            </p>
            <div className="space-y-2.5 text-xs">
              <label className="block">
                Payment Date
                <input type="date" required value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5" />
              </label>
              <label className="block">
                Amount (LKR)
                <input type="number" step="0.01" min="0.01" max={payingEntry.remainingPayable} required value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-bold" />
              </label>
              <label className="block">
                Method
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as "CASH" | "BANK_TRANSFER")} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5">
                  <option value="CASH">CASH</option>
                  <option value="BANK_TRANSFER">BANK_TRANSFER</option>
                </select>
              </label>
              <label className="block">
                Reference Note
                <input type="text" value={payNote} onChange={(e) => setPayNote(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5" />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <button type="button" onClick={() => setPayingEntry(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold">
                Cancel
              </button>
              <button type="submit" className="rounded-xl bg-[#f58220] px-4 py-2 text-xs font-bold text-white">
                Confirm Salary Payment
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

