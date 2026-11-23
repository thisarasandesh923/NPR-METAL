import { Icon } from "../../../components/ui/Icon.tsx";
import { useLanguage } from "../../../i18n/LanguageContext.tsx";
import type { MaterialCatalogItem, VehicleCategory } from "../../../types/billing.ts";
import { formatLkr } from "../../../utils/formatters.ts";
import { getMaterialVehiclePrice } from "../hooks/useInvoiceForm.ts";

export interface InvoiceLineDraft {
  rowKey: number;
  materialId: number;
  quantity: string;
}

interface MaterialItemsSectionProps {
  materials: MaterialCatalogItem[];
  items: InvoiceLineDraft[];
  vehicleCategory: VehicleCategory;
  onSelectVehicleCategory: (cat: VehicleCategory) => void;
  unconfiguredWarning?: string | null;
  onUpdateMaterial: (rowKey: number, materialId: number) => void;
  onUpdateQuantity: (rowKey: number, quantity: string) => void;
  onAddItem: () => void;
  onRemoveItem: (rowKey: number) => void;
  disabled?: boolean;
}

export function MaterialItemsSection({
  materials,
  items,
  vehicleCategory,
  onSelectVehicleCategory,
  unconfiguredWarning,
  onUpdateMaterial,
  onUpdateQuantity,
  onAddItem,
  onRemoveItem,
  disabled = false,
}: MaterialItemsSectionProps) {
  const { t } = useLanguage();
  const materialsById = new Map(materials.map((m) => [m.id, m]));

  return (
    <section className="invoice-panel">
      <div className="invoice-panel-heading flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="invoice-step">02</span>
          <div>
            <h2>{t("stepMaterials")}</h2>
            <p>{t("stepMaterialsSubtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[10px] font-bold text-[#124f8c]">
          <Icon name="lock" className="h-3.5 w-3.5" />
          {t("serverLockedPrices")}
        </div>
      </div>

      {/* Selling Price Category Selector: TRACTOR vs TIPPER */}
      <div className="border-b border-slate-100 bg-[#fbfcfd] px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-xs font-extrabold uppercase tracking-wider text-[#092547]">
              {t("sellingPriceCategory")}
            </span>
            <p className="text-[11px] text-slate-500">
              {t("sellingPriceCategorySubtitle")}
            </p>
          </div>
          <div
            className="inline-flex rounded-xl border border-slate-300 bg-white p-1 shadow-sm"
            role="radiogroup"
            aria-label={t("sellingPriceCategory")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={vehicleCategory === "TRACTOR"}
              disabled={disabled}
              onClick={() => onSelectVehicleCategory("TRACTOR")}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-bold transition ${
                vehicleCategory === "TRACTOR"
                  ? "bg-[#124f8c] text-white shadow-sm"
                  : "text-slate-600 hover:text-[#092547]"
              }`}
            >
              <span>🚜</span>
              <span>{t("vehicleCategoryTractor")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={vehicleCategory === "TIPPER"}
              disabled={disabled}
              onClick={() => onSelectVehicleCategory("TIPPER")}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-bold transition ${
                vehicleCategory === "TIPPER"
                  ? "bg-[#124f8c] text-white shadow-sm"
                  : "text-slate-600 hover:text-[#092547]"
              }`}
            >
              <span>🚚</span>
              <span>{t("vehicleCategoryTipper")}</span>
            </button>
          </div>
        </div>
      </div>

      {unconfiguredWarning && (
        <div
          role="alert"
          className="mx-4 mt-4 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-900 sm:mx-6"
        >
          <span className="text-base">⚠️</span>
          <span>{unconfiguredWarning}</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="invoice-items-table w-full min-w-[850px]">
          <thead>
            <tr className="bg-[#f8fafc] text-left">
              <th className="w-14">#</th>
              <th>{t("materialCol")}</th>
              <th>{t("quantityCol")}</th>
              <th>{t("unitPriceCol")}</th>
              <th className="text-right">{t("lineTotalCol")}</th>
              <th className="w-20 text-center">{t("removeCol")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const mat = materialsById.get(item.materialId);
              const unitPriceStr = getMaterialVehiclePrice(mat, vehicleCategory);
              const isConfigured =
                unitPriceStr !== null &&
                unitPriceStr !== undefined &&
                unitPriceStr.trim() !== "" &&
                Number.isFinite(Number(unitPriceStr)) &&
                Number(unitPriceStr) > 0;
              const unitPrice = isConfigured ? Number(unitPriceStr) : 0;
              const qtyNum = Number(item.quantity);
              const previewTotal =
                isConfigured && Number.isFinite(qtyNum) && qtyNum > 0
                  ? Math.round(qtyNum * unitPrice * 100) / 100
                  : 0;

              return (
                <tr key={item.rowKey} className="border-t border-slate-100">
                  <td className="font-bold text-slate-400">
                    {String(index + 1).padStart(2, "0")}
                  </td>
                  <td>
                    <select
                      aria-label={`Material item ${index + 1}`}
                      disabled={disabled || materials.length === 0}
                      className="table-control min-w-44"
                      value={item.materialId}
                      onChange={(event) =>
                        onUpdateMaterial(item.rowKey, Number(event.target.value))
                      }
                    >
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.code})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="relative w-40">
                      <input
                        aria-label={`Quantity in cubic feet for item ${index + 1}`}
                        data-item-quantity={index + 1}
                        disabled={disabled}
                        className="table-control w-full pr-11"
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={item.quantity}
                        onChange={(event) =>
                          onUpdateQuantity(item.rowKey, event.target.value)
                        }
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                        ft³
                      </span>
                    </div>
                  </td>
                  <td>
                    <div
                      className={`table-control locked-price flex w-44 items-center gap-1.5 px-3 ${
                        !isConfigured ? "border-amber-400 bg-amber-50/50" : ""
                      }`}
                    >
                      <span className="shrink-0 select-none text-xs font-bold text-slate-500">
                        Rs.
                      </span>
                      <input
                        type="text"
                        className={`w-full min-w-0 cursor-default bg-transparent text-xs font-extrabold outline-none ${
                          isConfigured ? "text-[#092547]" : "text-amber-800"
                        }`}
                        value={
                          isConfigured
                            ? formatLkr(unitPriceStr).replace("Rs. ", "")
                            : "Unconfigured"
                        }
                        readOnly
                        aria-label={`${mat?.name ?? "Material"} unit price`}
                      />
                      <Icon
                        name="lock"
                        className="h-3.5 w-3.5 shrink-0 text-slate-400"
                      />
                    </div>
                  </td>
                  <td className="text-right text-sm font-extrabold text-[#092547]">
                    {formatLkr(previewTotal)}
                  </td>
                  <td className="text-center">
                    <button
                      type="button"
                      disabled={disabled || items.length === 1}
                      onClick={() => onRemoveItem(item.rowKey)}
                      className="rounded-lg p-2.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label={`Remove item ${index + 1}`}
                    >
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-100 p-4 md:px-6">
        <button
          type="button"
          disabled={disabled || materials.length === 0}
          onClick={onAddItem}
          className="inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-xs font-bold text-[#124f8c] transition hover:border-[#f58220] hover:bg-orange-50/40 hover:text-[#e77418] disabled:opacity-40"
        >
          <Icon name="plus" className="h-4 w-4" />
          {t("addLineItem")}
        </button>
      </div>
    </section>
  );
}
