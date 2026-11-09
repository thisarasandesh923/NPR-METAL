import { useState, type ReactNode } from "react";

type IconName =
  | "dashboard"
  | "invoice"
  | "history"
  | "customers"
  | "payments"
  | "logout"
  | "sales"
  | "cash"
  | "balance"
  | "documents"
  | "plus"
  | "menu"
  | "close"
  | "arrow"
  | "bell"
  | "trash"
  | "print"
  | "lock"
  | "check";

const iconPaths: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  invoice: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M12 18v-6M9 15h6" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
  customers: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  payments: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20M6 15h2" />
    </>
  ),
  logout: (
    <>
      <path d="M10 17l5-5-5-5M15 12H3" />
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    </>
  ),
  sales: (
    <>
      <path d="M3 3v18h18" />
      <path d="m7 16 4-5 4 3 5-7" />
    </>
  ),
  cash: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9h.01M18 15h.01" />
    </>
  ),
  balance: (
    <>
      <path d="M12 3v18M5 6h14M5 6l-3 7h6L5 6ZM19 6l-3 7h6l-3-7Z" />
    </>
  ),
  documents: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z" />
      <path d="M8 7h5M8 11h5M9 22h9a2 2 0 0 0 2-2V7" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  arrow: <path d="m9 18 6-6-6-6" />,
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v5M14 11v5" />
    </>
  ),
  print: (
    <>
      <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
};

function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}

const navItems: { label: string; icon: IconName; screen?: "dashboard" | "invoice" }[] = [
  { label: "Dashboard", icon: "dashboard", screen: "dashboard" },
  { label: "New Invoice", icon: "invoice" },
  { label: "Invoice History", icon: "history" },
  { label: "Customers", icon: "customers" },
  { label: "Payments", icon: "payments" },
];

const stats: {
  label: string;
  value: string;
  note: string;
  icon: IconName;
  tone: string;
}[] = [
  {
    label: "Today's Sales",
    value: "Rs. 284,500",
    note: "12% more than yesterday",
    icon: "sales",
    tone: "blue",
  },
  {
    label: "Cash Collected",
    value: "Rs. 198,000",
    note: "From 8 transactions",
    icon: "cash",
    tone: "green",
  },
  {
    label: "Outstanding Balance",
    value: "Rs. 86,500",
    note: "From 3 invoices",
    icon: "balance",
    tone: "orange",
  },
  {
    label: "Total Invoices",
    value: "12",
    note: "Issued today",
    icon: "documents",
    tone: "navy",
  },
];

const invoices = [
  {
    id: "INV-1048",
    customer: "Saman Construction",
    initials: "SC",
    material: '3/4"',
    quantity: "8.5 m³",
    total: "Rs. 102,000",
    status: "Paid",
    time: "10:42 AM",
  },
  {
    id: "INV-1047",
    customer: "Nimal Perera",
    initials: "NP",
    material: "ABC",
    quantity: "5.0 m³",
    total: "Rs. 57,500",
    status: "Partial",
    time: "09:58 AM",
  },
  {
    id: "INV-1046",
    customer: "Sigiri Builders",
    initials: "SB",
    material: "Dust",
    quantity: "6.0 m³",
    total: "Rs. 48,000",
    status: "Unpaid",
    time: "09:15 AM",
  },
  {
    id: "INV-1045",
    customer: "Lakmal Hardware",
    initials: "LH",
    material: "6×9",
    quantity: "7.5 m³",
    total: "Rs. 77,000",
    status: "Paid",
    time: "08:37 AM",
  },
];

function Sidebar({
  open,
  onClose,
  onCreate,
  onDashboard,
  currentScreen,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: () => void;
  onDashboard: () => void;
  currentScreen: "dashboard" | "invoice";
}) {
  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-[#071b35]/50 backdrop-blur-sm transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[274px] flex-col bg-[#092547] text-white shadow-2xl transition-transform duration-300 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-[92px] items-center gap-3 border-b border-white/10 px-6">
          <div className="brand-mark" aria-hidden="true">
            <span>N</span>
          </div>
          <div>
            <p className="text-[19px] font-extrabold tracking-[0.02em]">
              NPR <span className="text-[#f58220]">METAL</span>
            </p>
            <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.17em] text-blue-200/70">
              Crusher & Workshop
            </p>
          </div>
          <button
            className="ml-auto rounded-lg p-2 text-blue-100 hover:bg-white/10 lg:hidden"
            onClick={onClose}
            aria-label="Close menu"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 px-4 py-7">
          <p className="mb-3 px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-200/50">
            Main Menu
          </p>
          <div className="space-y-1.5">
            {navItems.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  if (item.icon === "invoice") onCreate();
                  if (item.icon === "dashboard") onDashboard();
                  onClose();
                }}
                className={`group flex w-full items-center gap-3.5 rounded-xl px-4 py-3.5 text-left text-sm font-semibold transition ${
                  (item.icon === "dashboard" && currentScreen === "dashboard") ||
                  (item.icon === "invoice" && currentScreen === "invoice")
                    ? "bg-[#f58220] text-white shadow-[0_8px_24px_rgba(245,130,32,.22)]"
                    : "text-blue-100/75 hover:bg-white/8 hover:text-white"
                }`}
              >
                <Icon name={item.icon} className="h-[21px] w-[21px] shrink-0" />
                {item.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-white/[0.06] p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f58220] text-sm font-bold">
              K
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">Kasun Perera</p>
              <p className="text-xs text-blue-200/60">Cashier</p>
            </div>
          </div>
          <button className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-blue-100/65 transition hover:bg-white/8 hover:text-white">
            <Icon name="logout" className="h-5 w-5" />
            Logout
          </button>
        </div>
      </aside>
    </>
  );
}

type MaterialName = '3/4"' | "Dust" | "6×9" | "ABC";

type MaterialRow = {
  id: number;
  material: MaterialName;
  quantity: number;
  price: number;
};

const configuredPrices: Record<MaterialName, number> = {
  '3/4"': 12000,
  Dust: 8000,
  "6×9": 10500,
  ABC: 11500,
};

const materialOptions = Object.keys(configuredPrices) as MaterialName[];

const formatLkr = (amount: number) =>
  `Rs. ${amount.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function NewInvoicePage({ onCancel }: { onCancel: () => void }) {
  const [items, setItems] = useState<MaterialRow[]>([
    { id: 1, material: '3/4"', quantity: 5.5, price: configuredPrices['3/4"'] },
    { id: 2, material: "Dust", quantity: 2, price: configuredPrices.Dust },
  ]);
  const [withTransport, setWithTransport] = useState(true);
  const [transportFee, setTransportFee] = useState(7500);
  const [cashReceived, setCashReceived] = useState(50000);
  const [saved, setSaved] = useState(false);

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const grandTotal = subtotal + (withTransport ? transportFee : 0);
  const paidAmount = Math.min(Math.max(cashReceived || 0, 0), grandTotal);
  const balance = Math.max(grandTotal - paidAmount, 0);
  const paymentStatus =
    paidAmount === 0 ? "Unpaid" : balance === 0 ? "Paid" : "Partial";

  const updateMaterial = (id: number, material: MaterialName) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, material, price: configuredPrices[material] } : item,
      ),
    );
  };

  const updateQuantity = (id: number, quantity: number) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, quantity } : item)));
  };

  const addItem = () => {
    setItems((current) => [
      ...current,
      {
        id: Math.max(...current.map((item) => item.id), 0) + 1,
        material: "ABC",
        quantity: 1,
        price: configuredPrices.ABC,
      },
    ]);
  };

  const removeItem = (id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  };

  return (
    <>
      <div className="mx-auto max-w-[1500px] p-4 md:p-8 lg:p-10">
        {saved && (
          <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:flex-row sm:items-center">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Icon name="check" className="h-6 w-6" />
            </div>
            <div>
              <p className="font-extrabold text-emerald-900">Invoice Simulation Confirmed (Demo Preview)</p>
              <p className="mt-1 text-xs leading-5 text-emerald-700">
                This is a UI prototype demonstration. In production, issued invoices are permanently saved to PostgreSQL, locked against cashier edits, and routed to the A5 print engine.
              </p>
            </div>
          </div>
        )}

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
                            updateMaterial(item.id, event.target.value as MaterialName)
                          }
                        >
                          {materialOptions.map((material) => (
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
                              updateQuantity(item.id, Number(event.target.value))
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
                          onClick={() => removeItem(item.id)}
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
                onClick={addItem}
                className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-[#f58220] px-4 text-xs font-bold text-[#e77418] transition hover:bg-orange-50"
              >
                <Icon name="plus" className="h-4 w-4" />
                Add Material Row
              </button>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
            <div className="space-y-6">
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
                      onClick={() => setWithTransport(true)}
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
                      onClick={() => setWithTransport(false)}
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
                          onChange={(event) => setTransportFee(Number(event.target.value))}
                        />
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                          Rs.
                        </span>
                      </div>
                    </label>
                  )}
                </div>
              </section>

              <section className="invoice-panel">
                <div className="invoice-panel-heading">
                  <span className="invoice-step">04</span>
                  <div>
                    <h2>Cash Payment</h2>
                    <p>Payment status is calculated based on cash received</p>
                  </div>
                </div>
                <div className="grid gap-5 p-5 md:grid-cols-2 md:p-6">
                  <label>
                    <span className="form-label">Cash Received (LKR)</span>
                    <div className="relative">
                      <input
                        className="form-control pl-12 text-base font-extrabold"
                        type="number"
                        min="0"
                        value={cashReceived}
                        onChange={(event) => setCashReceived(Number(event.target.value))}
                      />
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                        Rs.
                      </span>
                    </div>
                  </label>
                  <div>
                    <span className="form-label">Payment Status</span>
                    <div
                      className={`payment-state ${
                        balance === 0
                          ? "payment-state-paid"
                          : paidAmount === 0
                            ? "payment-state-unpaid"
                            : "payment-state-partial"
                      }`}
                    >
                      <span />
                      {paymentStatus}
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <aside className="h-fit overflow-hidden rounded-2xl bg-[#092547] text-white shadow-[0_14px_35px_rgba(9,37,71,.16)]">
              <div className="border-b border-white/10 px-6 py-5">
                <p className="text-base font-extrabold">Invoice Summary</p>
                <p className="mt-1 text-[11px] text-blue-200/60">INV-1049 · May 24, 2025</p>
              </div>
              <div className="space-y-4 p-6 text-sm">
                <div className="flex justify-between gap-4 text-blue-100/70">
                  <span>Subtotal</span>
                  <strong className="text-white">{formatLkr(subtotal)}</strong>
                </div>
                <div className="flex justify-between gap-4 text-blue-100/70">
                  <span>Transport Fee</span>
                  <strong className="text-white">
                    {formatLkr(withTransport ? transportFee : 0)}
                  </strong>
                </div>
                <div className="border-t border-dashed border-white/20 pt-5">
                  <div className="flex items-end justify-between gap-4">
                    <span className="font-bold">Grand Total</span>
                    <strong className="text-xl font-extrabold text-[#ff9b43]">
                      {formatLkr(grandTotal)}
                    </strong>
                  </div>
                </div>
                <div className="flex justify-between gap-4 text-blue-100/70">
                  <span>Paid Amount</span>
                  <strong className="text-emerald-300">{formatLkr(paidAmount)}</strong>
                </div>
                <div className="rounded-xl bg-white/[0.07] p-4">
                  <div className="flex items-end justify-between gap-4">
                    <span className="text-xs font-bold text-blue-100/70">Balance Due</span>
                    <strong className="text-lg font-extrabold">{formatLkr(balance)}</strong>
                  </div>
                </div>
                <p className="flex gap-2 pt-1 text-[10px] leading-5 text-blue-200/55">
                  <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Once issued, this invoice cannot be modified by cashiers.
                </p>
              </div>
            </aside>
          </div>
        </fieldset>

        <div className="mt-6 flex flex-col-reverse justify-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:p-5">
          <button
            onClick={onCancel}
            className="min-h-12 rounded-xl border border-slate-200 px-6 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
          >
            {saved ? "Back to Dashboard" : "Cancel"}
          </button>
          <button
            onClick={() => setSaved(true)}
            disabled={saved}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#f58220] px-7 text-sm font-bold text-white shadow-[0_8px_22px_rgba(245,130,32,.22)] transition hover:bg-[#e77418] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          >
            <Icon name={saved ? "check" : "print"} className="h-5 w-5" />
            {saved ? "Simulation Confirmed (Demo)" : "Save & Print A5 Invoice (Demo Preview)"}
          </button>
        </div>

        <p className="mt-5 text-center text-[10px] text-slate-400">
          Illustrative design prototype · Material prices and invoice actions are for demonstration and not yet persisted to the database.
        </p>
      </div>
    </>
  );
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [screen, setScreen] = useState<"dashboard" | "invoice">("dashboard");

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onCreate={() => setScreen("invoice")}
        onDashboard={() => setScreen("dashboard")}
        currentScreen={screen}
      />

      <main className="min-h-screen lg:ml-[274px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur md:px-8 lg:px-10">
          <button
            onClick={() => setMenuOpen(true)}
            className="mr-3 rounded-xl border border-slate-200 p-2.5 text-[#092547] lg:hidden"
            aria-label="Open menu"
          >
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <div className="hidden text-sm text-slate-400 sm:block">
            Dashboard <span className="mx-2 text-slate-300">/</span>{" "}
            <span className="font-semibold text-[#092547]">
              {screen === "dashboard" ? "Overview" : "New Invoice"}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right md:block">
              <p className="text-sm font-bold text-[#092547]">Saturday, May 24, 2025</p>
              <p className="mt-0.5 text-xs text-slate-400">Kurunegala, Sri Lanka</p>
            </div>
            <button className="relative ml-2 rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 transition hover:bg-slate-50">
              <Icon name="bell" className="h-5 w-5" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-white bg-[#f58220]" />
            </button>
          </div>
        </header>

        {screen === "invoice" ? (
          <NewInvoicePage onCancel={() => setScreen("dashboard")} />
        ) : (
          <div className="mx-auto max-w-[1500px] p-4 md:p-8 lg:p-10">
            <section className="mb-8 flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
              <div>
                <p className="mb-2 text-sm font-bold text-[#f58220]">Welcome, Kasun!</p>
                <h1 className="text-2xl font-extrabold tracking-tight text-[#092547] md:text-[32px]">
                  Cashier Dashboard
                </h1>
                <p className="mt-2 text-sm text-slate-500 md:text-[15px]">
                  Manage today's sales and payment collection here.
                </p>
              </div>
              <button
                onClick={() => setScreen("invoice")}
                className="flex min-h-14 items-center justify-center gap-3 rounded-xl bg-[#f58220] px-6 text-[15px] font-bold text-white shadow-[0_10px_28px_rgba(245,130,32,.25)] transition hover:-translate-y-0.5 hover:bg-[#e77418] focus:outline-none focus:ring-4 focus:ring-orange-200"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20">
                  <Icon name="plus" className="h-5 w-5" />
                </span>
                Create New Invoice
              </button>
            </section>

            <section className="mb-8 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
              {stats.map((stat) => (
                <article
                  key={stat.label}
                  className="stat-card relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_4px_18px_rgba(15,39,71,.045)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[13px] font-semibold text-slate-500">{stat.label}</p>
                      <p className="mt-3 whitespace-nowrap text-[22px] font-extrabold tracking-tight text-[#092547]">
                        {stat.value}
                      </p>
                    </div>
                    <div className={`stat-icon stat-${stat.tone}`}>
                      <Icon name={stat.icon} className="h-[22px] w-[22px]" />
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
                    {stat.tone === "blue" && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-600">
                        +12%
                      </span>
                    )}
                    <p className="text-[11px] font-medium text-slate-400">{stat.note}</p>
                  </div>
                </article>
              ))}
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_20px_rgba(15,39,71,.045)]">
              <div className="flex flex-col justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center md:px-6">
                <div>
                  <h2 className="text-lg font-extrabold text-[#092547]">Recent Invoices</h2>
                  <p className="mt-1 text-xs text-slate-400">Latest invoices issued today</p>
                </div>
                <button className="flex items-center gap-2 self-start text-sm font-bold text-[#e77418] transition hover:text-[#bc5810] sm:self-auto">
                  View All
                  <Icon name="arrow" className="h-4 w-4" />
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] border-collapse">
                  <thead>
                    <tr className="bg-[#f8fafc] text-left">
                      <th>Invoice No.</th>
                      <th>Customer</th>
                      <th>Material</th>
                      <th>Quantity</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Time</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr
                        key={invoice.id}
                        className="group border-t border-slate-100 transition hover:bg-slate-50/80"
                      >
                        <td className="font-extrabold text-[#124f8c]">{invoice.id}</td>
                        <td>
                          <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#edf3fa] text-xs font-extrabold text-[#124f8c]">
                              {invoice.initials}
                            </span>
                            <span className="font-bold text-slate-700">{invoice.customer}</span>
                          </div>
                        </td>
                        <td className="font-medium text-slate-600">{invoice.material}</td>
                        <td className="font-semibold text-slate-600">{invoice.quantity}</td>
                        <td className="font-extrabold text-[#092547]">{invoice.total}</td>
                        <td>
                          <span
                            className={`status ${
                              invoice.status === "Paid"
                                ? "status-paid"
                                : invoice.status === "Partial"
                                  ? "status-partial"
                                  : "status-due"
                            }`}
                          >
                            <span />
                            {invoice.status}
                          </span>
                        </td>
                        <td className="text-slate-400">{invoice.time}</td>
                        <td>
                          <button
                            className="rounded-lg p-2 text-slate-300 transition hover:bg-white hover:text-[#124f8c] hover:shadow"
                            aria-label={`View ${invoice.id}`}
                          >
                            <Icon name="arrow" className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-xs text-slate-400 md:px-6">
                <span>Showing 4 of 12 invoices</span>
                <span className="font-semibold">Last updated: Just now</span>
              </div>
            </section>

            <p className="mt-6 text-center text-[11px] text-slate-400">
              NPR Metal Crusher Management System · Secure Cashier Workstation
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
