import { useState } from "react";
import { DEMO_CONFIGURED_PRICES, INITIAL_DEMO_INVOICE_ITEMS } from "../../../data/demo/materials";
import { calculateInvoiceTotals } from "../../../utils/invoiceCalculator";
import type { MaterialName, MaterialRow } from "../../../types/invoice";

export function useInvoiceForm() {
  const [saved, setSaved] = useState(false);
  const [items, setItems] = useState<MaterialRow[]>(INITIAL_DEMO_INVOICE_ITEMS);
  const [withTransport, setWithTransport] = useState(true);
  const [transportFee, setTransportFee] = useState(7500);
  const [cashReceived, setCashReceived] = useState(109500);

  const totals = calculateInvoiceTotals(
    items,
    withTransport,
    transportFee,
    cashReceived
  );

  const updateMaterial = (id: number, material: MaterialName) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              material,
              price: DEMO_CONFIGURED_PRICES[material],
            }
          : item
      )
    );
  };

  const updateQuantity = (id: number, quantity: number) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, quantity: Math.max(0.01, quantity || 0) } : item
      )
    );
  };

  const addItem = () => {
    setItems((current) => [
      ...current,
      {
        id: Date.now(),
        material: '3/4"',
        quantity: 1,
        price: DEMO_CONFIGURED_PRICES['3/4"'],
      },
    ]);
  };

  const removeItem = (id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  };

  return {
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
  };
}
