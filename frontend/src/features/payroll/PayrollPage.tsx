import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client.ts";
import {
  adjustSalaryPayment,
  approvePayrollEntry,
  createPayrollPeriod,
  downloadPayrollExport,
  fetchOperationalExpenses,
  fetchPayrollPeriodEntries,
  fetchPayrollPeriods,
  fetchSalaryAuditHistory,
  fetchSalaryPaymentAdjustments,
  fetchSalaryPayments,
  fetchWorkerAdvances,
  fetchWorkers,
  initializeManualPeriod,
  recordOperationalExpense,
  recordSalaryPayment,
  recordWorkerAdvance,
  updateApprovedSalary,
  updateManualSalary,
} from "../../api/operations.ts";
import { Icon } from "../../components/ui/Icon.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import type {
  OperationalExpenseRecord,
  PayrollEntryRecord,
  PayrollPeriodRecord,
  SalaryAdjustmentType,
  SalaryAuditHistoryRecord,
  SalaryPaymentAdjustmentRecord,
  SalaryPaymentRecord,
  WorkerAdvanceRecord,
  WorkerRecord,
} from "../../types/operations.ts";
import { formatColomboDateTime, formatLkr } from "../../utils/formatters.ts";
import { colomboTodayIsoDate } from "../operations/spreadsheetUtils.ts";

type PayrollTab = "periods" | "advances" | "expenses" | "payments";

export function PayrollPage() {
  const { user } = useAuth();
  const isOwner = user?.role === "OWNER";

  const today = colomboTodayIsoDate();
  const [tab, setTab] = useState<PayrollTab>("periods");
  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [periods, setPeriods] = useState<PayrollPeriodRecord[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [entries, setEntries] = useState<PayrollEntryRecord[]>([]);
  const [advances, setAdvances] = useState<WorkerAdvanceRecord[]>([]);
  const [salaryPayments, setSalaryPayments] = useState<SalaryPaymentRecord[]>([]);
  const [expenses, setExpenses] = useState<OperationalExpenseRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Create Period form (Both Owner & Cashier)
  const [periodLabel, setPeriodLabel] = useState("");
  const [periodStart, setPeriodStart] = useState(`${today.slice(0, 7)}-01`);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [creatingPeriod, setCreatingPeriod] = useState(false);

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

  // Manual Salary Entry/Edit Modal State (Both Owner & Cashier)
  const [manualEntry, setManualEntry] = useState<PayrollEntryRecord | null>(null);
  const [manualGross, setManualGross] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);

  // Salary Payment Modal (Both Owner & Cashier - Strictly Cash)
  const [payingEntry, setPayingEntry] = useState<PayrollEntryRecord | null>(null);
  const [payDate, setPayDate] = useState(today);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"CASH" | "BANK_TRANSFER">("CASH");
  const [payNote, setPayNote] = useState("");
  const [payingSubmitting, setPayingSubmitting] = useState(false);

  // Correct Approved Salary Modal (Owner Only)
  const [correctingApprovedEntry, setCorrectingApprovedEntry] = useState<PayrollEntryRecord | null>(null);
  const [newApprovedGross, setNewApprovedGross] = useState("");
  const [approvedCorrectionReason, setApprovedCorrectionReason] = useState("");
  const [approvedCorrectionNotes, setApprovedCorrectionNotes] = useState("");
  const [correctingApprovedSubmitting, setCorrectingApprovedSubmitting] = useState(false);

  // Adjust Salary Payment Modal (Owner Only: Amount Correction & Void)
  const [adjustingPayment, setAdjustingPayment] = useState<SalaryPaymentRecord | null>(null);
  const [adjustmentType, setAdjustmentType] = useState<SalaryAdjustmentType>("AMOUNT_CORRECTION");
  const [adjustCorrectedAmount, setAdjustCorrectedAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  // Payment Adjustments History Modal (Owner Only)
  const [viewingPaymentAdjustments, setViewingPaymentAdjustments] = useState<SalaryPaymentRecord | null>(null);
  const [paymentAdjustmentsList, setPaymentAdjustmentsList] = useState<SalaryPaymentAdjustmentRecord[]>([]);
  const [loadingAdjustments, setLoadingAdjustments] = useState(false);

  // Salary Audit History Modal (Owner Only)
  const [auditEntry, setAuditEntry] = useState<PayrollEntryRecord | null>(null);
  const [auditPeriodId, setAuditPeriodId] = useState<number | null>(null);
  const [auditHistory, setAuditHistory] = useState<SalaryAuditHistoryRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId) || null;

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wList, perList, advList, salList, expList] =
        await Promise.all([
          fetchWorkers(true),
          fetchPayrollPeriods(),
          fetchWorkerAdvances(),
          isOwner ? fetchSalaryPayments() : Promise.resolve([]),
          fetchOperationalExpenses(),
        ]);
      setWorkers(wList);
      setPeriods(perList);
      setAdvances(advList);
      setSalaryPayments(salList);
      setExpenses(expList);
      if (wList.length > 0 && advWorkerId === 0) {
        setAdvWorkerId(wList[0].id);
      }
      const nextPeriodId = selectedPeriodId ?? perList[0]?.id ?? null;
      if (nextPeriodId !== null) {
        setSelectedPeriodId(nextPeriodId);
        const periodEntries = await fetchPayrollPeriodEntries(nextPeriodId);
        setEntries(periodEntries || []);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load payroll and expense records."
      );
    } finally {
      setLoading(false);
    }
  }, [advWorkerId, selectedPeriodId, isOwner]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function selectPeriod(periodId: number) {
    setSelectedPeriodId(periodId);
    setError(null);
    try {
      const list = await fetchPayrollPeriodEntries(periodId);
      setEntries(list || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load entries.");
    }
  }

  async function handleCreatePeriod(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatingPeriod(true);
    try {
      const created = await createPayrollPeriod({
        periodLabel: periodLabel.trim(),
        startDate: periodStart,
        endDate: periodEnd,
      });
      setPeriodLabel("");
      setSelectedPeriodId(created.id);
      setNotice(`Salary period "${created.periodLabel}" created with active worker drafts.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create salary period.");
    } finally {
      setCreatingPeriod(false);
    }
  }

  async function handleInitializePeriod() {
    if (!selectedPeriodId) return;
    setError(null);
    try {
      const list = await initializeManualPeriod(selectedPeriodId);
      setEntries(list);
      setNotice(`Initialized ${list.length} worker salary draft entries for this period.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to initialize entries.");
    }
  }

  function openManualSalaryModal(entry: PayrollEntryRecord) {
    setError(null);
    setManualEntry(entry);
    setManualGross(Number(entry.grossPay) > 0 ? entry.grossPay : "");
    setManualReason("");
    setManualNotes(entry.notes ?? "");
  }

  async function handleSaveManualSalary(e: React.FormEvent) {
    e.preventDefault();
    if (!manualEntry) return;
    setError(null);

    const trimmedReason = manualReason.trim();
    if (trimmedReason.length < 5) {
      setError("Please provide a business reason of at least 5 characters for this salary entry.");
      return;
    }

    const grossNum = Number(manualGross);
    if (isNaN(grossNum) || grossNum < 0) {
      setError("Please enter a valid non-negative gross salary amount.");
      return;
    }

    setManualSubmitting(true);
    try {
      const updated = await updateManualSalary(manualEntry.id, {
        expectedVersion: manualEntry.version,
        grossSalary: manualGross.trim(),
        reason: trimmedReason,
        notes: manualNotes.trim() || null,
      });

      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setNotice(`Salary for ${updated.workerName} updated successfully.`);
      setManualEntry(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to update worker salary."
      );
    } finally {
      setManualSubmitting(false);
    }
  }

  async function handleApproveEntry(entry: PayrollEntryRecord) {
    if (!isOwner) return;
    setError(null);
    try {
      const updated = await approvePayrollEntry(entry.id, entry.version);
      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setNotice(`Salary entry for ${updated.workerName} approved.`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to approve salary entry."
      );
    }
  }

  function openCorrectApprovedModal(entry: PayrollEntryRecord) {
    setError(null);
    setCorrectingApprovedEntry(entry);
    setNewApprovedGross(Number(entry.grossPay) > 0 ? entry.grossPay : "");
    setApprovedCorrectionReason("");
    setApprovedCorrectionNotes(entry.notes ?? "");
  }

  async function handleSaveCorrectApprovedSalary(e: React.FormEvent) {
    e.preventDefault();
    if (!correctingApprovedEntry || !isOwner) return;
    setError(null);

    const trimmedReason = approvedCorrectionReason.trim();
    if (trimmedReason.length < 5) {
      setError("Please provide a business reason of at least 5 characters for this salary correction.");
      return;
    }

    const grossNum = Number(newApprovedGross);
    if (isNaN(grossNum) || grossNum < 0) {
      setError("Please enter a valid non-negative gross salary amount.");
      return;
    }

    const advancesNum = Number(correctingApprovedEntry.advanceDeduction) || 0;
    const proposedNet = grossNum >= advancesNum ? grossNum - advancesNum : 0;
    const paidCashNum = Number(correctingApprovedEntry.paidAmount) || 0;

    if (proposedNet < paidCashNum) {
      setError(
        `Cannot reduce net payable (${formatLkr(proposedNet)}) below already disbursed cash (${formatLkr(paidCashNum)}). Please void or adjust existing payment records first.`
      );
      return;
    }

    setCorrectingApprovedSubmitting(true);
    try {
      const updated = await updateApprovedSalary(correctingApprovedEntry.id, {
        expectedVersion: correctingApprovedEntry.version,
        newGrossSalary: newApprovedGross.trim(),
        reason: trimmedReason,
        notes: approvedCorrectionNotes.trim() || null,
      });

      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setNotice(`Approved salary for ${updated.workerName} corrected successfully to ${formatLkr(updated.grossPay)}.`);
      setCorrectingApprovedEntry(null);
      await loadAll();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to correct approved salary."
      );
    } finally {
      setCorrectingApprovedSubmitting(false);
    }
  }

  async function handleRecordSalaryPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payingEntry) return;
    setError(null);

    const amountNum = Number(payAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError("Please enter a valid positive payment amount.");
      return;
    }
    const remainingNum = Number(payingEntry.remainingPayable);
    if (amountNum > remainingNum) {
      setError(`Payment amount cannot exceed remaining payable balance of ${formatLkr(payingEntry.remainingPayable)}.`);
      return;
    }

    setPayingSubmitting(true);
    try {
      const idempotencyKey = `PAY-${payingEntry.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const result = await recordSalaryPayment(payingEntry.id, {
        paymentDate: payDate,
        amount: payAmount.trim(),
        paymentMethod: "CASH", // strictly locked to CASH
        referenceNote: payNote.trim() || null,
        idempotencyKey,
      });
      setEntries((prev) =>
        prev.map((e) => (e.id === result.entry.id ? result.entry : e))
      );
      setPayingEntry(null);
      setNotice(
        `Disbursed ${formatLkr(result.payment.amount)} to ${result.payment.workerName} (${result.payment.salaryReceiptNumber}).`
      );
      await loadAll();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to record salary payment."
      );
    } finally {
      setPayingSubmitting(false);
    }
  }

  function openAdjustPaymentModal(payment: SalaryPaymentRecord, mode: SalaryAdjustmentType) {
    setError(null);
    setAdjustingPayment(payment);
    setAdjustmentType(mode);
    const currentEff = payment.effectiveAmount ?? payment.amount;
    setAdjustCorrectedAmount(mode === "AMOUNT_CORRECTION" ? currentEff : "0.00");
    setAdjustReason("");
  }

  async function handleSavePaymentAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!adjustingPayment || !isOwner) return;
    setError(null);

    const trimmedReason = adjustReason.trim();
    if (trimmedReason.length < 10) {
      setError("Please provide a business reason of at least 10 characters for this payment adjustment.");
      return;
    }

    if (adjustmentType === "AMOUNT_CORRECTION") {
      const amtNum = Number(adjustCorrectedAmount);
      if (isNaN(amtNum) || amtNum <= 0) {
        setError("Please enter a valid positive corrected amount.");
        return;
      }
    }

    setAdjustSubmitting(true);
    try {
      const idempotencyKey = `ADJ-${adjustingPayment.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const currentEff = adjustingPayment.effectiveAmount ?? adjustingPayment.amount;
      const res = await adjustSalaryPayment(adjustingPayment.id, {
        adjustmentType,
        correctedAmount: adjustmentType === "AMOUNT_CORRECTION" ? adjustCorrectedAmount.trim() : undefined,
        expectedPriorAmount: currentEff,
        reason: trimmedReason,
        idempotencyKey,
      });

      setNotice(
        adjustmentType === "VOID"
          ? `Payment ${adjustingPayment.salaryReceiptNumber} voided successfully (effective amount: Rs. 0.00). Unpaid balance restored.`
          : `Payment ${adjustingPayment.salaryReceiptNumber} corrected successfully to ${formatLkr(res.adjustment.correctedAmount ?? adjustCorrectedAmount)}.`
      );
      setAdjustingPayment(null);
      await loadAll();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to record payment adjustment."
      );
    } finally {
      setAdjustSubmitting(false);
    }
  }

  async function handleViewPaymentAdjustments(payment: SalaryPaymentRecord) {
    setViewingPaymentAdjustments(payment);
    setLoadingAdjustments(true);
    setError(null);
    try {
      const list = await fetchSalaryPaymentAdjustments(payment.id);
      setPaymentAdjustmentsList(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to fetch payment adjustments.");
    } finally {
      setLoadingAdjustments(false);
    }
  }

  async function openAuditHistory(entry?: PayrollEntryRecord, periodId?: number) {
    if (!isOwner) return;
    setAuditEntry(entry ?? null);
    setAuditPeriodId(periodId ?? null);
    setAuditLoading(true);
    setShowAuditModal(true);
    setError(null);
    try {
      const history = await fetchSalaryAuditHistory({
        entryId: entry?.id,
        periodId: periodId ?? (entry ? undefined : (selectedPeriodId ?? undefined)),
      });
      setAuditHistory(history);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load salary audit history."
      );
    } finally {
      setAuditLoading(false);
    }
  }

  async function handleRecordAdvance(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!advWorkerId || Number(advAmount) <= 0 || advReason.trim().length < 3) {
      setError("Please specify worker, valid amount, and at least 3 characters reason.");
      return;
    }
    try {
      const idempotencyKey = `ADV-${advWorkerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const rec = await recordWorkerAdvance({
        workerId: advWorkerId,
        advanceDate: advDate,
        amount: advAmount.trim(),
        reason: advReason.trim(),
        idempotencyKey,
      });
      setAdvAmount("");
      setAdvReason("");
      setNotice(`Advance ${rec.advanceNumber} recorded cleanly.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to record advance.");
    }
  }

  async function handleRecordExpense(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (Number(expAmount) <= 0 || expDesc.trim().length < 3) {
      setError("Please specify valid amount and description (min 3 chars).");
      return;
    }
    try {
      const idempotencyKey = `EXP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const rec = await recordOperationalExpense({
        expenseDate: expDate,
        category: expCategory,
        description: expDesc.trim(),
        amount: expAmount.trim(),
        idempotencyKey,
      });
      setExpDesc("");
      setExpAmount("");
      setNotice(`Operational expense ${rec.expenseNumber} recorded cleanly.`);
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

  // Pre-calculate applicable advances for manual entry modal
  const applicableAdvancesForModal =
    manualEntry && selectedPeriod
      ? advances.filter(
          (a) =>
            a.workerId === manualEntry.workerId &&
            a.advanceDate >= selectedPeriod.startDate &&
            a.advanceDate <= selectedPeriod.endDate
        )
      : [];

  const totalModalAdvances = applicableAdvancesForModal.reduce(
    (sum, a) => sum + Number(a.amount),
    0
  );

  const inputGrossNum = Number(manualGross) || 0;
  const advancesExceedGross = totalModalAdvances > inputGrossNum && inputGrossNum > 0;
  const excessAmount = advancesExceedGross ? totalModalAdvances - inputGrossNum : 0;
  const previewNetPayable =
    inputGrossNum >= totalModalAdvances ? inputGrossNum - totalModalAdvances : 0;

  return (
    <div className="mx-auto max-w-[1550px] p-4 md:p-8 lg:p-10">
      {/* Header */}
      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          {isOwner ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-purple-700">
              <Icon name="lock" className="h-3.5 w-3.5" />
              Owner Management Portal
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-blue-700">
              <Icon name="payments" className="h-3.5 w-3.5" />
              Cashier Operations Portal
            </span>
          )}
          <h1 className="mt-2 text-2xl font-extrabold text-[#092547] md:text-3xl">
            Salary Periods, Advances &amp; Operating Expenses
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isOwner
              ? "Full administrative authority: create custom salary periods, enter monthly salaries, approve payroll, disburse payments, and audit changes."
              : "Authorized access to view salary periods, enter or edit draft worker salaries, record advances, and record operating expenses."}
          </p>
        </div>

        {/* Primary Navigation Tabs */}
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-1">
          {(
            [
              ["periods", "Salary Periods"],
              ["advances", `Salary Advances (${advances.length})`],
              ["expenses", `Operating Expenses (${expenses.length})`],
              ...(isOwner
                ? [["payments", `Payment Receipts & Adjustments (${salaryPayments.length})`]]
                : []),
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id as PayrollTab)}
              className={`rounded-lg px-3.5 py-2 text-xs font-extrabold transition-colors ${
                tab === id
                  ? "bg-[#092547] text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Global Alerts */}
      {error && (
        <div
          role="alert"
          className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700 shadow-sm"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 shadow-sm"
        >
          {notice}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          Loading salary periods &amp; operational records...
        </div>
      ) : tab === "periods" ? (
        <div className="space-y-6">
          {/* Top Controls: Create Period Form & Selector (Both Owner & Cashier) */}
          <div className="grid gap-6 lg:grid-cols-2">
            <form
              onSubmit={handleCreatePeriod}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-extrabold text-[#092547]">
                  New Salary Period (Custom Date Range)
                </h2>
                <span className="text-[11px] font-semibold text-slate-400">
                  Auto-initializes active workers
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Period Label
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. November 2026, or Nov 1-15 Special"
                    value={periodLabel}
                    onChange={(e) => setPeriodLabel(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-[#092547] focus:border-[#092547] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Start Date
                  </label>
                  <input
                    type="date"
                    required
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-700 focus:border-[#092547] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    End Date
                  </label>
                  <input
                    type="date"
                    required
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-700 focus:border-[#092547] focus:outline-none"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={creatingPeriod}
                    className="w-full rounded-xl bg-[#f58220] px-4 py-2 text-xs font-bold text-white hover:bg-[#df7318] disabled:opacity-50"
                  >
                    {creatingPeriod ? "Creating..." : "Create Period"}
                  </button>
                </div>
              </div>
            </form>

            {/* Select Period & Export Controls */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-extrabold text-[#092547]">
                  Select Salary Period
                </h2>
                {selectedPeriod && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                      selectedPeriod.status === "APPROVED"
                        ? "bg-emerald-50 text-emerald-800"
                        : selectedPeriod.status === "CLOSED"
                        ? "bg-slate-100 text-slate-700"
                        : "bg-amber-50 text-amber-800"
                    }`}
                  >
                    Status: {selectedPeriod.status}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <select
                  aria-label="Select salary period"
                  value={selectedPeriodId ?? ""}
                  onChange={(e) => void selectPeriod(Number(e.target.value))}
                  className="min-w-[220px] flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-[#092547] focus:border-[#092547] focus:outline-none"
                >
                  {periods.length === 0 ? (
                    <option value="">No salary periods created yet</option>
                  ) : (
                    periods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.periodLabel} ({p.startDate} to {p.endDate}) [{p.status}]
                      </option>
                    ))
                  )}
                </select>

                {isOwner && selectedPeriod && entries.length === 0 && (
                  <button
                    type="button"
                    onClick={() => void handleInitializePeriod()}
                    className="rounded-xl bg-[#092547] px-4 py-2 text-xs font-bold text-white hover:bg-[#103462]"
                  >
                    Initialize Active Workers
                  </button>
                )}

                {isOwner && selectedPeriod && (
                  <button
                    type="button"
                    onClick={() => void openAuditHistory(undefined, selectedPeriod.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-purple-300 bg-purple-50 px-3 py-2 text-xs font-bold text-purple-800 hover:bg-purple-100"
                  >
                    <Icon name="history" className="h-3.5 w-3.5" />
                    Period Audit History
                  </button>
                )}
              </div>

              {/* Creator metadata for Owner */}
              {isOwner && selectedPeriod && (
                <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 text-[11px] text-slate-600">
                  <div>
                    Created by: <strong className="text-[#092547]">{selectedPeriod.createdByName || selectedPeriod.createdByUsername || "Unknown"}</strong>{" "}
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                      {selectedPeriod.createdByRole || "UNKNOWN"}
                    </span>{" "}
                    on {formatColomboDateTime(selectedPeriod.createdAt)}
                  </div>
                  {selectedPeriod.approvedAt && (
                    <div className="mt-1 text-emerald-800">
                      Approved by: <strong>{selectedPeriod.approvedByName || selectedPeriod.approvedByUsername || "Owner"}</strong>{" "}
                      <span className="rounded bg-emerald-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-900">
                        {selectedPeriod.approvedByRole || "OWNER"}
                      </span>{" "}
                      on {formatColomboDateTime(selectedPeriod.approvedAt)}
                    </div>
                  )}
                </div>
              )}

              {/* Exports */}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                <span className="text-[11px] font-bold text-slate-400">Reports:</span>
                {(["csv", "xlsx", "pdf"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    disabled={!selectedPeriodId}
                    onClick={() => void handleExportPayroll(fmt)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-bold text-[#092547] hover:bg-slate-50 disabled:opacity-50"
                  >
                    Export {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Worker Salary Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-3">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Worker Salary Records &mdash; {selectedPeriod?.periodLabel ?? "No Period Selected"}
              </h3>
            </div>
            <table className="w-full min-w-[1100px] text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Worker</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3 text-right">Gross Salary (LKR)</th>
                  <th className="px-4 py-3 text-right">Applicable Advances</th>
                  <th className="px-4 py-3 text-right">Net Salary Payable</th>
                  <th className="px-4 py-3 text-right">Paid / Balance Due</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                      {isOwner
                        ? "No salary entries found for this period. Click 'Initialize Active Workers' above to populate draft entries."
                        : "No salary entries recorded for this period yet."}
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => {
                    const grossVal = Number(entry.grossPay) || 0;
                    const advVal = Number(entry.advanceDeduction) || 0;
                    const isExcessAdv = advVal > grossVal && grossVal > 0;
                    const excessAmt = isExcessAdv ? advVal - grossVal : 0;

                    return (
                      <tr key={entry.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <p className="font-bold text-[#092547]">{entry.workerName}</p>
                          <p className="text-[11px] text-slate-400">
                            {entry.workerCode} &middot; {entry.designation}
                          </p>
                        </td>

                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                              entry.calculationMode === "OWNER_MANUAL_DRAFT"
                                ? "bg-amber-50 text-amber-800"
                                : "bg-blue-50 text-blue-800"
                            }`}
                          >
                            {entry.calculationMode === "OWNER_MANUAL_DRAFT"
                              ? "Manual Draft"
                              : "Auto Rule"}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-right font-semibold">
                          {grossVal > 0 ? (
                            formatLkr(entry.grossPay)
                          ) : (
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">
                              Rs. 0.00
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3 text-right">
                          <span className="font-semibold text-slate-700">
                            {formatLkr(entry.advanceDeduction)}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-right">
                          <span className="font-extrabold text-[#092547]">
                            {formatLkr(entry.netPayable)}
                          </span>
                          {isExcessAdv && (
                            <span className="mt-0.5 block text-[10px] font-bold text-rose-600">
                              ⚠ Advances exceed by {formatLkr(excessAmt)}
                            </span>
                          )}
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

                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                              entry.status === "APPROVED"
                                ? "bg-emerald-100 text-emerald-800"
                                : entry.status === "CANCELLED"
                                ? "bg-rose-100 text-rose-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {entry.status}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {entry.status === "DRAFT" && (
                              <>
                                {/* Enter/Edit Salary is available to BOTH Owner and Cashier */}
                                <button
                                  type="button"
                                  onClick={() => openManualSalaryModal(entry)}
                                  className="rounded-lg bg-[#092547] px-3 py-1 font-bold text-white hover:bg-[#103462]"
                                >
                                  {grossVal > 0 ? "Edit Salary" : "Enter Salary"}
                                </button>

                                {/* Approve is strictly Owner-only */}
                                {isOwner && (
                                  <button
                                    type="button"
                                    onClick={() => void handleApproveEntry(entry)}
                                    title={
                                      isExcessAdv
                                        ? `Approval blocked: advances exceed gross salary by ${formatLkr(excessAmt)}`
                                        : "Approve Salary"
                                    }
                                    className={`rounded-lg px-2.5 py-1 font-bold text-white ${
                                      isExcessAdv
                                        ? "bg-rose-500 hover:bg-rose-600"
                                        : "bg-emerald-600 hover:bg-emerald-700"
                                    }`}
                                  >
                                    Approve
                                  </button>
                                )}
                              </>
                            )}

                            {/* Pay Salary is available to BOTH Owner and Cashier on approved entries with unpaid balance */}
                            {entry.status === "APPROVED" && Number(entry.remainingPayable) > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPayingEntry(entry);
                                  setPayDate(today);
                                  setPayAmount(entry.remainingPayable);
                                  setPayMethod("CASH");
                                  setPayNote("");
                                }}
                                className="rounded-lg bg-[#f58220] px-2.5 py-1 font-bold text-white hover:bg-[#df7318]"
                              >
                                Pay Salary
                              </button>
                            )}

                            {/* Correct Salary is strictly Owner-only on approved entries */}
                            {entry.status === "APPROVED" && isOwner && (
                              <button
                                type="button"
                                onClick={() => openCorrectApprovedModal(entry)}
                                className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 font-bold text-amber-800 hover:bg-amber-100"
                              >
                                Correct Salary
                              </button>
                            )}

                            {/* Audit History is strictly Owner-only */}
                            {isOwner && (
                              <button
                                type="button"
                                onClick={() => void openAuditHistory(entry)}
                                title="View Salary Audit History"
                                className="rounded-lg border border-purple-200 bg-purple-50 px-2 py-1 font-bold text-purple-700 hover:bg-purple-100"
                              >
                                History
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === "advances" ? (
        /* Salary Advances Tab */
        <div className="space-y-6">
          <form
            onSubmit={handleRecordAdvance}
            className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
          >
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Worker
              </label>
              <select
                value={advWorkerId}
                onChange={(e) => setAdvWorkerId(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-[#092547]"
              >
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.fullName} ({w.workerCode})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Date
              </label>
              <input
                type="date"
                required
                value={advDate}
                onChange={(e) => setAdvDate(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Amount (LKR)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="Amount (LKR)"
                value={advAmount}
                onChange={(e) => setAdvAmount(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-[#092547]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Reason
              </label>
              <input
                type="text"
                required
                minLength={3}
                placeholder="Reason"
                value={advReason}
                onChange={(e) => setAdvReason(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full rounded-xl bg-[#092547] px-4 py-2 text-xs font-bold text-white hover:bg-[#103462]"
              >
                Record Advance
              </button>
            </div>
          </form>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Advance No.</th>
                  <th className="px-5 py-3">Worker</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3 text-right">Amount (LKR)</th>
                  <th className="px-5 py-3">Reason</th>
                  <th className="px-5 py-3">Authorized By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {advances.map((adv) => (
                  <tr key={adv.id}>
                    <td className="px-5 py-3 font-mono font-bold text-[#092547]">{adv.advanceNumber}</td>
                    <td className="px-5 py-3 font-semibold">{adv.workerName} ({adv.workerCode})</td>
                    <td className="px-5 py-3 text-slate-600">{adv.advanceDate}</td>
                    <td className="px-5 py-3 text-right font-extrabold text-[#092547]">{formatLkr(adv.amount)}</td>
                    <td className="px-5 py-3 text-slate-600">{adv.reason}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[#092547]">
                          {adv.authorizedByName ||
                            adv.authorizedByUsername ||
                            adv.authorizedByOwnerName ||
                            "System"}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            adv.authorizedByRole === "CASHIER"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-purple-100 text-purple-800"
                          }`}
                        >
                          {adv.authorizedByRole || "OWNER"}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === "expenses" ? (
        /* Operating Expenses Tab */
        <div className="space-y-6">
          <form
            onSubmit={handleRecordExpense}
            className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
          >
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Date
              </label>
              <input
                type="date"
                required
                value={expDate}
                onChange={(e) => setExpDate(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Category
              </label>
              <select
                value={expCategory}
                onChange={(e) => setExpCategory(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold"
              >
                <option value="FUEL">FUEL</option>
                <option value="ELECTRICITY">ELECTRICITY</option>
                <option value="SPARES">SPARES</option>
                <option value="EXPLOSIVES">EXPLOSIVES</option>
                <option value="MAINTENANCE">MAINTENANCE</option>
                <option value="TEA_MEALS">TEA_MEALS</option>
                <option value="OFFICE">OFFICE</option>
                <option value="MISC">MISC</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Description
              </label>
              <input
                type="text"
                required
                minLength={3}
                placeholder="Expense description"
                value={expDesc}
                onChange={(e) => setExpDesc(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Amount (LKR)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="Amount (LKR)"
                value={expAmount}
                onChange={(e) => setExpAmount(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full rounded-xl bg-[#092547] px-4 py-2 text-xs font-bold text-white hover:bg-[#103462]"
              >
                Record Expense
              </button>
            </div>
          </form>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Expense No.</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3 text-right">Amount (LKR)</th>
                  <th className="px-5 py-3">Recorded By</th>
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
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[#092547]">
                          {ex.recordedByName ||
                            ex.recordedByUsername ||
                            ex.recordedByOwnerName ||
                            "System"}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            ex.recordedByRole === "CASHIER"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-purple-100 text-purple-800"
                          }`}
                        >
                          {ex.recordedByRole || "OWNER"}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      ) : tab === "payments" && isOwner ? (
        /* Payment Receipts & Adjustments Tab (Owner Only) */
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-sm font-extrabold text-[#092547]">
                  Disbursed Salary Payment Receipts &amp; Adjustments
                </h2>
                <p className="text-xs text-slate-500">
                  Immutable cash disbursement receipts. Correct amounts or void receipts via the append-only audit ledger.
                </p>
              </div>
              <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-bold text-purple-700">
                Total Receipts: {salaryPayments.length}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[950px] text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Receipt No.</th>
                  <th className="px-5 py-3">Payment Date</th>
                  <th className="px-5 py-3">Worker</th>
                  <th className="px-5 py-3">Period</th>
                  <th className="px-5 py-3 text-right">Original (LKR)</th>
                  <th className="px-5 py-3 text-right">Effective (LKR)</th>
                  <th className="px-5 py-3">Disbursed By</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {salaryPayments.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-10 text-center text-slate-400">
                      No salary payments disbursed yet.
                    </td>
                  </tr>
                ) : (
                  salaryPayments.map((sp) => {
                    const origAmt = Number(sp.amount) || 0;
                    const effAmt = Number(sp.effectiveAmount ?? sp.amount) || 0;
                    const isVoided = effAmt === 0;
                    const isAdjusted = effAmt > 0 && Math.abs(effAmt - origAmt) > 0.001;

                    return (
                      <tr key={sp.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-3 font-mono font-bold text-[#092547]">
                          {sp.salaryReceiptNumber}
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          {sp.paymentDate}
                        </td>
                        <td className="px-5 py-3 font-semibold text-[#092547]">
                          {sp.workerName}
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          {sp.periodLabel}
                        </td>
                        <td className="px-5 py-3 text-right font-mono font-medium text-slate-500">
                          {formatLkr(sp.amount)}
                        </td>
                        <td className="px-5 py-3 text-right font-mono font-extrabold text-[#092547]">
                          {formatLkr(effAmt)}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-[#092547]">
                              {sp.paidByOwnerName || sp.paidByOwnerUsername || "Staff"}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                                sp.paidByOwnerRole === "CASHIER"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-purple-100 text-purple-800"
                              }`}
                            >
                              {sp.paidByOwnerRole || "OWNER"}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {isVoided ? (
                            <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-bold text-rose-800">
                              VOIDED
                            </span>
                          ) : isAdjusted ? (
                            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                              ADJUSTED
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                              PAID
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {!isVoided ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openAdjustPaymentModal(sp, "AMOUNT_CORRECTION")}
                                  className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 font-bold text-amber-800 hover:bg-amber-100"
                                >
                                  Correct Amount
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openAdjustPaymentModal(sp, "VOID")}
                                  className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 font-bold text-rose-800 hover:bg-rose-100"
                                >
                                  Void Payment
                                </button>
                              </>
                            ) : (
                              <span className="text-[11px] font-semibold text-slate-400 italic">
                                Voided
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleViewPaymentAdjustments(sp)}
                              className="rounded-lg border border-purple-200 bg-purple-50 px-2 py-1 font-bold text-purple-700 hover:bg-purple-100"
                            >
                              Adjustments
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Manual Salary Entry / Edit Modal (Both Owner & Cashier) */}
      {manualEntry && selectedPeriod && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#092547]/55 p-4 backdrop-blur-sm"
        >
          <form
            onSubmit={handleSaveManualSalary}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">
                  {selectedPeriod.periodLabel} ({selectedPeriod.startDate} to {selectedPeriod.endDate})
                </span>
                <span className="text-[11px] font-bold text-amber-700">DRAFT</span>
              </div>
              <h3 className="mt-2 text-lg font-extrabold text-[#092547]">
                {Number(manualEntry.grossPay) > 0 ? "Edit Manual Salary" : "Enter Manual Salary"}
              </h3>
              <p className="text-xs text-slate-500">
                Worker: <strong className="text-[#092547]">{manualEntry.workerName}</strong> ({manualEntry.workerCode} &middot; {manualEntry.designation})
              </p>
            </div>

            {/* Applicable Advances Breakdown Box */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
                  Applicable Advances in this Period ({applicableAdvancesForModal.length})
                </h4>
                <span className="text-xs font-bold text-slate-700">
                  Total: {formatLkr(totalModalAdvances)}
                </span>
              </div>

              {applicableAdvancesForModal.length === 0 ? (
                <p className="text-xs text-slate-400 italic">
                  No salary advances recorded for this worker between {selectedPeriod.startDate} and {selectedPeriod.endDate}.
                </p>
              ) : (
                <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-100 text-slate-500">
                      <tr>
                        <th className="px-2.5 py-1.5">No.</th>
                        <th className="px-2.5 py-1.5">Date</th>
                        <th className="px-2.5 py-1.5">Reason</th>
                        <th className="px-2.5 py-1.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {applicableAdvancesForModal.map((adv) => (
                        <tr key={adv.id}>
                          <td className="px-2.5 py-1 font-mono font-bold text-[#092547]">{adv.advanceNumber}</td>
                          <td className="px-2.5 py-1 text-slate-600">{adv.advanceDate}</td>
                          <td className="px-2.5 py-1 text-slate-600">{adv.reason}</td>
                          <td className="px-2.5 py-1 text-right font-bold text-rose-700">{formatLkr(adv.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Gross Salary Input */}
            <div>
              <label className="mb-1 block text-xs font-bold text-[#092547]">
                Manual Gross Salary (LKR) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="e.g. 65000.00"
                value={manualGross}
                onChange={(e) => setManualGross(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-base font-extrabold text-[#092547] focus:border-[#092547] focus:outline-none"
              />
            </div>

            {/* Real-time Calculation Summary Card */}
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3.5">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Gross Salary
                  </span>
                  <span className="font-extrabold text-[#092547]">
                    {formatLkr(inputGrossNum)}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Advances Deducted
                  </span>
                  <span className="font-extrabold text-rose-700">
                    -{formatLkr(totalModalAdvances)}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Net Salary Payable
                  </span>
                  <span className="font-extrabold text-emerald-800">
                    {formatLkr(previewNetPayable)}
                  </span>
                </div>
              </div>

              {/* Excess Advances Warning */}
              {advancesExceedGross && (
                <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-xs text-rose-800">
                  <p className="font-extrabold">
                    ⚠ Warning: Applicable advances ({formatLkr(totalModalAdvances)}) exceed gross salary ({formatLkr(inputGrossNum)}) by {formatLkr(excessAmount)}!
                  </p>
                  <p className="mt-0.5 text-[11px] font-normal text-rose-700">
                    Net salary will be recorded as Rs. 0.00. Salary approval will remain strictly blocked until this excess is resolved.
                  </p>
                </div>
              )}
            </div>

            {/* Mandatory Reason */}
            <div>
              <label className="mb-1 block text-xs font-bold text-[#092547]">
                Business Reason (Mandatory &mdash; min 5 chars) *
              </label>
              <input
                type="text"
                required
                minLength={5}
                placeholder="e.g. Agreed monthly salary per November site schedule"
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-[#092547] focus:outline-none"
              />
              {manualReason.length > 0 && manualReason.trim().length < 5 && (
                <p className="mt-1 text-[11px] text-rose-600">
                  Reason must be at least 5 characters (currently {manualReason.trim().length}).
                </p>
              )}
            </div>

            {/* Notes (Optional) */}
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="Optional notes or adjustment context"
                value={manualNotes}
                onChange={(e) => setManualNotes(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-[#092547] focus:outline-none"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setManualEntry(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={manualSubmitting || manualReason.trim().length < 5}
                className="rounded-xl bg-[#092547] px-5 py-2 text-xs font-bold text-white hover:bg-[#103462] disabled:opacity-50"
              >
                {manualSubmitting ? "Saving..." : "Save Salary Draft"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Salary Payment Modal (Both Owner & Cashier - Strictly Cash) */}
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
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-[#092547]">
                Disburse Cash Salary &mdash; {payingEntry.workerName}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Worker Code: <strong>{payingEntry.workerCode}</strong> &middot; Designation: {payingEntry.designation}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Remaining Balance Due: <strong className="text-[#e77418]">{formatLkr(payingEntry.remainingPayable)}</strong>
              </p>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-bold text-slate-600">Payment Date</label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-700"
                />
              </div>
              <div>
                <label className="mb-1 block font-bold text-slate-600">Disbursed Amount (LKR) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={payingEntry.remainingPayable}
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-extrabold text-[#092547]"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Cannot exceed remaining payable balance of {formatLkr(payingEntry.remainingPayable)}.
                </p>
              </div>
              <div>
                <label className="mb-1 block font-bold text-slate-600">Payment Method</label>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                  CASH (Physical Cash Voucher &mdash; strictly append-only)
                </div>
              </div>
              <div>
                <label className="mb-1 block font-bold text-slate-600">Reference Note (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Over-the-counter cash handover"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-700"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2.5 pt-3">
              <button
                type="button"
                onClick={() => setPayingEntry(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={payingSubmitting}
                className="rounded-xl bg-[#f58220] px-4 py-2 text-xs font-bold text-white hover:bg-[#df7318] disabled:opacity-50"
              >
                {payingSubmitting ? "Disbursing..." : "Confirm Cash Payment"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Correct Approved Salary Modal (Owner Only) */}
      {correctingApprovedEntry && isOwner && (() => {
        const currentGross = Number(correctingApprovedEntry.grossPay) || 0;
        const advancesDeducted = Number(correctingApprovedEntry.advanceDeduction) || 0;
        const paidCash = Number(correctingApprovedEntry.paidAmount) || 0;
        const proposedGrossNum = Number(newApprovedGross) || 0;
        const proposedNet = proposedGrossNum >= advancesDeducted ? proposedGrossNum - advancesDeducted : 0;
        const proposedRemaining = Math.max(0, proposedNet - paidCash);
        const proposedExcessAdvances = advancesDeducted > proposedGrossNum && proposedGrossNum > 0 ? advancesDeducted - proposedGrossNum : 0;
        const isFloorViolated = proposedNet < paidCash;

        return (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#092547]/55 p-4 backdrop-blur-sm"
          >
            <form
              onSubmit={handleSaveCorrectApprovedSalary}
              className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-2xl"
            >
              <div className="border-b border-slate-100 pb-3">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                    APPROVED ENTRY CORRECTION
                  </span>
                  <span className="text-[11px] font-bold text-purple-700">Owner Authorization</span>
                </div>
                <h3 className="mt-2 text-lg font-extrabold text-[#092547]">
                  Correct Approved Salary &mdash; {correctingApprovedEntry.workerName}
                </h3>
                <p className="text-xs text-slate-500">
                  Worker: <strong className="text-[#092547]">{correctingApprovedEntry.workerName}</strong> ({correctingApprovedEntry.workerCode} &middot; {correctingApprovedEntry.designation})
                </p>
              </div>

              {/* Financial Status Breakdown */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <span className="block text-[10px] font-bold uppercase text-slate-400">Current Gross</span>
                    <span className="font-bold text-slate-700">{formatLkr(currentGross)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold uppercase text-slate-400">Advances Deducted</span>
                    <span className="font-bold text-rose-700">-{formatLkr(advancesDeducted)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold uppercase text-slate-400">Already Paid Cash</span>
                    <span className="font-bold text-emerald-700">{formatLkr(paidCash)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold uppercase text-slate-400">Current Remaining</span>
                    <span className="font-bold text-[#e77418]">{formatLkr(correctingApprovedEntry.remainingPayable)}</span>
                  </div>
                </div>
              </div>

              {/* Proposed Gross Input */}
              <div>
                <label className="mb-1 block text-xs font-bold text-[#092547]">
                  Proposed New Gross Salary (LKR) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  placeholder="e.g. 70000.00"
                  value={newApprovedGross}
                  onChange={(e) => setNewApprovedGross(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-base font-extrabold text-[#092547] focus:border-[#092547] focus:outline-none"
                />
              </div>

              {/* Live Preview Card */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3.5">
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <span className="block text-[10px] font-bold uppercase text-slate-400">Proposed Net Payable</span>
                    <span className="font-extrabold text-emerald-800">{formatLkr(proposedNet)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold uppercase text-slate-400">Already Paid Cash</span>
                    <span className="font-bold text-slate-700">{formatLkr(paidCash)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold uppercase text-slate-400">New Remaining Balance</span>
                    <span className="font-extrabold text-[#e77418]">{formatLkr(proposedRemaining)}</span>
                  </div>
                </div>

                {proposedExcessAdvances > 0 && (
                  <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                    <p className="font-bold">
                      ⚠ Advances ({formatLkr(advancesDeducted)}) exceed proposed gross ({formatLkr(proposedGrossNum)}) by {formatLkr(proposedExcessAdvances)}.
                    </p>
                    <p className="mt-0.5 text-[11px]">Net payable will be Rs. 0.00.</p>
                  </div>
                )}

                {isFloorViolated && (
                  <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-xs text-rose-800">
                    <p className="font-extrabold">
                      ⛔ Submission Blocked: Floor Invariant Violation
                    </p>
                    <p className="mt-0.5 text-[11px]">
                      Proposed net salary ({formatLkr(proposedNet)}) cannot be lower than already disbursed cash ({formatLkr(paidCash)}). Please void or adjust existing payment records first.
                    </p>
                  </div>
                )}
              </div>

              {/* Mandatory Reason */}
              <div>
                <label className="mb-1 block text-xs font-bold text-[#092547]">
                  Business Reason (Mandatory &mdash; min 5 chars) *
                </label>
                <input
                  type="text"
                  required
                  minLength={5}
                  placeholder="e.g. Correcting site supervisor rate adjustment per owner agreement"
                  value={approvedCorrectionReason}
                  onChange={(e) => setApprovedCorrectionReason(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-[#092547] focus:outline-none"
                />
                {approvedCorrectionReason.length > 0 && approvedCorrectionReason.trim().length < 5 && (
                  <p className="mt-1 text-[11px] text-rose-600">
                    Reason must be at least 5 characters (currently {approvedCorrectionReason.trim().length}).
                  </p>
                )}
              </div>

              {/* Optional Notes */}
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Optional context for this correction"
                  value={approvedCorrectionNotes}
                  onChange={(e) => setApprovedCorrectionNotes(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-800"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setCorrectingApprovedEntry(null)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={correctingApprovedSubmitting || approvedCorrectionReason.trim().length < 5 || isFloorViolated}
                  className="rounded-xl bg-[#092547] px-5 py-2 text-xs font-bold text-white hover:bg-[#103462] disabled:opacity-50"
                >
                  {correctingApprovedSubmitting ? "Saving..." : "Confirm Salary Correction"}
                </button>
              </div>
            </form>
          </div>
        );
      })()}

      {/* Adjust Salary Payment Modal (Owner Only: Amount Correction & Void) */}
      {adjustingPayment && isOwner && (() => {
        const currentEff = Number(adjustingPayment.effectiveAmount ?? adjustingPayment.amount) || 0;
        const newAmtNum = Number(adjustCorrectedAmount) || 0;
        const delta = adjustmentType === "VOID" ? -currentEff : newAmtNum - currentEff;

        return (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#092547]/55 p-4 backdrop-blur-sm"
          >
            <form
              onSubmit={handleSavePaymentAdjustment}
              className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-2xl"
            >
              <div className="border-b border-slate-100 pb-3">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-purple-50 px-2.5 py-0.5 text-[11px] font-bold text-purple-700">
                    APPEND-ONLY PAYMENT ADJUSTMENT
                  </span>
                  <span className="text-[11px] font-bold text-slate-400">
                    Receipt: {adjustingPayment.salaryReceiptNumber}
                  </span>
                </div>
                <h3 className="mt-2 text-lg font-extrabold text-[#092547]">
                  {adjustmentType === "VOID" ? "Void Salary Payment" : "Correct Payment Amount"}
                </h3>
                <p className="text-xs text-slate-500">
                  Worker: <strong className="text-[#092547]">{adjustingPayment.workerName}</strong> &middot; Period: {adjustingPayment.periodLabel}
                </p>
              </div>

              {/* Mode Toggle */}
              <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setAdjustmentType("AMOUNT_CORRECTION");
                    setAdjustCorrectedAmount(String(currentEff));
                  }}
                  className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors ${
                    adjustmentType === "AMOUNT_CORRECTION"
                      ? "bg-white text-[#092547] shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Amount Correction
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdjustmentType("VOID");
                    setAdjustCorrectedAmount("0.00");
                  }}
                  className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors ${
                    adjustmentType === "VOID"
                      ? "bg-rose-600 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Void Payment
                </button>
              </div>

              {/* Financial Snapshot */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div>
                    <span className="block text-[10px] font-bold uppercase text-slate-400">Original Amount</span>
                    <span className="font-bold text-slate-600">{formatLkr(adjustingPayment.amount)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold uppercase text-slate-400">Current Effective</span>
                    <span className="font-bold text-[#092547]">{formatLkr(currentEff)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold uppercase text-slate-400">Adjustment Delta</span>
                    <span
                      className={`font-extrabold ${
                        delta > 0 ? "text-emerald-700" : delta < 0 ? "text-rose-700" : "text-slate-600"
                      }`}
                    >
                      {delta >= 0 ? `+${formatLkr(delta)}` : formatLkr(delta)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Input for Amount Correction */}
              {adjustmentType === "AMOUNT_CORRECTION" ? (
                <div>
                  <label className="mb-1 block text-xs font-bold text-[#092547]">
                    Corrected Amount (LKR) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="e.g. 50000.00"
                    value={adjustCorrectedAmount}
                    onChange={(e) => setAdjustCorrectedAmount(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-extrabold text-[#092547] focus:border-[#092547] focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    The difference ({delta >= 0 ? `+${formatLkr(delta)}` : formatLkr(delta)}) will be recorded in the adjustment ledger.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800">
                  <p className="font-extrabold">Notice on Void Operation:</p>
                  <p className="mt-1">
                    This will void the payment of {formatLkr(currentEff)}, setting effective amount to Rs. 0.00 while preserving the immutable original receipt in the ledger. The unpaid balance on the worker's salary will be restored immediately.
                  </p>
                </div>
              )}

              {/* Mandatory Reason */}
              <div>
                <label className="mb-1 block text-xs font-bold text-[#092547]">
                  Business Reason (Mandatory &mdash; min 10 chars) *
                </label>
                <input
                  type="text"
                  required
                  minLength={10}
                  placeholder="e.g. Corrected over-disbursement voucher per owner reconciliation"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-[#092547] focus:outline-none"
                />
                {adjustReason.length > 0 && adjustReason.trim().length < 10 && (
                  <p className="mt-1 text-[11px] text-rose-600">
                    Reason must be at least 10 characters (currently {adjustReason.trim().length}).
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustingPayment(null)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    adjustSubmitting ||
                    adjustReason.trim().length < 10 ||
                    (adjustmentType === "AMOUNT_CORRECTION" && (Number(adjustCorrectedAmount) <= 0 || isNaN(Number(adjustCorrectedAmount))))
                  }
                  className={`rounded-xl px-5 py-2 text-xs font-bold text-white disabled:opacity-50 ${
                    adjustmentType === "VOID"
                      ? "bg-rose-600 hover:bg-rose-700"
                      : "bg-[#092547] hover:bg-[#103462]"
                  }`}
                >
                  {adjustSubmitting
                    ? "Recording..."
                    : adjustmentType === "VOID"
                    ? "Confirm Void Payment"
                    : "Confirm Amount Correction"}
                </button>
              </div>
            </form>
          </div>
        );
      })()}

      {/* Payment Adjustments History Modal (Owner Only) */}
      {viewingPaymentAdjustments && isOwner && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#092547]/55 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-4xl space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-[#092547]">
                  Payment Adjustment History
                </h3>
                <p className="text-xs text-slate-500">
                  Receipt: <strong>{viewingPaymentAdjustments.salaryReceiptNumber}</strong> &middot; Worker: {viewingPaymentAdjustments.workerName} &middot; Original: {formatLkr(viewingPaymentAdjustments.amount)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingPaymentAdjustments(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>

            {loadingAdjustments ? (
              <div className="p-8 text-center text-xs text-slate-400">
                Loading adjustment records...
              </div>
            ) : paymentAdjustmentsList.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No adjustments recorded for this payment receipt.
              </div>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Adjustment No.</th>
                      <th className="px-4 py-2.5">Date &amp; Time</th>
                      <th className="px-4 py-2.5">Type</th>
                      <th className="px-4 py-2.5 text-right">Prior Amount</th>
                      <th className="px-4 py-2.5 text-right">Corrected Amount</th>
                      <th className="px-4 py-2.5 text-right">Delta</th>
                      <th className="px-4 py-2.5">Authorized By</th>
                      <th className="px-4 py-2.5">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paymentAdjustmentsList.map((adj) => (
                      <tr key={adj.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 font-mono font-bold text-[#092547]">
                          {adj.adjustmentNumber}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 font-mono text-[11px]">
                          {formatColomboDateTime(adj.createdAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                              adj.adjustmentType === "VOID"
                                ? "bg-rose-100 text-rose-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {adj.adjustmentType}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-medium text-slate-500">
                          {formatLkr(adj.priorEffectiveAmount)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-[#092547]">
                          {formatLkr(adj.correctedAmount)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-mono font-extrabold ${
                            Number(adj.adjustmentDelta) >= 0 ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {Number(adj.adjustmentDelta) >= 0 ? `+${formatLkr(adj.adjustmentDelta)}` : formatLkr(adj.adjustmentDelta)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-[#092547]">
                              {adj.authorizedByName || adj.authorizedByUsername || "Owner"}
                            </span>
                            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-bold text-purple-800">
                              {adj.authorizedByRole || "OWNER"}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          {adj.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setViewingPaymentAdjustments(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Salary Audit History Modal (Owner Only) */}
      {showAuditModal && isOwner && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#092547]/55 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-5xl space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-[#092547]">
                  Salary Audit History
                </h3>
                <p className="text-xs text-slate-500">
                  {auditEntry
                    ? `Worker: ${auditEntry.workerName} (${auditEntry.workerCode})`
                    : `Period: ${selectedPeriod?.periodLabel ?? "Selected Period"}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAuditModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>

            {auditLoading ? (
              <div className="p-8 text-center text-xs text-slate-400">
                Loading audit trail...
              </div>
            ) : auditHistory.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No salary modification history recorded yet.
              </div>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Date &amp; Time</th>
                      <th className="px-4 py-2.5">Action &amp; Type</th>
                      <th className="px-4 py-2.5">Actor</th>
                      <th className="px-4 py-2.5">Worker</th>
                      <th className="px-4 py-2.5 text-right">Prev &rarr; New Gross</th>
                      <th className="px-4 py-2.5 text-right">Advances</th>
                      <th className="px-4 py-2.5 text-right">Net Payable</th>
                      <th className="px-4 py-2.5">Reason &amp; Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditHistory.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 text-slate-500 font-mono text-[11px]">
                          {formatColomboDateTime(item.createdAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          {item.action === "UPDATE_APPROVED_SALARY" ? (
                            <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-[10px] font-bold text-purple-800">
                              Approved Correction
                            </span>
                          ) : item.action === "UPDATE_MANUAL_SALARY" ? (
                            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold text-blue-800">
                              Draft Edit
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                              {item.action}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-[#092547]">
                              {item.actorUsername}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                                item.actorRole === "CASHIER"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-purple-100 text-purple-800"
                              }`}
                            >
                              {item.actorRole}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-medium">
                          {item.workerName || item.workerCode || "Worker"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold">
                          <span className="text-slate-400">
                            {item.previousGrossSalary !== null ? formatLkr(item.previousGrossSalary) : "-"}
                          </span>
                          {" \u2192 "}
                          <span className="text-[#092547]">
                            {item.newGrossSalary !== null ? formatLkr(item.newGrossSalary) : "-"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-rose-700">
                          {item.applicableAdvances !== null ? formatLkr(item.applicableAdvances) : "-"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-extrabold text-emerald-800">
                          {item.calculatedNetPayable !== null ? formatLkr(item.calculatedNetPayable) : "-"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          <p className="font-medium">{item.reason}</p>
                          {item.notes && (
                            <p className="text-[11px] text-slate-400">{item.notes}</p>
                          )}
                          {item.excessAdvances && (
                            <p className="text-[11px] font-bold text-rose-600">
                              Excess: {formatLkr(item.excessAdvances)}
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowAuditModal(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
