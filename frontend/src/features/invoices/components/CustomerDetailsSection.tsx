export function CustomerDetailsSection() {
  return (
    <section className="invoice-panel">
      <div className="invoice-panel-heading">
        <span className="invoice-step">01</span>
        <div>
          <h2>Customer Details</h2>
          <p>Required contact and delivery information</p>
        </div>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-4 md:p-6">
        <label className="xl:col-span-2">
          <span className="form-label">Customer / Company Name *</span>
          <input
            className="form-control"
            defaultValue="Saman Construction (Pvt) Ltd"
            placeholder="Enter customer or company name"
          />
        </label>
        <label>
          <span className="form-label">Phone Number *</span>
          <input className="form-control" defaultValue="077 234 5678" type="tel" />
        </label>
        <label>
          <span className="form-label">Invoice Date *</span>
          <input className="form-control" defaultValue="2025-05-24" type="date" />
        </label>
        <label className="sm:col-span-2 xl:col-span-4">
          <span className="form-label">Location / Delivery Address *</span>
          <input
            className="form-control"
            defaultValue="No. 84, Dambulla Road, Kurunegala"
            placeholder="Enter delivery site or address"
          />
        </label>
      </div>
    </section>
  );
}
