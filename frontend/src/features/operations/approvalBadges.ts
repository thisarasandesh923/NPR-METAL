import type { OperationalApprovalStatus } from "../../types/operations.ts";

export function getApprovalStatusBadgeClasses(
  status: OperationalApprovalStatus
): string {
  switch (status) {
    case "APPROVED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "SUBMITTED":
      return "border-blue-200 bg-blue-50 text-blue-800";
    case "RETURNED_FOR_CORRECTION":
      return "border-amber-300 bg-amber-50 text-amber-900";
    case "CANCELLED":
      return "border-slate-200 bg-slate-100 text-slate-500";
    default:
      return "border-slate-300 bg-white text-slate-700";
  }
}

export function formatApprovalStatusLabel(
  status: OperationalApprovalStatus,
  language: "en" | "si" = "en"
): string {
  if (language === "si") {
    switch (status) {
      case "RETURNED_FOR_CORRECTION":
        return "සංශෝධනයට ආපසු එවූ";
      case "SUBMITTED":
        return "අනුමැතියට යොමු කළා";
      case "APPROVED":
        return "අනුමතයි";
      case "CANCELLED":
        return "අවලංගුයි";
      default:
        return "කෙටුම්පත";
    }
  }
  switch (status) {
    case "RETURNED_FOR_CORRECTION":
      return "Returned for Correction";
    case "SUBMITTED":
      return "Pending Approval";
    case "APPROVED":
      return "Approved";
    case "CANCELLED":
      return "Cancelled";
    default:
      return "Draft";
  }
}
