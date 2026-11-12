import { useCallback, useEffect, useState } from "react";
import { fetchMaterials } from "../../api/billing.ts";
import { ApiError } from "../../api/client.ts";
import {
  fetchMaterialPriceHistory,
  updateMaterialPrice,
} from "../../api/operations.ts";
import { Icon } from "../../components/ui/Icon.tsx";
import type { MaterialCatalogItem } from "../../types/billing.ts";
import type { MaterialPriceHistoryRecord } from "../../types/operations.ts";
import { formatColomboDateTime, formatLkr } from "../../utils/formatters.ts";

export function MaterialPricesPage() {
  const [materials, setMaterials] = useState<MaterialCatalogItem[]>([]);
  const [history, setHistory] = useState<MaterialPriceHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState<MaterialCatalogItem | null>(null);
  const [newPrice, setNewPrice] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mats, hist] = await Promise.all([
        fetchMaterials(),
        fetchMaterialPriceHistory(),
      ]);
      setMaterials(mats);
      setHistory(hist);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load material prices."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function openEditModal(item: MaterialCatalogItem) {
    setEditing(item);
    setNewPrice(item.currentUnitPrice);
    setReason("");
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
      });
      setEditing(null);
      setNotice(
        `Updated selling price for ${updated.name} to ${formatLkr(updated.currentUnitPrice)} per m³. Existing issued invoices remain unchanged.`
      );
      await loadData();
    } catch (err) {
      setModalError(
        err instanceof ApiError ? err.message : "Failed to update price."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-8 lg:p-10">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#f58220]">
            Owner Controls
          </p>
          <h1 className="mt-1 text-2xl font-extrabold text-[#092547] md:text-3xl">
            Material Price Management
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Update selling prices per cubic metre (m³). Issued invoices retain their historical price snapshots permanently.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
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
                <th className="px-6 py-3.5 text-right">Current Price (LKR)</th>
                <th className="px-6 py-3.5">Version</th>
                <th className="px-6 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                    Loading materials...
                  </td>
                </tr>
              ) : materials.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
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
                    <td className="px-6 py-4 text-right font-extrabold text-[#092547]">
                      {formatLkr(m.currentUnitPrice)}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      v{m.version ?? 1}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => openEditModal(m)}
                        className="rounded-xl bg-[#092547] px-4 py-2 text-xs font-bold text-white hover:bg-[#103462]"
                      >
                        Update Price
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-extrabold text-[#092547]">
            Price Change Audit History
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-6 py-3">Effective At</th>
                <th className="px-6 py-3">Material</th>
                <th className="px-6 py-3 text-right">Old Price</th>
                <th className="px-6 py-3 text-right">New Price</th>
                <th className="px-6 py-3">Owner</th>
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
                      {h.changedByOwnerName}
                    </td>
                    <td className="px-6 py-3.5 text-slate-600">{h.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

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
                Update Price — {editing.name}
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

            <p className="mb-4 text-xs text-slate-500">
              Current Price: <strong className="text-[#092547]">{formatLkr(editing.currentUnitPrice)}</strong> / {editing.unit} (Version v{editing.version ?? 1})
            </p>

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
                {saving ? "Saving..." : "Save Price Update"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

