export type Language = "en" | "si";

export interface Translations {
  // App & Branding
  appName: string;
  appCrusherTagline: string;
  appTitle: string;
  workspace: string;
  locationKurunegala: string;
  locationSeenimodara: string;
  businessProprietor: string;
  roleOwner: string;
  roleCashier: string;
  languageToggle: string;
  signedInAs: string;

  // Common Actions & States
  loading: string;
  saving: string;
  submitting: string;
  save: string;
  cancel: string;
  submit: string;
  print: string;
  edit: string;
  delete: string;
  search: string;
  filter: string;
  all: string;
  actions: string;
  status: string;
  date: string;
  notes: string;
  remarks: string;
  logout: string;
  loggingOut: string;
  close: string;
  confirm: string;
  back: string;
  yes: string;
  no: string;

  // Statuses
  statusPaid: string;
  statusPartiallyPaid: string;
  statusUnpaid: string;
  statusCancelled: string;
  statusDraft: string;
  statusSubmitted: string;
  statusApproved: string;
  statusReturned: string;

  // Navigation
  navCashierDashboard: string;
  navNewInvoice: string;
  navInvoiceHistory: string;
  navDailyOperations: string;
  navOwnerDashboard: string;
  navApprovals: string;
  navPriceManagement: string;
  navWorkersMachines: string;
  navPayroll: string;
  workspaceLabel: string;

  // Cashier Dashboard
  welcomeCashier: string;
  cashierDashboardTitle: string;
  quickActions: string;
  createNewInvoice: string;
  invoiceHistoryAndPayments: string;
  recentIssuedInvoices: string;
  recentInvoicesSubtitle: string;
  viewFullHistory: string;
  noInvoicesYet: string;
  noInvoicesYetSubtitle: string;
  invoiceNo: string;
  customer: string;
  issuedAt: string;
  grandTotal: string;
  paidAmount: string;
  balanceDue: string;
  viewInvoice: string;

  // New Invoice Page
  salesInvoice: string;
  newSalesInvoiceTitle: string;
  newSalesInvoiceSubtitle: string;
  stepCustomer: string;
  stepCustomerSubtitle: string;
  searchCustomerPlaceholder: string;
  customerName: string;
  customerPhone: string;
  deliveryLocation: string;
  selectedCustomerBadge: string;
  changeCustomer: string;
  newCustomerNotice: string;
  sellingPriceCategory: string;
  sellingPriceCategorySubtitle: string;
  vehicleCategoryTractor: string;
  vehicleCategoryTipper: string;
  unconfiguredPriceAlert: string;
  stepMaterials: string;
  stepMaterialsSubtitle: string;
  serverLockedPrices: string;
  materialCol: string;
  quantityCol: string;
  unitPriceCol: string;
  lineTotalCol: string;
  removeCol: string;
  selectMaterialPlaceholder: string;
  addLineItem: string;
  stepTransport: string;
  stepTransportSubtitle: string;
  withTransport: string;
  withTransportSubtitle: string;
  withoutTransport: string;
  withoutTransportSubtitle: string;
  transportFeeLkr: string;
  stepPayment: string;
  stepPaymentSubtitle: string;
  initialCashReceived: string;
  creditInvoiceShortcut: string;
  fullPaymentShortcut: string;
  summaryTitle: string;
  summarySubtitle: string;
  subtotalPreview: string;
  transportFee: string;
  initialPaid: string;
  saveAndIssueInvoice: string;
  invoiceSavedSuccess: string;
  invoiceSavedSuccessSubtitle: string;
  printA5Receipt: string;
  createAnotherInvoice: string;
  returnToDashboard: string;

  // Invoice History Page
  invoiceHistoryTitle: string;
  invoiceHistorySubtitle: string;
  searchInvoicesPlaceholder: string;
  filterAll: string;
  filterPaid: string;
  filterPartiallyPaid: string;
  filterUnpaid: string;
  filterCancelled: string;

  // Invoice Detail Page
  invoiceDetailTitle: string;
  backToInvoiceHistory: string;
  invoiceDetailsCard: string;
  customerInfoCard: string;
  purchasedItemsCard: string;
  paymentLedgerCard: string;
  recordPaymentBtn: string;
  printA5Btn: string;
  printThermalBtn: string;
  createAnotherBtn: string;
  issuedByLabel: string;
  totalLkr: string;
  paidLkr: string;
  balanceLkr: string;
  noPaymentsYet: string;
  receiptNoCol: string;
  paymentAmountCol: string;
  collectedByCol: string;
  paymentDateCol: string;

  // Record Payment Modal
  recordCashPaymentTitle: string;
  recordPaymentSubtitle: string;
  paymentAmountLkr: string;
  receiptNumberOptional: string;
  payFullBalanceBtn: string;
  confirmPaymentBtn: string;
  paymentRecordedSuccess: string;
  balancePaidInFull: string;

  // Daily Operations Page
  dailyOpsTitle: string;
  dailyOpsSubtitle: string;
  tabAttendance: string;
  tabMachineHours: string;
  tabProduction: string;
  filterDateFrom: string;
  filterDateTo: string;
  filterStatus: string;
  workerCol: string;
  workDateCol: string;
  startTimeCol: string;
  endTimeCol: string;
  crossesMidnightCol: string;
  breakMinsCol: string;
  hoursWorkedCol: string;
  overtimeHoursCol: string;
  machineCol: string;
  operatorCol: string;
  downtimeMinsCol: string;
  downtimeReasonCol: string;
  producedMaterialCol: string;
  volumeM3Col: string;
  shiftCol: string;
  saveDraftBtn: string;
  submitForApprovalBtn: string;
  cancelDraftBtn: string;
  viewHistoryBtn: string;
  addNewRowBtn: string;
  noOperationsRecords: string;
  returnReasonLabel: string;
}

export const translations: Record<Language, Translations> = {
  en: {
    // App & Branding
    appName: "NPR METAL",
    appCrusherTagline: "Crusher & Workshop",
    appTitle: "NPR Metal Crusher — Billing & Management System",
    workspace: "Workspace",
    locationKurunegala: "Seenimodara, Sri Lanka",
    locationSeenimodara: "Seenimodara, Sri Lanka",
    businessProprietor: "Proprietor: Nalaka Ranasinghe",
    roleOwner: "Owner",
    roleCashier: "Cashier",
    languageToggle: "සිංහල",
    signedInAs: "Signed in as",

    // Common Actions & States
    loading: "Loading...",
    saving: "Saving...",
    submitting: "Submitting...",
    save: "Save",
    cancel: "Cancel",
    submit: "Submit",
    print: "Print",
    edit: "Edit",
    delete: "Delete",
    search: "Search",
    filter: "Filter",
    all: "All",
    actions: "Actions",
    status: "Status",
    date: "Date",
    notes: "Notes",
    remarks: "Remarks",
    logout: "Logout",
    loggingOut: "Signing out...",
    close: "Close",
    confirm: "Confirm",
    back: "Back",
    yes: "Yes",
    no: "No",

    // Statuses
    statusPaid: "PAID",
    statusPartiallyPaid: "PARTIALLY PAID",
    statusUnpaid: "UNPAID",
    statusCancelled: "CANCELLED",
    statusDraft: "DRAFT",
    statusSubmitted: "SUBMITTED",
    statusApproved: "APPROVED",
    statusReturned: "RETURNED FOR CORRECTION",

    // Navigation
    navCashierDashboard: "Cashier Dashboard",
    navNewInvoice: "New Invoice",
    navInvoiceHistory: "Invoice History",
    navDailyOperations: "Daily Operations",
    navOwnerDashboard: "Owner Dashboard",
    navApprovals: "Approvals Queue",
    navPriceManagement: "Price Management",
    navWorkersMachines: "Workers & Machines",
    navPayroll: "Payroll & Expenses",
    workspaceLabel: "Workspace",

    // Cashier Dashboard
    welcomeCashier: "Welcome",
    cashierDashboardTitle: "Cashier Dashboard",
    quickActions: "Quick Actions",
    createNewInvoice: "Create New Invoice",
    invoiceHistoryAndPayments: "Invoice History & Payments",
    recentIssuedInvoices: "Recent Issued Invoices (Live PostgreSQL)",
    recentInvoicesSubtitle: "Open any saved invoice to record partial/final cash payments or print A5 receipt",
    viewFullHistory: "View Full History",
    noInvoicesYet: "No invoices issued yet",
    noInvoicesYetSubtitle: "Click 'Create New Invoice' to record a customer sale and print an A5 invoice.",
    invoiceNo: "Invoice No.",
    customer: "Customer",
    issuedAt: "Issued At",
    grandTotal: "Grand Total",
    paidAmount: "Paid",
    balanceDue: "Balance Due",
    viewInvoice: "View Invoice",

    // New Invoice Page
    salesInvoice: "Sales Invoice",
    newSalesInvoiceTitle: "New Sales Invoice",
    newSalesInvoiceSubtitle: "Specify aggregate quantities, site delivery and cash received to record a permanent invoice.",
    stepCustomer: "Customer Details",
    stepCustomerSubtitle: "Search existing registered customer or enter new site delivery recipient",
    searchCustomerPlaceholder: "Search registered customers by name or phone...",
    customerName: "Customer Full Name",
    customerPhone: "Phone Number",
    deliveryLocation: "Delivery Location / Site Address",
    selectedCustomerBadge: "Selected Customer",
    changeCustomer: "Change Customer",
    newCustomerNotice: "New customer will be automatically registered on invoice issuance.",
    sellingPriceCategory: "Selling Price Category",
    sellingPriceCategorySubtitle: "Select Tractor or Tipper price tier for this invoice. Independent of delivery transport.",
    vehicleCategoryTractor: "Tractor (ට්‍රැක්ටර්)",
    vehicleCategoryTipper: "Tipper (ටිපර්)",
    unconfiguredPriceAlert: "Pricing is unconfigured for the selected vehicle category. Invoice submission is blocked.",
    stepMaterials: "Material Details",
    stepMaterialsSubtitle: "Enter quantities in cubic feet (ft³) using vehicle-specific catalogue prices",
    serverLockedPrices: "Server-Locked Unit Prices",
    materialCol: "Material",
    quantityCol: "Quantity (ft³)",
    unitPriceCol: "Unit Price (Rs. / ft³)",
    lineTotalCol: "Line Total",
    removeCol: "Remove",
    selectMaterialPlaceholder: "Select material...",
    addLineItem: "+ Add Another Material",
    stepTransport: "Transport Details",
    stepTransportSubtitle: "Select delivery transport or customer self-pickup",
    withTransport: "With Transport",
    withTransportSubtitle: "Delivery to site included",
    withoutTransport: "Without Transport",
    withoutTransportSubtitle: "Customer self-pickup (Rs. 0.00)",
    transportFeeLkr: "Transport Fee (LKR)",
    stepPayment: "Initial Cash Payment",
    stepPaymentSubtitle: "Enter cash received now (0 for credit invoice, or partial/full payment)",
    initialCashReceived: "Initial Cash Received (LKR)",
    creditInvoiceShortcut: "Credit (0)",
    fullPaymentShortcut: "Pay Full",
    summaryTitle: "Invoice Summary",
    summarySubtitle: "Authoritative invoice number & totals assigned on save",
    subtotalPreview: "Subtotal (Preview)",
    transportFee: "Transport Fee",
    initialPaid: "Initial Cash Paid",
    saveAndIssueInvoice: "Issue & Save Invoice",
    invoiceSavedSuccess: "Invoice Saved Permanently to PostgreSQL",
    invoiceSavedSuccessSubtitle: "You may now print the official A5 invoice or return to the dashboard.",
    printA5Receipt: "Print A5 Invoice",
    createAnotherInvoice: "Create Another Invoice",
    returnToDashboard: "Return to Dashboard",

    // Invoice History Page
    invoiceHistoryTitle: "Invoice History & Cash Ledger",
    invoiceHistorySubtitle: "Permanent immutable issued sales invoices and payment records",
    searchInvoicesPlaceholder: "Search by invoice number, customer name, or phone...",
    filterAll: "All Statuses",
    filterPaid: "Paid in Full",
    filterPartiallyPaid: "Partially Paid",
    filterUnpaid: "Unpaid / Credit",
    filterCancelled: "Cancelled",

    // Invoice Detail Page
    invoiceDetailTitle: "Invoice Details",
    backToInvoiceHistory: "← Back to Invoice History",
    invoiceDetailsCard: "Invoice Commercial Summary",
    customerInfoCard: "Customer & Delivery Information",
    purchasedItemsCard: "Material Line Items",
    paymentLedgerCard: "Cash Payment Ledger",
    recordPaymentBtn: "Record Cash Payment",
    printA5Btn: "Print A5 Invoice",
    printThermalBtn: "Print 80mm Receipt",
    createAnotherBtn: "+ Create Another Invoice",
    issuedByLabel: "Issued By",
    totalLkr: "Grand Total",
    paidLkr: "Paid Amount",
    balanceLkr: "Balance Due",
    noPaymentsYet: "No cash payments recorded against this invoice yet.",
    receiptNoCol: "Receipt No.",
    paymentAmountCol: "Amount Paid",
    collectedByCol: "Collected By",
    paymentDateCol: "Payment Date",

    // Record Payment Modal
    recordCashPaymentTitle: "Record Cash Payment",
    recordPaymentSubtitle: "Record append-only cash payment against invoice",
    paymentAmountLkr: "Payment Amount (LKR)",
    receiptNumberOptional: "Receipt Number / Slip Ref (Optional)",
    payFullBalanceBtn: "Pay Full Balance",
    confirmPaymentBtn: "Save Cash Payment",
    paymentRecordedSuccess: "Cash payment recorded successfully!",
    balancePaidInFull: "Invoice balance has been paid in full.",

    // Daily Operations Page
    dailyOpsTitle: "Daily Workshop Logs",
    dailyOpsSubtitle: "Tab across cells to enter attendance, machine operating hours, and daily crushed metal output (m³). Drafts can be edited until submitted & approved by Owner.",
    tabAttendance: "Worker Attendance",
    tabMachineHours: "Machine Work Hours",
    tabProduction: "Daily Production",
    filterDateFrom: "From Date",
    filterDateTo: "To Date",
    filterStatus: "Filter Status",
    workerCol: "Worker",
    workDateCol: "Work Date",
    startTimeCol: "Start Time",
    endTimeCol: "End Time",
    crossesMidnightCol: "Crosses Midnight",
    breakMinsCol: "Break (Mins)",
    hoursWorkedCol: "Hours Worked",
    overtimeHoursCol: "OT Hours",
    machineCol: "Machine",
    operatorCol: "Operator",
    downtimeMinsCol: "Downtime (Mins)",
    downtimeReasonCol: "Downtime Reason",
    producedMaterialCol: "Produced Material",
    volumeM3Col: "Volume (m³)",
    shiftCol: "Shift",
    saveDraftBtn: "Save Draft",
    submitForApprovalBtn: "Submit for Approval",
    cancelDraftBtn: "Cancel Draft",
    viewHistoryBtn: "View History",
    addNewRowBtn: "+ Add Row",
    noOperationsRecords: "No operational records found for the selected dates.",
    returnReasonLabel: "Return Reason",
  },

  si: {
    // App & Branding
    appName: "NPR METAL",
    appCrusherTagline: "ක්‍රෂර් සහ වැඩපොළ",
    appTitle: "NPR මෙටල් ක්‍රෂර් — බිල්පත් සහ කළමනාකරණ පද්ධතිය",
    workspace: "වැඩබිම",
    locationKurunegala: "සීනිමෝදර, ශ්‍රී ලංකා",
    locationSeenimodara: "සීනිමෝදර, ශ්‍රී ලංකා",
    businessProprietor: "හිමිකරු: නාලක රණසිංහ",
    roleOwner: "හිමිකරු",
    roleCashier: "මුදල් අයකැමි",
    languageToggle: "English",
    signedInAs: "පද්ධතියට පිවිස ඇත්තේ",

    // Common Actions & States
    loading: "පූරණය වෙමින් පවතී...",
    saving: "සුරකිමින් පවතී...",
    submitting: "යොමු කරමින් පවතී...",
    save: "සුරකින්න",
    cancel: "අවලංගු කරන්න",
    submit: "ඉදිරිපත් කරන්න",
    print: "මුද්‍රණය කරන්න",
    edit: "සංස්කරණය",
    delete: "මකන්න",
    search: "සොයන්න",
    filter: "පෙරහන",
    all: "සියල්ල",
    actions: "ක්‍රියාමාර්ග",
    status: "තත්ත්වය",
    date: "දිනය",
    notes: "සටහන්",
    remarks: "විශේෂ සටහන්",
    logout: "පද්ධතියෙන් ඉවත් වන්න",
    loggingOut: "ඉවත් වෙමින් පවතී...",
    close: "වසන්න",
    confirm: "තහවුරු කරන්න",
    back: "ආපසු",
    yes: "ඔව්",
    no: "නැත",

    // Statuses
    statusPaid: "සම්පූර්ණයෙන් ගෙවා ඇත",
    statusPartiallyPaid: "කොටසක් ගෙවා ඇත",
    statusUnpaid: "නොගෙවූ (ණය)",
    statusCancelled: "අවලංගුයි",
    statusDraft: "කෙටුම්පත",
    statusSubmitted: "අනුමැතියට යොමු කළා",
    statusApproved: "අනුමතයි",
    statusReturned: "සංශෝධනයට ආපසු එවූ",

    // Navigation
    navCashierDashboard: "ප්‍රධාන පුවරුව",
    navNewInvoice: "නව බිල්පත",
    navInvoiceHistory: "බිල්පත් ඉතිහාසය",
    navDailyOperations: "දෛනික මෙහෙයුම්",
    navOwnerDashboard: "හිමිකරු පුවරුව",
    navApprovals: "අනුමැතිය සඳහා පෝලිම",
    navPriceManagement: "මිල කළමනාකරණය",
    navWorkersMachines: "සේවකයන් සහ යන්ත්‍ර",
    navPayroll: "වැටුප් සහ වියදම්",
    workspaceLabel: "වැඩබිම",

    // Cashier Dashboard
    welcomeCashier: "ආයුබෝවන්",
    cashierDashboardTitle: "මුදල් අයකැමි පුවරුව",
    quickActions: "ක්ෂණික ක්‍රියාමාර්ග",
    createNewInvoice: "නව බිල්පතක් සකසන්න",
    invoiceHistoryAndPayments: "බිල්පත් ඉතිහාසය සහ ගෙවීම්",
    recentIssuedInvoices: "මෑතකදී නිකුත් කළ බිල්පත්",
    recentInvoicesSubtitle: "මුදල් ගෙවීම් සටහන් කිරීමට හෝ A5 බිල්පත මුද්‍රණය කිරීමට ඕනෑම බිල්පතක් විවෘත කරන්න",
    viewFullHistory: "සම්පූර්ණ ඉතිහාසය බලන්න",
    noInvoicesYet: "තවම බිල්පත් නිකුත් කර නොමැත",
    noInvoicesYetSubtitle: "නව විකුණුම් බිල්පතක් නිකුත් කිරීමට ඉහත 'නව බිල්පතක් සකසන්න' බොත්තම ඔබන්න.",
    invoiceNo: "බිල්පත් අංකය",
    customer: "පාරිභෝගිකයා",
    issuedAt: "නිකුත් කළ වේලාව",
    grandTotal: "මුළු මුදල",
    paidAmount: "ගෙවූ මුදල",
    balanceDue: "ඉතිරි මුදල",
    viewInvoice: "විස්තර බලන්න",

    // New Invoice Page
    salesInvoice: "විකුණුම් බිල්පත",
    newSalesInvoiceTitle: "නව විකුණුම් බිල්පතක් සකස් කිරීම",
    newSalesInvoiceSubtitle: "ද්‍රව්‍ය ප්‍රමාණ (ඝන මීටර්), ප්‍රවාහන ගාස්තු සහ ලැබුණු මුදල් ඇතුළත් කර ස්ථිරව සුරකින්න.",
    stepCustomer: "1. පාරිභෝගික විස්තර",
    stepCustomerSubtitle: "ලියාපදිංචි පාරිභෝගිකයෙකු තෝරන්න හෝ නව පාරිභෝගිකයෙකු ඇතුළත් කරන්න",
    searchCustomerPlaceholder: "පාරිභෝගික නම හෝ දුරකථන අංකයෙන් සොයන්න...",
    customerName: "පාරිභෝගිකයාගේ සම්පූර්ණ නම",
    customerPhone: "දුරකථන අංකය",
    deliveryLocation: "බෙදාහැරීමේ ස්ථානය / ලිපිනය",
    selectedCustomerBadge: "තෝරාගත් පාරිභෝගිකයා",
    changeCustomer: "වෙනස් කරන්න",
    newCustomerNotice: "නව පාරිභෝගිකයෙකු නම් බිල්පත නිකුත් කිරීමේදී ස්වයංක්‍රීයව ලියාපදිංචි වේ.",
    sellingPriceCategory: "විකුණුම් මිල කාණ්ඩය (වාහනය අනුව)",
    sellingPriceCategorySubtitle: "මෙම බිල්පත සඳහා ට්‍රැක්ටර් හෝ ටිපර් මිල කාණ්ඩය තෝරන්න (ප්‍රවාහන සේවාවට අදාළ නොවේ)",
    vehicleCategoryTractor: "ට්‍රැක්ටර් (Tractor)",
    vehicleCategoryTipper: "ටිපර් (Tipper)",
    unconfiguredPriceAlert: "තෝරාගත් වාහන කාණ්ඩය සඳහා මිල ගණන් තවම සකසා නොමැත. බිල්පත නිකුත් කළ නොහැක.",
    stepMaterials: "2. විකුණුම් ද්‍රව්‍ය තෝරාගැනීම",
    stepMaterialsSubtitle: "වාහන කාණ්ඩය අනුව නියමිත මිල ගණන් මත ඝන අඩි (ft³) ප්‍රමාණය ඇතුළත් කරන්න",
    serverLockedPrices: "පද්ධතියේ ස්ථිර මිල ගණන්",
    materialCol: "ද්‍රව්‍යය",
    quantityCol: "ප්‍රමාණය (ft³)",
    unitPriceCol: "ඒකක මිල (රු. / ft³)",
    lineTotalCol: "පේළියේ එකතුව",
    removeCol: "ඉවත් කරන්න",
    selectMaterialPlaceholder: "ද්‍රව්‍යය තෝරන්න...",
    addLineItem: "+ තවත් ද්‍රව්‍යයක් එක් කරන්න",
    stepTransport: "3. ප්‍රවාහන පහසුකම්",
    stepTransportSubtitle: "වැඩබිමට බෙදාහැරීම හෝ පාරිභෝගිකයා විසින් රැගෙන යාම තෝරන්න",
    withTransport: "ප්‍රවාහන සේවාව සහිතයි",
    withTransportSubtitle: "වැඩබිමට බෙදාහැරීම ඇතුළත් වේ",
    withoutTransport: "ප්‍රවාහනය රහිතයි",
    withoutTransportSubtitle: "පාරිභෝගිකයා විසින් රැගෙන යනු ලැබේ (රු. 0.00)",
    transportFeeLkr: "ප්‍රවාහන ගාස්තුව (රු.)",
    stepPayment: "4. ආරම්භක මුදල් ගෙවීම (Cash Payment)",
    stepPaymentSubtitle: "දැනට ලැබුණු මුදල් ඇතුළත් කරන්න (ණය බිල්පතක් නම් 0, නැතහොත් කොටසක් හෝ සම්පූර්ණ මුදල)",
    initialCashReceived: "ලැබුණු මුදල් ප්‍රමාණය (රු.)",
    creditInvoiceShortcut: "ණය බිල්පතක් (0)",
    fullPaymentShortcut: "සම්පූර්ණ ගෙවීම",
    summaryTitle: "බිල්පත් සාරාංශය",
    summarySubtitle: "බිල්පත සුරැකීමේදී නිල අංකය සහ ගණනය කිරීම් තහවුරු වේ",
    subtotalPreview: "ද්‍රව්‍ය එකතුව",
    transportFee: "ප්‍රවාහන ගාස්තුව",
    initialPaid: "දැනට ගෙවූ මුදල",
    saveAndIssueInvoice: "බිල්පත සුරකින්න සහ නිකුත් කරන්න",
    invoiceSavedSuccess: "බිල්පත සාර්ථකව පද්ධතියේ සුරැකිණි!",
    invoiceSavedSuccessSubtitle: "දැන් ඔබට නිල A5 බිල්පත මුද්‍රණය කළ හැකිය.",
    printA5Receipt: "A5 බිල්පත මුද්‍රණය කරන්න",
    createAnotherInvoice: "තවත් බිල්පතක් සකසන්න",
    returnToDashboard: "ප්‍රධාන පුවරුවට",

    // Invoice History Page
    invoiceHistoryTitle: "බිල්පත් ඉතිහාසය සහ මුදල් ලේඛනය",
    invoiceHistorySubtitle: "නිකුත් කරන ලද සියලුම ස්ථිර විකුණුම් බිල්පත් සහ මුදල් ගෙවීම් ලැයිස්තුව",
    searchInvoicesPlaceholder: "බිල්පත් අංකය, පාරිභෝගික නම, හෝ දුරකථනයෙන් සොයන්න...",
    filterAll: "සියලු තත්ත්වයන්",
    filterPaid: "සම්පූර්ණයෙන් ගෙවා ඇත",
    filterPartiallyPaid: "කොටසක් ගෙවා ඇත",
    filterUnpaid: "නොගෙවූ (ණය)",
    filterCancelled: "අවලංගු කළ",

    // Invoice Detail Page
    invoiceDetailTitle: "බිල්පත් විස්තර",
    backToInvoiceHistory: "← බිල්පත් ඉතිහාසයට",
    invoiceDetailsCard: "බිල්පත් වාණිජ සාරාංශය",
    customerInfoCard: "පාරිභෝගික සහ බෙදාහැරීමේ තොරතුරු",
    purchasedItemsCard: "මිලදී ගත් ද්‍රව්‍ය ලැයිස්තුව",
    paymentLedgerCard: "මුදල් ගෙවීම් ලේඛනය",
    recordPaymentBtn: "මුදල් ගෙවීමක් සටහන් කරන්න",
    printA5Btn: "A5 බිල්පත මුද්‍රණය කරන්න",
    printThermalBtn: "80mm රිසිට්පත මුද්‍රණය කරන්න",
    createAnotherBtn: "+ තවත් බිල්පතක් සකසන්න",
    issuedByLabel: "නිකුත් කළේ",
    totalLkr: "මුළු මුදල",
    paidLkr: "ගෙවූ මුදල",
    balanceLkr: "ඉතිරි මුදල",
    noPaymentsYet: "මෙම බිල්පත සඳහා තවම කිසිදු මුදල් ගෙවීමක් සටහන් කර නොමැත.",
    receiptNoCol: "රිසිට්පත් අංකය",
    paymentAmountCol: "ගෙවූ මුදල (රු.)",
    collectedByCol: "මුදල් භාරගත්තේ",
    paymentDateCol: "ගෙවූ දිනය",

    // Record Payment Modal
    recordCashPaymentTitle: "මුදල් ගෙවීමක් සටහන් කිරීම",
    recordPaymentSubtitle: "බිල්පත සඳහා ලැබුණු මුදල් ගෙවීම පද්ධතියට එක් කරන්න",
    paymentAmountLkr: "ගෙවන මුදල (රු.)",
    receiptNumberOptional: "රිසිට්පත් අංකය / විස්තරය (විකල්ප)",
    payFullBalanceBtn: "සම්පූර්ණ ඉතිරි මුදල",
    confirmPaymentBtn: "මුදල් ගෙවීම තහවුරු කරන්න",
    paymentRecordedSuccess: "මුදල් ගෙවීම සාර්ථකව සටහන් විය!",
    balancePaidInFull: "මෙම බිල්පතේ මුළු මුදල සම්පූර්ණයෙන් ගෙවා අවසන්.",

    // Daily Operations Page
    dailyOpsTitle: "දෛනික වැඩපොළ මෙහෙයුම්",
    dailyOpsSubtitle: "සේවක පැමිණීම, යන්ත්‍ර වැඩ පැය, සහ ලෝහ නිෂ්පාදන වාර්තා",
    tabAttendance: "සේවක පැමිණීම",
    tabMachineHours: "යන්ත්‍ර වැඩ පැය",
    tabProduction: "ලෝහ නිෂ්පාදනය",
    filterDateFrom: "සිට දිනය",
    filterDateTo: "දක්වා දිනය",
    filterStatus: "තත්ත්ව පෙරහන",
    workerCol: "සේවකයා",
    workDateCol: "වැඩ කළ දිනය",
    startTimeCol: "ආරම්භක වේලාව",
    endTimeCol: "අවසාන වේලාව",
    crossesMidnightCol: "මධ්‍යම රාත්‍රිය පසු වේ",
    breakMinsCol: "විවේකය (මිනි.)",
    hoursWorkedCol: "වැඩ පැය",
    overtimeHoursCol: "අතිකාල (OT) පැය",
    machineCol: "යන්ත්‍රය",
    operatorCol: "ක්‍රියාකරු / පැදවුම්කරු",
    downtimeMinsCol: "නැවතුම් කාලය (මිනි.)",
    downtimeReasonCol: "නැවතුමට හේතුව",
    producedMaterialCol: "නිෂ්පාදිත ලෝහ වර්ගය",
    volumeM3Col: "ප්‍රමාණය (m³)",
    shiftCol: "මුරය (Shift)",
    saveDraftBtn: "කෙටුම්පත සුරකින්න",
    submitForApprovalBtn: "අනුමැතියට ඉදිරිපත් කරන්න",
    cancelDraftBtn: "අවලංගු කරන්න",
    viewHistoryBtn: "ඉතිහාසය බලන්න",
    addNewRowBtn: "+ නව පේළියක් එක් කරන්න",
    noOperationsRecords: "තෝරාගත් දින පරාසය තුළ දෛනික වාර්තා හමු නොවීය.",
    returnReasonLabel: "ආපසු එවීමට හේතුව",
  },
};
