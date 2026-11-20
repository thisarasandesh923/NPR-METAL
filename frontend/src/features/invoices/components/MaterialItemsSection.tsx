import { Icon } from "../../../components/ui/Icon.tsx";
import { useLanguage } from "../../../i18n/LanguageContext.tsx";
import type { MaterialCatalogItem } from "../../../types/billing.ts";
import { formatLkr } from "../../../utils/formatters.ts";

export interface InvoiceLineDraft {
  rowKey: number;
  materialId: number;
  quantity: string;
}

interface MaterialItemsSectionProps {
  materials: MaterialCatalogItem[];
  items: InvoiceLineDraft[];
  onUpdateMaterial: (rowKey: number, materialId: number) => void;
  onUpdateQuantity: (rowKey: number, quantity: string) => void;
  onAddItem: () => void;
  onRemoveItem: (rowKey: number) => void;
  disabled?: boolean;
}

export function MaterialItemsSection({
  materials,
  items,
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
              const unitPrice = mat ? Number(mat.currentUnitPrice) : 0;
              const qtyNum = Number(item.quantity);
              const previewTotal =
                Number.isFinite(qtyNum) && qtyNum > 0
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
                        aria-label={`Quantity in cubic meters for item ${index + 1}`}
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
                        m³
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="table-control locked-price flex w-44 items-center gap-1.5 px-3">
                      <span className="shrink-0 select-none text-xs font-bold text-slate-500">
                        Rs.
                      </span>
                      <input
                        type="text"
                        className="w-full min-w-0 cursor-default bg-transparent text-xs font-extrabold text-[#092547] outline-none"
                        value={
                          mat
                            ? formatLkr(mat.currentUnitPrice).replace("Rs. ", "")
                            : "0.00"
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
