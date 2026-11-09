import { Icon } from "../../../components/ui/Icon";
import { formatLkr } from "../../../utils/formatters";
import { DEMO_MATERIAL_OPTIONS } from "../../../data/demo/materials";
import type { MaterialName, MaterialRow } from "../../../types/invoice";

interface MaterialItemsSectionProps {
  items: MaterialRow[];
  onUpdateMaterial: (id: number, material: MaterialName) => void;
  onUpdateQuantity: (id: number, quantity: number) => void;
  onAddItem: () => void;
  onRemoveItem: (id: number) => void;
}

export function MaterialItemsSection({
  items,
  onUpdateMaterial,
  onUpdateQuantity,
  onAddItem,
  onRemoveItem,
}: MaterialItemsSectionProps) {
  return (
    <section className="invoice-panel">
      <div className="invoice-panel-heading flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="invoice-step">02</span>
          <div>
            <h2>Material Details</h2>
            <p>Enter quantity in cubic meters (m³)</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700">
          <Icon name="lock" className="h-3.5 w-3.5" />
          Demo Prices · Owner-managed in production
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="invoice-items-table w-full min-w-[850px]">
          <thead>
            <tr className="bg-[#f8fafc] text-left">
              <th className="w-14">#</th>
              <th>Material</th>
              <th>Quantity (m³)</th>
              <th>Unit Price (LKR / m³)</th>
              <th className="text-right">Line Total (LKR)</th>
              <th className="w-20 text-center">Remove</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id} className="border-t border-slate-100">
                <td className="font-bold text-slate-400">
                  {String(index + 1).padStart(2, "0")}
                </td>
                <td>
                  <select
                    className="table-control min-w-40"
                    value={item.material}
                    onChange={(event) =>
                      onUpdateMaterial(item.id, event.target.value as MaterialName)
                    }
                  >
                    {DEMO_MATERIAL_OPTIONS.map((material) => (
                      <option key={material}>{material}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className="relative w-36">
                    <input
                      className="table-control w-full pr-11"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={item.quantity}
                      onChange={(event) =>
                        onUpdateQuantity(item.id, Number(event.target.value))
                      }
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                      m³
                    </span>
                  </div>
                </td>
                <td>
                  <div className="relative w-48">
                    <input
                      className="table-control locked-price w-full pl-11"
                      value={item.price.toLocaleString("en-LK", {
                        minimumFractionDigits: 2,
                      })}
                      readOnly
                      aria-label={`${item.material} demo price (owner-managed in production)`}
                    />
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                      Rs.
                    </span>
                    <Icon
                      name="lock"
                      className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                    />
                  </div>
                </td>
                <td className="text-right text-sm font-extrabold text-[#092547]">
                  {formatLkr(item.quantity * item.price)}
                </td>
                <td className="text-center">
                  <button
                    type="button"
                    disabled={items.length === 1}
                    onClick={() => onRemoveItem(item.id)}
                    className="rounded-lg p-2.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label={`Remove item ${index + 1}`}
                  >
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-100 p-5 md:px-6">
        <button
          type="button"
          onClick={onAddItem}
          className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-[#f58220] px-4 text-xs font-bold text-[#e77418] transition hover:bg-orange-50"
        >
          <Icon name="plus" className="h-4 w-4" />
          Add Material Row
        </button>
      </div>
    </section>
  );
}
