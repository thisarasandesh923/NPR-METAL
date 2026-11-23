import { useCallback, useEffect, useState } from "react";
import { fetchMaterials, issueInvoiceRequest } from "../../../api/billing.ts";
import { ApiError } from "../../../api/client.ts";
import type {
  CreateInvoiceRequest,
  CustomerRecord,
  InvoiceDetail,
  MaterialCatalogItem,
  VehicleCategory,
} from "../../../types/billing.ts";
import { calculateInvoiceTotals } from "../../../utils/invoiceCalculator.ts";
import type { MaterialRow } from "../../../types/invoice.ts";
import type { CustomerDraft } from "../components/CustomerDetailsSection.tsx";
import type { InvoiceLineDraft } from "../components/MaterialItemsSection.tsx";

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `inv-${Date.now()}-${Math.random().toString(16).slice(2, 14)}`;
}

export function getMaterialVehiclePrice(
  mat: MaterialCatalogItem | undefined,
  category: VehicleCategory
): string | null {
  if (!mat) return null;
  if (category === "TRACTOR") {
    return mat.tractorPricePerFt3 ?? mat.vehiclePrices?.TRACTOR?.pricePerFt3 ?? null;
  }
  return mat.tipperPricePerFt3 ?? mat.vehiclePrices?.TIPPER?.pricePerFt3 ?? null;
}

export function useInvoiceForm() {
  const [materials, setMaterials] = useState<MaterialCatalogItem[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const [materialsError, setMaterialsError] = useState<string | null>(null);

  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerRecord | null>(null);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>({
    name: "",
    phone: "",
    location: "",
  });

  const [vehicleCategory, setVehicleCategory] =
    useState<VehicleCategory>("TRACTOR");
  const [items, setItems] = useState<InvoiceLineDraft[]>([]);
  const [withTransport, setWithTransport] = useState(false);
  const [transportFee, setTransportFee] = useState("0.00");
  const [cashReceived, setCashReceived] = useState("0.00");

  const [idempotencyKey, setIdempotencyKey] = useState(() => generateUuid());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [persistedInvoice, setPersistedInvoice] =
    useState<InvoiceDetail | null>(null);

  const loadMaterials = useCallback(async () => {
    setMaterialsLoading(true);
    setMaterialsError(null);
    try {
      const list = await fetchMaterials();
      setMaterials(list);
      if (list.length > 0) {
        setItems((prev) =>
          prev.length > 0
            ? prev
            : [{ rowKey: 1, materialId: list[0].id, quantity: "1.000" }]
        );
      }
    } catch (err) {
      setMaterialsError(
        err instanceof ApiError
          ? err.message
          : "Failed to load active materials catalogue."
      );
    } finally {
      setMaterialsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  const invalidateIdempotency = () => {
    setIdempotencyKey(generateUuid());
    setSubmitError(null);
  };

  const handleSelectCustomer = (customer: CustomerRecord | null) => {
    setSelectedCustomer(customer);
    invalidateIdempotency();
  };

  const handleChangeCustomerDraft = (next: CustomerDraft) => {
    setCustomerDraft(next);
    invalidateIdempotency();
  };

  const handleSelectVehicleCategory = (cat: VehicleCategory) => {
    setVehicleCategory(cat);
    invalidateIdempotency();
  };

  const updateMaterial = (rowKey: number, materialId: number) => {
    setItems((curr) =>
      curr.map((item) =>
        item.rowKey === rowKey ? { ...item, materialId } : item
      )
    );
    invalidateIdempotency();
  };

  const updateQuantity = (rowKey: number, quantity: string) => {
    setItems((curr) =>
      curr.map((item) =>
        item.rowKey === rowKey ? { ...item, quantity } : item
      )
    );
    invalidateIdempotency();
  };

  const addItem = () => {
    if (materials.length === 0) {
      return;
    }
    setItems((curr) => [
      ...curr,
      {
        rowKey: Date.now() + Math.floor(Math.random() * 1000),
        materialId: materials[0].id,
        quantity: "1.000",
      },
    ]);
    invalidateIdempotency();
  };

  const removeItem = (rowKey: number) => {
    setItems((curr) => curr.filter((item) => item.rowKey !== rowKey));
    invalidateIdempotency();
  };

  const handleToggleTransport = (enabled: boolean) => {
    setWithTransport(enabled);
    if (!enabled) {
      setTransportFee("0.00");
    }
    invalidateIdempotency();
  };

  const handleChangeTransportFee = (fee: string) => {
    setTransportFee(fee);
    invalidateIdempotency();
  };

  const handleChangeCashReceived = (amount: string) => {
    setCashReceived(amount);
    invalidateIdempotency();
  };

  const materialsById = new Map(materials.map((m) => [m.id, m]));
  const previewRows: MaterialRow[] = items.map((line) => {
    const mat = materialsById.get(line.materialId);
    const unitPriceStr = getMaterialVehiclePrice(mat, vehicleCategory);
    const unitPriceNum =
      unitPriceStr !== null && unitPriceStr !== undefined && unitPriceStr.trim() !== ""
        ? Number(unitPriceStr)
        : 0;
    return {
      id: line.rowKey,
      material: (mat?.name as MaterialRow["material"]) ?? '3/4"',
      quantity: Number(line.quantity) || 0,
      price: Number.isFinite(unitPriceNum) && unitPriceNum > 0 ? unitPriceNum : 0,
    };
  });

  const totals = calculateInvoiceTotals(
    previewRows,
    withTransport,
    withTransport ? Number(transportFee) || 0 : 0,
    Number(cashReceived) || 0
  );

  const unconfiguredItem = items.find((line) => {
    const mat = materialsById.get(line.materialId);
    const priceStr = getMaterialVehiclePrice(mat, vehicleCategory);
    return (
      priceStr === null ||
      priceStr === undefined ||
      priceStr.trim() === "" ||
      !Number.isFinite(Number(priceStr)) ||
      Number(priceStr) <= 0
    );
  });

  const unconfiguredMaterial = unconfiguredItem
    ? materialsById.get(unconfiguredItem.materialId)
    : null;
  const unconfiguredWarning = unconfiguredMaterial
    ? `Price for ${unconfiguredMaterial.name} is unconfigured for ${vehicleCategory}. Set price before issuing.`
    : null;

  const validateBeforeSave = (): string | null => {
    if (materials.length === 0) {
      return "Active material catalogue is empty.";
    }
    if (!selectedCustomer) {
      if (customerDraft.name.trim().length < 2) {
        return "Customer / Company Name must be at least 2 characters.";
      }
      if (customerDraft.phone.trim().length < 7) {
        return "Phone Number must be at least 7 characters.";
      }
      if (customerDraft.location.trim().length < 2) {
        return "Location / Delivery Address must be at least 2 characters.";
      }
    }
    if (items.length === 0) {
      return "At least one material item is required.";
    }
    for (let i = 0; i < items.length; i += 1) {
      const q = items[i].quantity.trim();
      if (!/^\d+(?:\.\d{1,3})?$/.test(q) || Number(q) <= 0) {
        return `Item #${i + 1} quantity must be greater than 0 (max 3 decimals).`;
      }
    }
    if (unconfiguredItem) {
      return `Price for ${unconfiguredMaterial?.name ?? "Material"} is unconfigured for ${vehicleCategory}. Set price before issuing.`;
    }
    if (withTransport) {
      const tf = transportFee.trim();
      if (!/^\d+(?:\.\d{1,2})?$/.test(tf)) {
        return "Transport fee must be a valid non-negative LKR amount.";
      }
    }
    const payTrimmed = cashReceived.trim() || "0.00";
    if (!/^\d+(?:\.\d{1,2})?$/.test(payTrimmed)) {
      return "Initial payment must be a valid non-negative LKR amount.";
    }
    if (totals.isOverpayment) {
      return "Initial cash received cannot exceed the grand total.";
    }
    return null;
  };

  const saveInvoice = async (): Promise<InvoiceDetail | null> => {
    if (isSubmitting) {
      return null;
    }

    const clientValidation = validateBeforeSave();
    if (clientValidation) {
      setSubmitError(clientValidation);
      return null;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const payload: CreateInvoiceRequest = {
        ...(selectedCustomer
          ? { customerId: selectedCustomer.id }
          : {
              customer: {
                name: customerDraft.name.trim(),
                phone: customerDraft.phone.trim(),
                location: customerDraft.location.trim(),
              },
            }),
        vehicleCategory,
        items: items.map((line) => ({
          materialId: line.materialId,
          quantity: line.quantity.trim(),
        })),
        hasTransport: withTransport,
        transportFee: withTransport ? transportFee.trim() || "0.00" : "0.00",
        initialPaymentAmount: cashReceived.trim() || "0.00",
        idempotencyKey,
      };

      const res = await issueInvoiceRequest(payload);
      setPersistedInvoice(res.invoice);
      return res.invoice;
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : "Failed to save invoice. You may retry safely without creating duplicates."
      );
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForNewInvoice = () => {
    setSelectedCustomer(null);
    setCustomerDraft({ name: "", phone: "", location: "" });
    setVehicleCategory("TRACTOR");
    setItems(
      materials.length > 0
        ? [{ rowKey: Date.now(), materialId: materials[0].id, quantity: "1.000" }]
        : []
    );
    setWithTransport(false);
    setTransportFee("0.00");
    setCashReceived("0.00");
    setPersistedInvoice(null);
    setSubmitError(null);
    setIdempotencyKey(generateUuid());
  };

  return {
    materials,
    materialsLoading,
    materialsError,
    reloadMaterials: loadMaterials,
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
    setPersistedInvoice,
    saveInvoice,
    resetForNewInvoice,
    unconfiguredItem,
    unconfiguredWarning,
    canSubmit:
      !materialsLoading &&
      materials.length > 0 &&
      !totals.isOverpayment &&
      !unconfiguredItem,
  };
}
