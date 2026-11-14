import { useEffect, useState } from "react";
import { searchCustomers } from "../../../api/billing.ts";
import { Icon } from "../../../components/ui/Icon.tsx";
import { useLanguage } from "../../../i18n/LanguageContext.tsx";
import type { CustomerRecord } from "../../../types/billing.ts";

export interface CustomerDraft {
  name: string;
  phone: string;
  location: string;
}

interface CustomerDetailsSectionProps {
  selectedCustomer: CustomerRecord | null;
  customerDraft: CustomerDraft;
  onSelectCustomer: (customer: CustomerRecord | null) => void;
  onChangeDraft: (next: CustomerDraft) => void;
  disabled?: boolean;
}

export function CustomerDetailsSection({
  selectedCustomer,
  customerDraft,
  onSelectCustomer,
  onChangeDraft,
  disabled = false,
}: CustomerDetailsSectionProps) {
  const { t } = useLanguage();
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<CustomerRecord[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedCustomer) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      void searchCustomers(searchTerm)
        .then((rows) => {
          if (!cancelled) {
            setResults(rows);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSearchError("Could not load customers from server.");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearching(false);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchTerm, selectedCustomer]);

  return (
    <section className="invoice-panel">
      <div className="invoice-panel-heading flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="invoice-step">01</span>
          <div>
            <h2>{t("stepCustomer")}</h2>
            <p>{t("stepCustomerSubtitle")}</p>
          </div>
        </div>
        {selectedCustomer && !disabled && (
          <button
            type="button"
            onClick={() => onSelectCustomer(null)}
            className="self-start rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-[#124f8c] hover:bg-slate-50 sm:self-auto"
          >
            {t("changeCustomer")}
          </button>
        )}
      </div>

      {selectedCustomer ? (
        <div className="p-5 md:p-6">
          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 sm:flex-row sm:items-center">
            <div>
              <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-emerald-800">
                {t("selectedCustomerBadge")} #{selectedCustomer.id}
              </span>
              <p className="mt-1.5 text-base font-extrabold text-[#092547]">
                {selectedCustomer.name}
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                {t("customerPhone")}: <strong>{selectedCustomer.phone}</strong> · {t("deliveryLocation")}:{" "}
                <strong>{selectedCustomer.location}</strong>
              </p>
            </div>
            <Icon name="check" className="h-6 w-6 shrink-0 text-emerald-600" />
          </div>
        </div>
      ) : (
        <div className="space-y-5 p-5 md:p-6">
          <div className="rounded-2xl border border-slate-200/80 bg-[#f8fafc] p-4">
            <label htmlFor="customer-search-input" className="form-label">
              {t("searchCustomerPlaceholder")}
            </label>
            <input
              id="customer-search-input"
              type="search"
              disabled={disabled}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t("searchCustomerPlaceholder")}
              className="form-control bg-white"
            />
            {searching && (
              <p className="mt-2 text-xs text-slate-400">{t("loading")}</p>
            )}
            {searchError && (
              <p className="mt-2 text-xs font-semibold text-rose-600">
                {searchError}
              </p>
            )}
            {results.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {results.slice(0, 6).map((cust) => (
                  <button
                    key={cust.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelectCustomer(cust)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs transition hover:border-[#f58220] hover:bg-orange-50/40"
                  >
                    <p className="font-bold text-[#092547]">{cust.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {cust.phone} · {cust.location}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <label className="xl:col-span-2">
              <span className="form-label">{t("customerName")} *</span>
              <input
                name="customerName"
                className="form-control"
                disabled={disabled}
                value={customerDraft.name}
                onChange={(e) =>
                  onChangeDraft({ ...customerDraft, name: e.target.value })
                }
                placeholder={t("customerName")}
                required
              />
            </label>
            <label>
              <span className="form-label">{t("customerPhone")} *</span>
              <input
                name="customerPhone"
                className="form-control"
                type="tel"
                disabled={disabled}
                value={customerDraft.phone}
                onChange={(e) =>
                  onChangeDraft({ ...customerDraft, phone: e.target.value })
                }
                placeholder="0771234567"
                required
              />
            </label>
            <label className="sm:col-span-2 xl:col-span-4">
              <span className="form-label">{t("deliveryLocation")} *</span>
              <input
                name="customerLocation"
                className="form-control"
                disabled={disabled}
                value={customerDraft.location}
                onChange={(e) =>
                  onChangeDraft({ ...customerDraft, location: e.target.value })
                }
                placeholder={t("deliveryLocation")}
                required
              />
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
