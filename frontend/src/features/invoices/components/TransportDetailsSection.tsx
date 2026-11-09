interface TransportDetailsSectionProps {
  withTransport: boolean;
  transportFee: number;
  onToggleTransport: (enabled: boolean) => void;
  onChangeTransportFee: (fee: number) => void;
}

export function TransportDetailsSection({
  withTransport,
  transportFee,
  onToggleTransport,
  onChangeTransportFee,
}: TransportDetailsSectionProps) {
  return (
    <section className="invoice-panel">
      <div className="invoice-panel-heading">
        <span className="invoice-step">03</span>
        <div>
          <h2>Transport Details</h2>
          <p>Select transport option for delivery</p>
        </div>
      </div>
      <div className="p-5 md:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
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
            onClick={() => onToggleTransport(false)}
            className={`transport-option ${!withTransport ? "transport-option-active" : ""}`}
          >
            <span className="option-radio">{!withTransport && <span />}</span>
            <span>
              <strong>Without Transport</strong>
              <small>Customer self-pickup</small>
            </span>
          </button>
        </div>
        {withTransport && (
          <label className="mt-5 block max-w-sm">
            <span className="form-label">Transport Fee (LKR)</span>
            <div className="relative">
              <input
                className="form-control pl-12"
                type="number"
                min="0"
                value={transportFee}
                onChange={(event) => onChangeTransportFee(Number(event.target.value))}
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
