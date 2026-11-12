interface TransportDetailsSectionProps {
  withTransport: boolean;
  transportFee: string;
  onToggleTransport: (enabled: boolean) => void;
  onChangeTransportFee: (fee: string) => void;
  disabled?: boolean;
}

export function TransportDetailsSection({
  withTransport,
  transportFee,
  onToggleTransport,
  onChangeTransportFee,
  disabled = false,
}: TransportDetailsSectionProps) {
  return (
    <section className="invoice-panel">
      <div className="invoice-panel-heading">
        <span className="invoice-step">03</span>
        <div>
          <h2>Transport Details</h2>
          <p>Select delivery transport or customer self-pickup</p>
        </div>
      </div>
      <div className="p-5 md:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onToggleTransport(true)}
            className={`transport-option ${withTransport ? "transport-option-active" : ""}`}
          >
            <span className="option-radio">{withTransport && <span />}</span>
            <span>
              <strong>With Transport</strong>
              <small>Delivery to site included</small>
            </span>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onToggleTransport(false)}
            className={`transport-option ${!withTransport ? "transport-option-active" : ""}`}
          >
            <span className="option-radio">{!withTransport && <span />}</span>
            <span>
              <strong>Without Transport</strong>
              <small>Customer self-pickup (Rs. 0.00)</small>
            </span>
          </button>
        </div>
        {withTransport && (
          <label className="mt-5 block max-w-sm">
            <span className="form-label">Transport Fee (LKR)</span>
            <div className="relative">
              <input
                name="transportFee"
                disabled={disabled}
                className="form-control pl-12"
                type="text"
                inputMode="decimal"
                value={transportFee}
                onChange={(event) => onChangeTransportFee(event.target.value)}
                placeholder="0.00"
              />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                Rs.
              </span>
            </div>
          </label>
        )}
      </div>
    </section>
  );
}
