import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMaterials } from "../../api/billing.ts";
import { ApiError } from "../../api/client.ts";
import {
  cancelAttendanceDraft,
  cancelMachineLogDraft,
  cancelProductionDraft,
  createAttendanceDraft,
  createMachineLogDraft,
  createProductionDraft,
  fetchAttendanceRecords,
  fetchMachineLogs,
  fetchMachines,
  fetchProductionLogs,
  fetchWorkers,
  submitAttendanceDraft,
  submitMachineLogDraft,
  submitProductionDraft,
  updateAttendanceDraft,
  updateMachineLogDraft,
  updateProductionDraft,
} from "../../api/operations.ts";
import type { AuthUser } from "../../types/auth.ts";
import type { MaterialCatalogItem } from "../../types/billing.ts";
import type {
  AttendanceRecord,
  MachineRecord,
  MachineWorkLogRecord,
  OperationalApprovalStatus,
  ProductionLogRecord,
  WorkerRecord,
} from "../../types/operations.ts";
import { RevisionHistoryModal } from "./RevisionHistoryModal.tsx";
import {
  formatApprovalStatusLabel,
  getApprovalStatusBadgeClasses,
} from "./approvalBadges.ts";
import { useLanguage } from "../../i18n/LanguageContext.tsx";
import {
  colomboTodayIsoDate,
  previewIntervalNetHours,
} from "./spreadsheetUtils.ts";

interface DailyOperationsPageProps {
  user: AuthUser;
}

type OpTab = "attendance" | "machines" | "production";

interface EditableAttendanceRow {
  localKey: string;
  id?: number;
  version?: number;
  approvalStatus: OperationalApprovalStatus | "NEW";
  enteredByUserId?: string;
  reviewReason?: string | null;
  dirty: boolean;
  workDate: string;
  workerId: number;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
  overtimeHours: string;
  remarks: string;
}

interface EditableMachineRow {
  localKey: string;
  id?: number;
  version?: number;
  approvalStatus: OperationalApprovalStatus | "NEW";
  enteredByUserId?: string;
  reviewReason?: string | null;
  dirty: boolean;
  workDate: string;
  machineId: number;
  operatorWorkerId: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  downtimeMinutes: number;
  downtimeReason: string;
  scheduledHours: string;
  remarks: string;
}

interface EditableProductionRow {
  localKey: string;
  id?: number;
  version?: number;
  approvalStatus: OperationalApprovalStatus | "NEW";
  enteredByUserId?: string;
  reviewReason?: string | null;
  dirty: boolean;
  productionDate: string;
  materialId: number;
  machineId: string;
  operatorWorkerId: string;
  shiftLabel: string;
  quantityProduced: string;
  remarks: string;
}

export function DailyOperationsPage({ user }: DailyOperationsPageProps) {
  const { t, language } = useLanguage();
  const today = colomboTodayIsoDate();
  const [activeTab, setActiveTab] = useState<OpTab>("attendance");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [machines, setMachines] = useState<MachineRecord[]>([]);
  const [materials, setMaterials] = useState<MaterialCatalogItem[]>([]);

  const [attRows, setAttRows] = useState<EditableAttendanceRow[]>([]);
  const [machRows, setMachRows] = useState<EditableMachineRow[]>([]);
  const [prodRows, setProdRows] = useState<EditableProductionRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{
    recordType: "ATTENDANCE" | "MACHINE_LOG" | "PRODUCTION_LOG";
    recordId: number;
    title: string;
  } | null>(null);

  const hasUnsavedEdits = useMemo(
    () =>
      attRows.some((r) => r.dirty) ||
      machRows.some((r) => r.dirty) ||
      prodRows.some((r) => r.dirty),
    [attRows, machRows, prodRows]
  );

  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (hasUnsavedEdits) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [hasUnsavedEdits]);

  const mapAtt = useCallback(
    (rows: AttendanceRecord[]): EditableAttendanceRow[] =>
      rows.map((r) => ({
        localKey: `att-${r.id}`,
        id: r.id,
        version: r.version,
        approvalStatus: r.approvalStatus,
        enteredByUserId: r.enteredByUserId,
        reviewReason: r.reviewReason,
        dirty: false,
        workDate: r.workDate,
        workerId: r.workerId,
        startTime: r.startTime,
        endTime: r.endTime,
        crossesMidnight: r.crossesMidnight,
        breakMinutes: r.breakMinutes,
        overtimeHours: r.overtimeHours,
        remarks: r.remarks ?? "",
      })),
    []
  );

  const mapMach = useCallback(
    (rows: MachineWorkLogRecord[]): EditableMachineRow[] =>
      rows.map((r) => ({
        localKey: `mach-${r.id}`,
        id: r.id,
        version: r.version,
        approvalStatus: r.approvalStatus,
        enteredByUserId: r.enteredByUserId,
        reviewReason: r.reviewReason,
        dirty: false,
        workDate: r.workDate,
        machineId: r.machineId,
        operatorWorkerId: r.operatorWorkerId ? String(r.operatorWorkerId) : "",
        startTime: r.startTime,
        endTime: r.endTime,
        crossesMidnight: r.crossesMidnight,
        downtimeMinutes: r.downtimeMinutes,
        downtimeReason: r.downtimeReason ?? "",
        scheduledHours: r.scheduledHours ?? "",
        remarks: r.remarks ?? "",
      })),
    []
  );

  const mapProd = useCallback(
    (rows: ProductionLogRecord[]): EditableProductionRow[] =>
      rows.map((r) => ({
        localKey: `prod-${r.id}`,
        id: r.id,
        version: r.version,
        approvalStatus: r.approvalStatus,
        enteredByUserId: r.enteredByUserId,
        reviewReason: r.reviewReason,
        dirty: false,
        productionDate: r.productionDate,
        materialId: r.materialId,
        machineId: r.machineId ? String(r.machineId) : "",
        operatorWorkerId: r.operatorWorkerId ? String(r.operatorWorkerId) : "",
        shiftLabel: r.shiftLabel ?? "",
        quantityProduced: r.quantityProduced,
        remarks: r.remarks ?? "",
      })),
    []
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statusParam = statusFilter
        ? (statusFilter as OperationalApprovalStatus)
        : undefined;
      const [wList, mList, matList, aList, mlList, pList] = await Promise.all([
        fetchWorkers(false),
        fetchMachines(false),
        fetchMaterials(),
        fetchAttendanceRecords({ dateFrom, dateTo, status: statusParam }),
        fetchMachineLogs({ dateFrom, dateTo, status: statusParam }),
        fetchProductionLogs({ dateFrom, dateTo, status: statusParam }),
      ]);
      setWorkers(wList);
      setMachines(mList);
      setMaterials(matList);
      setAttRows(mapAtt(aList));
      setMachRows(mapMach(mlList));
      setProdRows(mapProd(pList));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load daily operation sheets."
      );
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, statusFilter, mapAtt, mapMach, mapProd]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function canEditRow(
    status: OperationalApprovalStatus | "NEW",
    enteredByUserId?: string
  ): boolean {
    if (status === "NEW") return true;
    if (status !== "DRAFT" && status !== "RETURNED_FOR_CORRECTION") {
      return false;
    }
    return user.role === "OWNER" || enteredByUserId === user.id;
  }

  function addRowForActiveTab() {
    setError(null);
    setNotice(null);
    const key = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (activeTab === "attendance") {
      if (workers.length === 0) {
        setError("No active workers available. Ask Owner to register workers first.");
        return;
      }
      setAttRows((prev) => [
        {
          localKey: key,
          approvalStatus: "NEW",
          dirty: true,
          workDate: dateTo || today,
          workerId: workers[0].id,
          startTime: "08:00",
          endTime: "17:00",
          crossesMidnight: false,
          breakMinutes: 60,
          overtimeHours: "0.00",
          remarks: "",
        },
        ...prev,
      ]);
    } else if (activeTab === "machines") {
      if (machines.length === 0) {
        setError("No active machines available. Ask Owner to register machines first.");
        return;
      }
      setMachRows((prev) => [
        {
          localKey: key,
          approvalStatus: "NEW",
          dirty: true,
          workDate: dateTo || today,
          machineId: machines[0].id,
          operatorWorkerId: "",
          startTime: "08:00",
          endTime: "17:00",
          crossesMidnight: false,
          downtimeMinutes: 0,
          downtimeReason: "",
          scheduledHours: "",
          remarks: "",
        },
        ...prev,
      ]);
    } else {
      if (materials.length === 0) {
        setError("No active materials available.");
        return;
      }
      setProdRows((prev) => [
        {
          localKey: key,
          approvalStatus: "NEW",
          dirty: true,
          productionDate: dateTo || today,
          materialId: materials[0].id,
          machineId: machines[0] ? String(machines[0].id) : "",
          operatorWorkerId: "",
          shiftLabel: "Day Shift",
          quantityProduced: "",
          remarks: "",
        },
        ...prev,
      ]);
    }
  }

  async function saveAttendanceRow(
    row: EditableAttendanceRow,
    andSubmit = false
  ) {
    setSavingKey(row.localKey);
    setError(null);
    setNotice(null);
    try {
      let saved: AttendanceRecord;
      const payload = {
        workDate: row.workDate,
        workerId: row.workerId,
        startTime: row.startTime,
        endTime: row.endTime,
        crossesMidnight: row.crossesMidnight,
        breakMinutes: Number(row.breakMinutes) || 0,
        overtimeHours: row.overtimeHours.trim() || "0.00",
        remarks: row.remarks.trim() || null,
      };
      if (!row.id) {
        saved = await createAttendanceDraft(payload);
      } else {
        saved = await updateAttendanceDraft(row.id, {
          ...payload,
          expectedVersion: row.version!,
        });
      }
      if (andSubmit) {
        saved = await submitAttendanceDraft(saved.id, saved.version);
      }
      setNotice(
        andSubmit
          ? `Attendance #${saved.id} saved and submitted for Owner approval.`
          : `Attendance draft #${saved.id} saved (${saved.hoursWorked} net hrs).`
      );
      await loadData();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to save attendance row."
      );
    } finally {
      setSavingKey(null);
    }
  }

  async function saveMachineRow(row: EditableMachineRow, andSubmit = false) {
    setSavingKey(row.localKey);
    setError(null);
    setNotice(null);
    try {
      let saved: MachineWorkLogRecord;
      const payload = {
        workDate: row.workDate,
        machineId: row.machineId,
        operatorWorkerId: row.operatorWorkerId ? Number(row.operatorWorkerId) : null,
        startTime: row.startTime,
        endTime: row.endTime,
        crossesMidnight: row.crossesMidnight,
        downtimeMinutes: Number(row.downtimeMinutes) || 0,
        downtimeReason: row.downtimeReason.trim() || null,
        scheduledHours: row.scheduledHours.trim() || null,
        remarks: row.remarks.trim() || null,
      };
      if (!row.id) {
        saved = await createMachineLogDraft(payload);
      } else {
        saved = await updateMachineLogDraft(row.id, {
          ...payload,
          expectedVersion: row.version!,
        });
      }
      if (andSubmit) {
        saved = await submitMachineLogDraft(saved.id, saved.version);
      }
      setNotice(
        andSubmit
          ? `Machine log #${saved.id} submitted for Owner approval.`
          : `Machine draft #${saved.id} saved (${saved.netOperatingHours} net hrs).`
      );
      await loadData();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to save machine log row."
      );
    } finally {
      setSavingKey(null);
    }
  }

  async function saveProductionRow(
    row: EditableProductionRow,
    andSubmit = false
  ) {
    setSavingKey(row.localKey);
    setError(null);
    setNotice(null);
    try {
      let saved: ProductionLogRecord;
      const payload = {
        productionDate: row.productionDate,
        materialId: row.materialId,
        machineId: row.machineId ? Number(row.machineId) : null,
        operatorWorkerId: row.operatorWorkerId ? Number(row.operatorWorkerId) : null,
        shiftLabel: row.shiftLabel.trim() || null,
        quantityProduced: row.quantityProduced.trim(),
        remarks: row.remarks.trim() || null,
      };
      if (!row.id) {
        saved = await createProductionDraft(payload);
      } else {
        saved = await updateProductionDraft(row.id, {
          ...payload,
          expectedVersion: row.version!,
        });
      }
      if (andSubmit) {
        saved = await submitProductionDraft(saved.id, saved.version);
      }
      setNotice(
        andSubmit
          ? `Production log #${saved.id} submitted for Owner approval.`
          : `Production draft #${saved.id} saved (${saved.quantityProduced} m³).`
      );
      await loadData();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to save production row."
      );
    } finally {
      setSavingKey(null);
    }
  }

  async function handleCancelDraft(
    type: OpTab,
    localKey: string,
    id?: number,
    version?: number
  ) {
    if (!id) {
      if (type === "attendance") setAttRows((p) => p.filter((x) => x.localKey !== localKey));
      if (type === "machines") setMachRows((p) => p.filter((x) => x.localKey !== localKey));
      if (type === "production") setProdRows((p) => p.filter((x) => x.localKey !== localKey));
      return;
    }
    setSavingKey(localKey);
    setError(null);
    try {
      if (type === "attendance") await cancelAttendanceDraft(id, version!);
      if (type === "machines") await cancelMachineLogDraft(id, version!);
      if (type === "production") await cancelProductionDraft(id, version!);
      setNotice(`Draft #${id} cancelled cleanly.`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to cancel draft.");
    } finally {
      setSavingKey(null);
    }
  }

  const filteredAtt = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return attRows;
    return attRows.filter((r) => {
      const w = workers.find((x) => x.id === r.workerId);
      return (
        (w?.fullName.toLowerCase().includes(q) ?? false) ||
        r.remarks.toLowerCase().includes(q) ||
        r.workDate.includes(q)
      );
    });
  }, [attRows, searchQuery, workers]);

  const filteredMach = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return machRows;
    return machRows.filter((r) => {
      const m = machines.find((x) => x.id === r.machineId);
      return (
        (m?.machineName.toLowerCase().includes(q) ?? false) ||
        r.downtimeReason.toLowerCase().includes(q) ||
        r.workDate.includes(q)
      );
    });
  }, [machRows, searchQuery, machines]);

  const filteredProd = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return prodRows;
    return prodRows.filter((r) => {
      const mat = materials.find((x) => x.id === r.materialId);
      return (
        (mat?.name.toLowerCase().includes(q) ?? false) ||
        r.shiftLabel.toLowerCase().includes(q) ||
        r.productionDate.includes(q)
      );
    });
  }, [prodRows, searchQuery, materials]);

  const totals = useMemo(() => {
    const attHours = filteredAtt.reduce((acc, r) => {
      const p = previewIntervalNetHours(r.startTime, r.endTime, r.crossesMidnight, r.breakMinutes);
      return acc + (p ? Number(p) : 0);
    }, 0);
    const machHours = filteredMach.reduce((acc, r) => {
      const p = previewIntervalNetHours(r.startTime, r.endTime, r.crossesMidnight, r.downtimeMinutes);
      return acc + (p ? Number(p) : 0);
    }, 0);
    const prodM3 = filteredProd.reduce((acc, r) => {
      const n = Number(r.quantityProduced);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
    return {
      attHours: attHours.toFixed(2),
      machHours: machHours.toFixed(2),
      prodM3: prodM3.toFixed(3),
    };
  }, [filteredAtt, filteredMach, filteredProd]);

  return (
    <div className="mx-auto max-w-[1550px] p-4 md:p-8 lg:p-10">
      <div className="mb-6 flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#f58220]">
            {t("workspaceLabel")}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold text-[#092547] md:text-3xl">
            {t("dailyOpsTitle")}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t("dailyOpsSubtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {hasUnsavedEdits && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">
              Unsaved edits
            </span>
          )}
          <button
            type="button"
            onClick={addRowForActiveTab}
            className="rounded-xl bg-[#f58220] px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#df7318]"
          >
            {t("addNewRowBtn")}
          </button>
          <button
            type="button"
            onClick={() => void loadData()}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-[#092547] hover:bg-slate-50"
          >
            Reload Sheet
          </button>
        </div>
      </div>

      {/* Tabs & Filters Bar */}
      <div className="mb-5 flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center">
        <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("attendance")}
            className={`rounded-lg px-4 py-2 text-xs font-extrabold transition ${
              activeTab === "attendance"
                ? "bg-[#092547] text-white shadow-sm"
                : "text-slate-600 hover:text-[#092547]"
            }`}
          >
            {t("tabAttendance")} ({filteredAtt.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("machines")}
            className={`rounded-lg px-4 py-2 text-xs font-extrabold transition ${
              activeTab === "machines"
                ? "bg-[#092547] text-white shadow-sm"
                : "text-slate-600 hover:text-[#092547]"
            }`}
          >
            {t("tabMachineHours")} ({filteredMach.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("production")}
            className={`rounded-lg px-4 py-2 text-xs font-extrabold transition ${
              activeTab === "production"
                ? "bg-[#092547] text-white shadow-sm"
                : "text-slate-600 hover:text-[#092547]"
            }`}
          >
            {t("tabProduction")} ({filteredProd.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <input
            type="date"
            aria-label="Date from"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            aria-label="Date to"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold"
          />
          <select
            aria-label="Filter status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold"
          >
            <option value="">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="RETURNED_FOR_CORRECTION">Returned</option>
            <option value="SUBMITTED">Pending Approval</option>
            <option value="APPROVED">Approved</option>
          </select>
          <input
            type="search"
            aria-label="Search sheet rows"
            placeholder="Filter worker, machine, material..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-48 rounded-lg border border-slate-300 px-3 py-1.5"
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          {notice}
        </div>
      )}

      {/* Spreadsheet Grid */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="p-10 text-center text-sm font-semibold text-slate-400">
            Loading spreadsheet data...
          </p>
        ) : activeTab === "attendance" ? (
          <table className="w-full min-w-[1050px] border-collapse text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-3">{t("workDateCol")}</th>
                <th className="px-3 py-3">{t("workerCol")}</th>
                <th className="px-3 py-3">{t("startTimeCol")}</th>
                <th className="px-3 py-3">{t("endTimeCol")}</th>
                <th className="px-3 py-3">{t("crossesMidnightCol")}</th>
                <th className="px-3 py-3">{t("breakMinsCol")}</th>
                <th className="px-3 py-3 text-right">{t("hoursWorkedCol")}</th>
                <th className="px-3 py-3">{t("overtimeHoursCol")}</th>
                <th className="px-3 py-3">{t("remarks")}</th>
                <th className="px-3 py-3">{t("status")}</th>
                <th className="px-3 py-3 text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAtt.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-slate-400">
                    No attendance rows for this range. Click &ldquo;+ Add Row&rdquo; to start.
                  </td>
                </tr>
              ) : (
                filteredAtt.map((row) => {
                  const editable = canEditRow(row.approvalStatus, row.enteredByUserId);
                  const previewHrs = previewIntervalNetHours(
                    row.startTime,
                    row.endTime,
                    row.crossesMidnight,
                    row.breakMinutes
                  );
                  return (
                    <tr
                      key={row.localKey}
                      className={row.dirty ? "bg-amber-50/40" : "hover:bg-slate-50/70"}
                    >
                      <td className="px-2 py-2">
                        <input
                          type="date"
                          disabled={!editable}
                          value={row.workDate}
                          onChange={(e) =>
                            setAttRows((prev) =>
                              prev.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, workDate: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-32 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          disabled={!editable}
                          value={row.workerId}
                          onChange={(e) =>
                            setAttRows((prev) =>
                              prev.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, workerId: Number(e.target.value), dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-40 rounded border border-slate-300 px-2 py-1 font-semibold disabled:bg-slate-100"
                        >
                          {workers.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.fullName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="time"
                          disabled={!editable}
                          value={row.startTime}
                          onChange={(e) =>
                            setAttRows((prev) =>
                              prev.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, startTime: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="rounded border border-slate-300 px-1.5 py-1 disabled:bg-slate-100"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="time"
                          disabled={!editable}
                          value={row.endTime}
                          onChange={(e) =>
                            setAttRows((prev) =>
                              prev.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, endTime: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="rounded border border-slate-300 px-1.5 py-1 disabled:bg-slate-100"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          disabled={!editable}
                          checked={row.crossesMidnight}
                          onChange={(e) =>
                            setAttRows((prev) =>
                              prev.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, crossesMidnight: e.target.checked, dirty: true }
                                  : x
                              )
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min={0}
                          max={720}
                          disabled={!editable}
                          value={row.breakMinutes}
                          onChange={(e) =>
                            setAttRows((prev) =>
                              prev.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, breakMinutes: Number(e.target.value) || 0, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-16 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                        />
                      </td>
                      <td className="px-2 py-2 text-right font-bold text-[#092547]">
                        {previewHrs ?? <span className="text-rose-600">Invalid</span>}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="0.25"
                          min="0"
                          disabled={!editable}
                          value={row.overtimeHours}
                          onChange={(e) =>
                            setAttRows((prev) =>
                              prev.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, overtimeHours: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-20 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          disabled={!editable}
                          placeholder="Notes"
                          value={row.remarks}
                          onChange={(e) =>
                            setAttRows((prev) =>
                              prev.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, remarks: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-36 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                        />
                        {row.approvalStatus === "RETURNED_FOR_CORRECTION" &&
                          row.reviewReason && (
                            <p className="mt-1 text-[11px] font-bold text-amber-800">
                              Owner: {row.reviewReason}
                            </p>
                          )}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                            row.approvalStatus === "NEW"
                              ? "border-slate-300 bg-slate-100 text-slate-700"
                              : getApprovalStatusBadgeClasses(row.approvalStatus)
                          }`}
                        >
                          {row.approvalStatus === "NEW"
                            ? (language === "si" ? "සුරැකි නැත" : "Unsaved Row")
                            : formatApprovalStatusLabel(row.approvalStatus, language)}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          {editable && (
                            <>
                              <button
                                type="button"
                                disabled={savingKey === row.localKey}
                                onClick={() => void saveAttendanceRow(row, false)}
                                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-bold text-[#092547] hover:bg-slate-50"
                              >
                                {t("saveDraftBtn")}
                              </button>
                              <button
                                type="button"
                                disabled={savingKey === row.localKey}
                                onClick={() => void saveAttendanceRow(row, true)}
                                className="rounded-lg bg-[#092547] px-2.5 py-1 font-bold text-white hover:bg-[#103462]"
                              >
                                {t("submit")}
                              </button>
                              <button
                                type="button"
                                disabled={savingKey === row.localKey}
                                onClick={() =>
                                  void handleCancelDraft(
                                    "attendance",
                                    row.localKey,
                                    row.id,
                                    row.version
                                  )
                                }
                                className="rounded-lg border border-rose-200 px-2 py-1 font-bold text-rose-700 hover:bg-rose-50"
                              >
                                {t("cancel")}
                              </button>
                            </>
                          )}
                          {row.id && (
                            <button
                              type="button"
                              onClick={() =>
                                setHistoryTarget({
                                  recordType: "ATTENDANCE",
                                  recordId: row.id!,
                                  title: `Attendance #${row.id} (${row.workDate})`,
                                })
                              }
                              className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                            >
                              {t("viewHistoryBtn")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 font-bold text-[#092547]">
              <tr>
                <td colSpan={6} className="px-3 py-2.5 text-right uppercase tracking-wider text-slate-500">
                  Sheet Total Net Hours:
                </td>
                <td className="px-2 py-2.5 text-right">{totals.attHours} h</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        ) : activeTab === "machines" ? (
          <table className="w-full min-w-[1100px] border-collapse text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-3">{t("workDateCol")}</th>
                <th className="px-3 py-3">{t("machineCol")}</th>
                <th className="px-3 py-3">{t("operatorCol")}</th>
                <th className="px-3 py-3">{t("startTimeCol")}</th>
                <th className="px-3 py-3">{t("endTimeCol")}</th>
                <th className="px-3 py-3">{t("crossesMidnightCol")}</th>
                <th className="px-3 py-3">{t("downtimeMinsCol")}</th>
                <th className="px-3 py-3">{t("downtimeReasonCol")}</th>
                <th className="px-3 py-3 text-right">{t("hoursWorkedCol")}</th>
                <th className="px-3 py-3">Sched (h)</th>
                <th className="px-3 py-3">{t("status")}</th>
                <th className="px-3 py-3 text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMach.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-slate-400">
                    No machine logs for this range. Click &ldquo;+ Add Row&rdquo; to log machine hours.
                  </td>
                </tr>
              ) : (
                filteredMach.map((row) => {
                  const editable = canEditRow(row.approvalStatus, row.enteredByUserId);
                  const previewHrs = previewIntervalNetHours(
                    row.startTime,
                    row.endTime,
                    row.crossesMidnight,
                    row.downtimeMinutes
                  );
                  return (
                    <tr
                      key={row.localKey}
                      className={row.dirty ? "bg-amber-50/40" : "hover:bg-slate-50/70"}
                    >
                      <td className="px-2 py-2">
                        <input
                          type="date"
                          disabled={!editable}
                          value={row.workDate}
                          onChange={(e) =>
                            setMachRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, workDate: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-32 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          disabled={!editable}
                          value={row.machineId}
                          onChange={(e) =>
                            setMachRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, machineId: Number(e.target.value), dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-36 rounded border border-slate-300 px-2 py-1 font-semibold disabled:bg-slate-100"
                        >
                          {machines.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.machineName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <select
                          disabled={!editable}
                          value={row.operatorWorkerId}
                          onChange={(e) =>
                            setMachRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, operatorWorkerId: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-32 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                        >
                          <option value="">-- Optional --</option>
                          {workers.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.fullName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="time"
                          disabled={!editable}
                          value={row.startTime}
                          onChange={(e) =>
                            setMachRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, startTime: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="rounded border border-slate-300 px-1.5 py-1 disabled:bg-slate-100"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="time"
                          disabled={!editable}
                          value={row.endTime}
                          onChange={(e) =>
                            setMachRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, endTime: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="rounded border border-slate-300 px-1.5 py-1 disabled:bg-slate-100"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          disabled={!editable}
                          checked={row.crossesMidnight}
                          onChange={(e) =>
                            setMachRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, crossesMidnight: e.target.checked, dirty: true }
                                  : x
                              )
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min={0}
                          max={1440}
                          disabled={!editable}
                          value={row.downtimeMinutes}
                          onChange={(e) =>
                            setMachRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, downtimeMinutes: Number(e.target.value) || 0, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-16 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          disabled={!editable}
                          placeholder="Reason if downtime"
                          value={row.downtimeReason}
                          onChange={(e) =>
                            setMachRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, downtimeReason: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-32 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                        />
                        {row.approvalStatus === "RETURNED_FOR_CORRECTION" &&
                          row.reviewReason && (
                            <p className="mt-1 text-[11px] font-bold text-amber-800">
                              Owner: {row.reviewReason}
                            </p>
                          )}
                      </td>
                      <td className="px-2 py-2 text-right font-bold text-[#092547]">
                        {previewHrs ?? <span className="text-rose-600">Invalid</span>}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          disabled={!editable}
                          placeholder="Opt"
                          value={row.scheduledHours}
                          onChange={(e) =>
                            setMachRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, scheduledHours: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-16 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                            row.approvalStatus === "NEW"
                              ? "border-slate-300 bg-slate-100 text-slate-700"
                              : getApprovalStatusBadgeClasses(row.approvalStatus)
                          }`}
                        >
                          {row.approvalStatus === "NEW"
                            ? (language === "si" ? "සුරැකි නැත" : "Unsaved Row")
                            : formatApprovalStatusLabel(row.approvalStatus, language)}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          {editable && (
                            <>
                              <button
                                type="button"
                                disabled={savingKey === row.localKey}
                                onClick={() => void saveMachineRow(row, false)}
                                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-bold text-[#092547] hover:bg-slate-50"
                              >
                                {t("saveDraftBtn")}
                              </button>
                              <button
                                type="button"
                                disabled={savingKey === row.localKey}
                                onClick={() => void saveMachineRow(row, true)}
                                className="rounded-lg bg-[#092547] px-2.5 py-1 font-bold text-white hover:bg-[#103462]"
                              >
                                {t("submit")}
                              </button>
                              <button
                                type="button"
                                disabled={savingKey === row.localKey}
                                onClick={() =>
                                  void handleCancelDraft(
                                    "machines",
                                    row.localKey,
                                    row.id,
                                    row.version
                                  )
                                }
                                className="rounded-lg border border-rose-200 px-2 py-1 font-bold text-rose-700 hover:bg-rose-50"
                              >
                                {t("cancel")}
                              </button>
                            </>
                          )}
                          {row.id && (
                            <button
                              type="button"
                              onClick={() =>
                                setHistoryTarget({
                                  recordType: "MACHINE_LOG",
                                  recordId: row.id!,
                                  title: `Machine Log #${row.id} (${row.workDate})`,
                                })
                              }
                              className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                            >
                              {t("viewHistoryBtn")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 font-bold text-[#092547]">
              <tr>
                <td colSpan={8} className="px-3 py-2.5 text-right uppercase tracking-wider text-slate-500">
                  Sheet Total Net Machine Hours:
                </td>
                <td className="px-2 py-2.5 text-right">{totals.machHours} h</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="w-full min-w-[950px] border-collapse text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-3">{t("workDateCol")}</th>
                <th className="px-3 py-3">{t("producedMaterialCol")}</th>
                <th className="px-3 py-3">{t("machineCol")}</th>
                <th className="px-3 py-3">{t("operatorCol")}</th>
                <th className="px-3 py-3">{t("shiftCol")}</th>
                <th className="px-3 py-3">{t("volumeM3Col")}</th>
                <th className="px-3 py-3">{t("remarks")}</th>
                <th className="px-3 py-3">{t("status")}</th>
                <th className="px-3 py-3 text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProd.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                    No production rows for this range. Click &ldquo;+ Add Row&rdquo; to enter crushed metal output.
                  </td>
                </tr>
              ) : (
                filteredProd.map((row) => {
                  const editable = canEditRow(row.approvalStatus, row.enteredByUserId);
                  return (
                    <tr
                      key={row.localKey}
                      className={row.dirty ? "bg-amber-50/40" : "hover:bg-slate-50/70"}
                    >
                      <td className="px-2 py-2">
                        <input
                          type="date"
                          disabled={!editable}
                          value={row.productionDate}
                          onChange={(e) =>
                            setProdRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, productionDate: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-32 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          disabled={!editable}
                          value={row.materialId}
                          onChange={(e) =>
                            setProdRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, materialId: Number(e.target.value), dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-36 rounded border border-slate-300 px-2 py-1 font-semibold disabled:bg-slate-100"
                        >
                          {materials.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <select
                          disabled={!editable}
                          value={row.machineId}
                          onChange={(e) =>
                            setProdRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, machineId: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-36 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                        >
                          <option value="">General / Unassigned</option>
                          {machines.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.machineName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <select
                          disabled={!editable}
                          value={row.operatorWorkerId}
                          onChange={(e) =>
                            setProdRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, operatorWorkerId: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-32 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                        >
                          <option value="">-- Optional --</option>
                          {workers.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.fullName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          disabled={!editable}
                          placeholder="Shift"
                          value={row.shiftLabel}
                          onChange={(e) =>
                            setProdRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, shiftLabel: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-24 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="0.001"
                          min="0.001"
                          disabled={!editable}
                          placeholder="0.000"
                          value={row.quantityProduced}
                          onChange={(e) =>
                            setProdRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, quantityProduced: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-bold disabled:bg-slate-100"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          disabled={!editable}
                          placeholder="Notes"
                          value={row.remarks}
                          onChange={(e) =>
                            setProdRows((p) =>
                              p.map((x) =>
                                x.localKey === row.localKey
                                  ? { ...x, remarks: e.target.value, dirty: true }
                                  : x
                              )
                            )
                          }
                          className="w-36 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                        />
                        {row.approvalStatus === "RETURNED_FOR_CORRECTION" &&
                          row.reviewReason && (
                            <p className="mt-1 text-[11px] font-bold text-amber-800">
                              Owner: {row.reviewReason}
                            </p>
                          )}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                            row.approvalStatus === "NEW"
                              ? "border-slate-300 bg-slate-100 text-slate-700"
                              : getApprovalStatusBadgeClasses(row.approvalStatus)
                          }`}
                        >
                          {row.approvalStatus === "NEW"
                            ? (language === "si" ? "සුරැකි නැත" : "Unsaved Row")
                            : formatApprovalStatusLabel(row.approvalStatus, language)}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          {editable && (
                            <>
                              <button
                                type="button"
                                disabled={savingKey === row.localKey}
                                onClick={() => void saveProductionRow(row, false)}
                                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-bold text-[#092547] hover:bg-slate-50"
                              >
                                {t("saveDraftBtn")}
                              </button>
                              <button
                                type="button"
                                disabled={savingKey === row.localKey}
                                onClick={() => void saveProductionRow(row, true)}
                                className="rounded-lg bg-[#092547] px-2.5 py-1 font-bold text-white hover:bg-[#103462]"
                              >
                                {t("submit")}
                              </button>
                              <button
                                type="button"
                                disabled={savingKey === row.localKey}
                                onClick={() =>
                                  void handleCancelDraft(
                                    "production",
                                    row.localKey,
                                    row.id,
                                    row.version
                                  )
                                }
                                className="rounded-lg border border-rose-200 px-2 py-1 font-bold text-rose-700 hover:bg-rose-50"
                              >
                                {t("cancel")}
                              </button>
                            </>
                          )}
                          {row.id && (
                            <button
                              type="button"
                              onClick={() =>
                                setHistoryTarget({
                                  recordType: "PRODUCTION_LOG",
                                  recordId: row.id!,
                                  title: `Production #${row.id} (${row.productionDate})`,
                                })
                              }
                              className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                            >
                              {t("viewHistoryBtn")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 font-bold text-[#092547]">
              <tr>
                <td colSpan={5} className="px-3 py-2.5 text-right uppercase tracking-wider text-slate-500">
                  Sheet Total Production:
                </td>
                <td className="px-2 py-2.5 text-right">{totals.prodM3} m³</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

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

