import { Icon } from "../../../components/ui/Icon";
import { useInvoiceForm } from "../hooks/useInvoiceForm";
import { DemoConfirmationNotice } from "./DemoConfirmationNotice";
import { CustomerDetailsSection } from "./CustomerDetailsSection";
import { MaterialItemsSection } from "./MaterialItemsSection";
import { TransportDetailsSection } from "./TransportDetailsSection";
import { PaymentDetailsSection } from "./PaymentDetailsSection";
import { InvoiceSummaryCard } from "./InvoiceSummaryCard";

interface NewInvoicePageProps {
  onCancel: () => void;
}

export function NewInvoicePage({ onCancel }: NewInvoicePageProps) {
  const {
    saved,
    setSaved,
    items,
    withTransport,
    setWithTransport,
    transportFee,
    setTransportFee,
    cashReceived,
    setCashReceived,
    totals,
    updateMaterial,
    updateQuantity,
    addItem,
    removeItem,
  } = useInvoiceForm();

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8 lg:p-10">
      <div
        role="note"
        className="mb-6 flex flex-col justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 sm:flex-row sm:items-center"
      >
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-amber-900">
            UI Simulation / Demo Mode Only
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            Calculations use interactive demo pricing and do not save invoices or payments to PostgreSQL yet.
          </p>
        </div>
        <span className="inline-flex shrink-0 self-start rounded-full bg-amber-200/80 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.06em] text-amber-950 sm:self-center">
          Demo Only
        </span>
      </div>

      {saved && <DemoConfirmationNotice />}

      <section className="mb-7 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <p className="mb-2 text-sm font-bold text-[#f58220]">Sales Invoice</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#092547] md:text-[32px]">
            Create New Invoice
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Enter customer, material, and payment details accurately.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#124f8c] text-white">
            <Icon name="invoice" className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400">Invoice Number</p>
            <p className="text-base font-extrabold tracking-wide text-[#092547]">INV-1049</p>
          </div>
        </div>
      </section>

      <fieldset disabled={saved} className="space-y-6 disabled:opacity-80">
        <CustomerDetailsSection />

        <MaterialItemsSection
          items={items}
          onUpdateMaterial={updateMaterial}
          onUpdateQuantity={updateQuantity}
          onAddItem={addItem}
          onRemoveItem={removeItem}
        />

        <div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
          <div className="space-y-6">
            <TransportDetailsSection
              withTransport={withTransport}
              transportFee={transportFee}
              onToggleTransport={setWithTransport}
              onChangeTransportFee={setTransportFee}
            />

            <PaymentDetailsSection
              cashReceived={cashReceived}
              onChangeCashReceived={setCashReceived}
              paymentStatus={totals.paymentStatus}
              balance={totals.balance}
              paidAmount={totals.paidAmount}
              grandTotal={totals.grandTotal}
              isOverpayment={totals.isOverpayment}
              overpaymentAmount={totals.overpaymentAmount}
            />
          </div>

          <InvoiceSummaryCard
            subtotal={totals.subtotal}
            withTransport={withTransport}
            transportFee={transportFee}
            grandTotal={totals.grandTotal}
            paidAmount={totals.paidAmount}
            balance={totals.balance}
          />
        </div>
      </fieldset>

      <div className="mt-6 flex flex-col-reverse items-stretch justify-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:p-5">
        {totals.isOverpayment && (
          <p className="mr-auto text-xs font-bold text-rose-600">
            Cannot issue invoice: entered cash exceeds the grand total.
          </p>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="min-h-12 rounded-xl border border-slate-200 px-6 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
        >
          {saved ? "Back to Dashboard" : "Cancel"}
        </button>
        <button
          type="button"
          onClick={() => setSaved(true)}
          disabled={saved || totals.isOverpayment}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#f58220] px-7 text-sm font-bold text-white shadow-[0_8px_22px_rgba(245,130,32,.22)] transition hover:bg-[#e77418] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          title={
            totals.isOverpayment
              ? "Cannot issue invoice: Cash received exceeds the grand total."
              : undefined
          }
        >
          <Icon
            name={saved ? "check" : totals.isOverpayment ? "lock" : "print"}
            className="h-5 w-5"
          />
          {saved
            ? "Simulation Confirmed (Demo)"
            : totals.isOverpayment
              ? "Cannot Issue: Payment Exceeds Total"
              : "Save & Print A5 Invoice (Demo Preview)"}
        </button>
      </div>

      <p className="mt-5 text-center text-[10px] text-slate-400">
        Illustrative design prototype · Material prices and invoice actions are for demonstration and not yet persisted to the database.
      </p>
    </div>
  );
}
