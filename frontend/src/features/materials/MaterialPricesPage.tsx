import { useCallback, useEffect, useState } from "react";
import { fetchMaterials } from "../../api/billing.ts";
import { ApiError } from "../../api/client.ts";
import {
  fetchMaterialPriceHistory,
  updateMaterialPrice,
  type FetchPriceHistoryParams,
} from "../../api/operations.ts";
import { Icon } from "../../components/ui/Icon.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import type { MaterialCatalogItem } from "../../types/billing.ts";
import type { MaterialPriceHistoryRecord } from "../../types/operations.ts";
import { formatColomboDateTime, formatLkr } from "../../utils/formatters.ts";

export function MaterialPricesPage() {
  const { user } = useAuth();
  const isOwner = user?.role === "OWNER";

  const [materials, setMaterials] = useState<MaterialCatalogItem[]>([]);
  const [history, setHistory] = useState<MaterialPriceHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Owner audit history filter state
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [cashierQuery, setCashierQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [editing, setEditing] = useState<MaterialCatalogItem | null>(null);
  const [newPrice, setNewPrice] = useState("");
  const [reason, setReason] = useState("");
  const [activateOnSave, setActivateOnSave] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const fetchAll = useCallback(
    async (historyFilters?: FetchPriceHistoryParams) => {
      setLoading(true);
      setError(null);
      try {
        if (isOwner) {
          const [mats, hist] = await Promise.all([
            fetchMaterials(true),
            fetchMaterialPriceHistory(historyFilters),
          ]);
          setMaterials(mats);
          setHistory(hist);
        } else {
          const mats = await fetchMaterials(false);
          setMaterials(mats);
          setHistory([]);
        }
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load material prices."
        );
      } finally {
        setLoading(false);
      }
    },
    [isOwner]
  );

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  function openEditModal(item: MaterialCatalogItem) {
    if (!isOwner && !item.isActive) {
      return;
    }
    setEditing(item);
    setNewPrice(item.isActive ? item.currentUnitPrice : "");
    setActivateOnSave(true);
    setReason(
      item.isActive
        ? ""
        : "Initial price configuration & activation for aggregate catalogue"
    );
    setModalError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (reason.trim().length < 5) {
      setModalError("Please provide a business reason (at least 5 characters).");
      return;
    }
    setSaving(true);
    setModalError(null);
    try {
      const updated = await updateMaterialPrice(editing.id, {
        newPrice: newPrice.trim(),
        reason: reason.trim(),
        expectedVersion: editing.version ?? 1,
        isActive: isOwner && !editing.isActive ? activateOnSave : undefined,
      });
      setEditing(null);
      setNotice(
        `Updated selling price for ${updated.name} to ${formatLkr(updated.currentUnitPrice)} per m³${!editing.isActive && updated.isActive ? " and activated for cashier billing" : ""}. Existing issued invoices remain unchanged.`
      );
      await fetchAll({
        materialId: selectedMaterialId ? Number(selectedMaterialId) : undefined,
        cashierId: cashierQuery.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
    } catch (err) {
      setModalError(
        err instanceof ApiError ? err.message : "Failed to update price."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyFilters(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner) return;
    setHistoryLoading(true);
    setError(null);
    try {
      const hist = await fetchMaterialPriceHistory({
        materialId: selectedMaterialId ? Number(selectedMaterialId) : undefined,
        cashierId: cashierQuery.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setHistory(hist);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load filtered price history."
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleClearFilters() {
    setSelectedMaterialId("");
    setCashierQuery("");
    setDateFrom("");
    setDateTo("");
    if (!isOwner) return;
    setHistoryLoading(true);
    setError(null);
    try {
      const hist = await fetchMaterialPriceHistory();
      setHistory(hist);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load price history."
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-8 lg:p-10">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#f58220]">
            {isOwner ? "Owner Controls" : "Cashier Portal"}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold text-[#092547] md:text-3xl">
            Material Price Management
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isOwner
              ? "Update selling prices per cubic metre (m³). Issued invoices retain their historical price snapshots permanently."
              : "Update current aggregate selling prices per cubic metre (m³). All changes take effect immediately and are recorded in the Owner audit log."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchAll({
            materialId: selectedMaterialId ? Number(selectedMaterialId) : undefined,
            cashierId: cashierQuery.trim() || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
          })}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#092547] hover:bg-slate-50"
        >
          Refresh Prices
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          {error}
        </div>
      )}

      {notice && (
        <div role="status" className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          {notice}
        </div>
      )}

      <section className="mb-8 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-extrabold text-[#092547]">
            Current Aggregate Selling Prices
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-6 py-3.5">Code</th>
                <th className="px-6 py-3.5">Material</th>
                <th className="px-6 py-3.5">Unit</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-right">Current Price (LKR)</th>
                <th className="px-6 py-3.5">Version</th>
                <th className="px-6 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-400">
                    Loading materials...
                  </td>
                </tr>
              ) : materials.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-400">
                    No active materials found.
                  </td>
                </tr>
              ) : (
                materials.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/70">
                    <td className="px-6 py-4 font-mono text-xs font-bold text-slate-600">
                      {m.code}
                    </td>
                    <td className="px-6 py-4 font-bold text-[#092547]">{m.name}</td>
                    <td className="px-6 py-4 text-slate-600">{m.unit}</td>
                    <td className="px-6 py-4">
                      {m.isActive ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right font-extrabold text-[#092547]">
                      {m.isActive || Number(m.currentUnitPrice) > 0
                        ? formatLkr(m.currentUnitPrice)
                        : "Unpriced (Rs. 0.00)"}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      v{m.version ?? 1}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {m.isActive || isOwner ? (
                        <button
                          type="button"
                          onClick={() => openEditModal(m)}
                          className="rounded-xl bg-[#092547] px-4 py-2 text-xs font-bold text-white hover:bg-[#103462]"
                        >
                          {m.isActive ? "Update Price" : "Configure & Activate"}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">Owner Activation Required</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Owner-Only Audit History Section */}
      {isOwner && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-base font-extrabold text-[#092547]">
                  Price Change Audit History
                </h2>
                <p className="text-xs text-slate-500">
                  Permanent, append-only log of all material selling price updates by Cashiers and Owners.
                </p>
              </div>
              {historyLoading && (
                <span className="text-xs font-semibold text-slate-500">
                  Updating history...
                </span>
              )}
            </div>

            <form
              onSubmit={handleApplyFilters}
              className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
            >
              <div>
                <label
                  htmlFor="filter-material"
                  className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500"
                >
                  Material
                </label>
                <select
                  id="filter-material"
                  value={selectedMaterialId}
                  onChange={(e) => setSelectedMaterialId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#092547]"
                >
                  <option value="">All Materials</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="filter-cashier"
                  className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500"
                >
                  Cashier / Staff
                </label>
                <input
                  id="filter-cashier"
                  type="text"
                  placeholder="Username or name"
                  value={cashierQuery}
                  onChange={(e) => setCashierQuery(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#092547] placeholder:text-slate-400"
                />
              </div>

              <div>
                <label
                  htmlFor="filter-date-from"
                  className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500"
                >
                  Date From
                </label>
                <input
                  id="filter-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#092547]"
                />
              </div>

              <div>
                <label
                  htmlFor="filter-date-to"
                  className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500"
                >
                  Date To
                </label>
                <input
                  id="filter-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#092547]"
                />
              </div>

              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  disabled={historyLoading}
                  className="flex-1 rounded-xl bg-[#092547] px-3 py-2 text-xs font-bold text-white hover:bg-[#103462] disabled:opacity-60"
                >
                  Filter
                </button>
                <button
                  type="button"
                  onClick={() => void handleClearFilters()}
                  disabled={historyLoading}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  Reset
                </button>
              </div>
            </form>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-6 py-3">Effective At</th>
                  <th className="px-6 py-3">Material</th>
                  <th className="px-6 py-3 text-right">Old Price</th>
                  <th className="px-6 py-3 text-right">New Price</th>
                  <th className="px-6 py-3">Changed By</th>
                  <th className="px-6 py-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                      No price changes recorded yet.
                    </td>
                  </tr>
                ) : (
                  history.map((h) => (
                    <tr key={h.id}>
                      <td className="px-6 py-3.5 text-xs text-slate-600">
                        {formatColomboDateTime(h.effectiveAt)}
                      </td>
                      <td className="px-6 py-3.5 font-bold text-[#092547]">
                        {h.materialName}
                      </td>
                      <td className="px-6 py-3.5 text-right text-slate-500">
                        {formatLkr(h.oldPrice)}
                      </td>
                      <td className="px-6 py-3.5 text-right font-bold text-emerald-700">
                        {formatLkr(h.newPrice)}
                      </td>
                      <td className="px-6 py-3.5 text-slate-700">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[#092547]">
                            {h.changedByUsername ??
                              h.changedByName ??
                              h.changedByOwnerName ??
                              "System"}
                          </span>
                          {h.changedByRole && (
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                h.changedByRole === "OWNER"
                                  ? "bg-purple-100 text-purple-800"
                                  : "bg-blue-100 text-blue-800"
                              }`}
                            >
                              {h.changedByRole}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-3.5 text-slate-600">{h.reason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Update Price for ${editing.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#092547]/55 p-4 backdrop-blur-sm"
        >
          <form
            onSubmit={handleSave}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-[#092547]">
                {editing.isActive
                  ? `Update Price — ${editing.name}`
                  : `Configure Price & Activate — ${editing.name}`}
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                aria-label="Close modal"
              >
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>

            {editing.isActive ? (
              <p className="mb-4 text-xs text-slate-500">
                Current Price: <strong className="text-[#092547]">{formatLkr(editing.currentUnitPrice)}</strong> / {editing.unit} (Version v{editing.version ?? 1})
              </p>
            ) : (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                This aggregate is currently <strong>Inactive</strong>. Enter an approved selling price per m³ to activate it for Cashier billing.
              </div>
            )}

            {modalError && (
              <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                {modalError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="price-input"
                  className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600"
                >
                  New Unit Price (LKR per m³)
                </label>
                <input
                  id="price-input"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-bold text-[#092547]"
                />
              </div>

              <div>
                <label
                  htmlFor="price-reason"
                  className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600"
                >
                  Reason for Change (Required)
                </label>
                <textarea
                  id="price-reason"
                  rows={3}
                  required
                  minLength={5}
                  placeholder="e.g., Quarry blasting & diesel transport rate adjustment"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-[#092547]"
                />
              </div>

              {isOwner && !editing.isActive && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    id="activate-checkbox"
                    type="checkbox"
                    checked={activateOnSave}
                    onChange={(e) => setActivateOnSave(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#f58220] focus:ring-[#f58220]"
                  />
                  <label htmlFor="activate-checkbox" className="text-xs font-bold text-[#092547]">
                    Activate material for Cashier billing upon saving
                  </label>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-[#f58220] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#df7318] disabled:opacity-60"
              >
                {saving
                  ? "Saving..."
                  : editing.isActive
                  ? "Save Price Update"
                  : "Activate & Save Price"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
