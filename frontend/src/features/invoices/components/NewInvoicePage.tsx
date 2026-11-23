import { Icon } from "../../../components/ui/Icon.tsx";
import { useLanguage } from "../../../i18n/LanguageContext.tsx";
import { useInvoiceForm } from "../hooks/useInvoiceForm.ts";
import { CustomerDetailsSection } from "./CustomerDetailsSection.tsx";
import { InvoiceDetailPage } from "./InvoiceDetailPage.tsx";
import { InvoiceSummaryCard } from "./InvoiceSummaryCard.tsx";
import { MaterialItemsSection } from "./MaterialItemsSection.tsx";
import { PaymentDetailsSection } from "./PaymentDetailsSection.tsx";
import { TransportDetailsSection } from "./TransportDetailsSection.tsx";

interface NewInvoicePageProps {
  onCancel: () => void;
}

export function NewInvoicePage({ onCancel }: NewInvoicePageProps) {
  const { t } = useLanguage();
  const {
    materials,
    materialsLoading,
    materialsError,
    reloadMaterials,
    selectedCustomer,
    customerDraft,
    handleSelectCustomer,
    handleChangeCustomerDraft,
    vehicleCategory,
    handleSelectVehicleCategory,
    items,
    updateMaterial,
    updateQuantity,
    addItem,
    removeItem,
    withTransport,
    transportFee,
    handleToggleTransport,
    handleChangeTransportFee,
    cashReceived,
    handleChangeCashReceived,
    totals,
    isSubmitting,
    submitError,
    persistedInvoice,
    saveInvoice,
    resetForNewInvoice,
    unconfiguredWarning,
    canSubmit,
  } = useInvoiceForm();

  if (persistedInvoice) {
    return (
      <div>
        <div className="no-print mx-auto max-w-[1250px] px-4 pt-6 md:px-8 lg:px-10">
          <div
            role="status"
            className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Icon name="check" className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-extrabold text-emerald-900">
                {t("invoiceSavedSuccess")} ({persistedInvoice.invoiceNumber})
              </p>
              <p className="text-xs text-emerald-700">
                {t("invoiceSavedSuccessSubtitle")}
              </p>
            </div>
          </div>
        </div>

        <InvoiceDetailPage
          initialInvoice={persistedInvoice}
          onBack={onCancel}
          onCreateAnother={resetForNewInvoice}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8 lg:p-10">
      <section className="mb-7 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <p className="mb-2 text-sm font-bold text-[#f58220]">
            {t("salesInvoice")}
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#092547] md:text-[32px]">
            {t("newSalesInvoiceTitle")}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {t("newSalesInvoiceSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-sm">
          <Icon name="lock" className="h-4 w-4 text-[#124f8c]" />
          <span>{t("summarySubtitle")}</span>
        </div>
      </section>

      {materialsError && (
        <div
          role="alert"
          className="mb-6 flex flex-col justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800 sm:flex-row sm:items-center"
        >
          <span>{materialsError}</span>
          <button
            type="button"
            onClick={() => {
              void reloadMaterials();
            }}
            className="self-start rounded-lg bg-rose-700 px-3 py-1.5 font-bold text-white"
          >
            Retry
          </button>
        </div>
      )}

      {!materialsLoading && !materialsError && materials.length === 0 && (
        <div
          role="status"
          className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-900"
        >
          No active materials are currently configured in the database catalogue. Invoices cannot be issued until materials (3/4&quot;, Dust, 6×9, ABC) and active selling prices are configured.
        </div>
      )}

      {submitError && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700"
        >
          {submitError}
        </div>
      )}

      <div className="space-y-6">
        <CustomerDetailsSection
          selectedCustomer={selectedCustomer}
          customerDraft={customerDraft}
          onSelectCustomer={handleSelectCustomer}
          onChangeDraft={handleChangeCustomerDraft}
          disabled={isSubmitting}
        />

        <MaterialItemsSection
          materials={materials}
          items={items}
          vehicleCategory={vehicleCategory}
          onSelectVehicleCategory={handleSelectVehicleCategory}
          unconfiguredWarning={unconfiguredWarning}
          onUpdateMaterial={updateMaterial}
          onUpdateQuantity={updateQuantity}
          onAddItem={addItem}
          onRemoveItem={removeItem}
          disabled={isSubmitting || materialsLoading}
        />

        <div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
          <div className="space-y-6">
            <TransportDetailsSection
              withTransport={withTransport}
              transportFee={transportFee}
              onToggleTransport={handleToggleTransport}
              onChangeTransportFee={handleChangeTransportFee}
              disabled={isSubmitting}
            />

            <PaymentDetailsSection
              cashReceived={cashReceived}
              onChangeCashReceived={handleChangeCashReceived}
              paymentStatus={totals.paymentStatus}
              balance={totals.balance}
              paidAmount={totals.paidAmount}
              grandTotal={totals.grandTotal}
              isOverpayment={totals.isOverpayment}
              overpaymentAmount={totals.overpaymentAmount}
              disabled={isSubmitting}
            />
          </div>

          <InvoiceSummaryCard
            subtotal={totals.subtotal}
            withTransport={withTransport}
            transportFee={withTransport ? Number(transportFee) || 0 : 0}
            grandTotal={totals.grandTotal}
            paidAmount={totals.paidAmount}
            balance={totals.balance}
            isSubmitting={isSubmitting}
            canSubmit={canSubmit}
            onSaveInvoice={() => {
              void saveInvoice();
            }}
            onCancel={onCancel}
          />
        </div>
      </div>
    </div>
  );
}
