import "./domSetup.ts";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { App } from "../App.tsx";
import { translations } from "../i18n/translations.ts";
import type { MaterialCatalogItem } from "../types/billing.ts";

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe("Cashier Sinhala UI Localization & Language Switcher — Frontend Tests", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("verifies Sinhala dictionary completeness and natural Sri Lankan business terminology", () => {
    const si = translations.si;
    const en = translations.en;

    // Check that all keys are translated and non-empty
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      assert.ok(si[key], `Missing Sinhala translation for key: ${key}`);
      assert.ok(si[key].trim().length > 0, `Empty Sinhala translation for key: ${key}`);
    }

    // Verify critical Sri Lankan aggregate crushing & billing terminology
    assert.equal(si.navCashierDashboard, "ප්‍රධාන පුවරුව");
    assert.equal(si.navNewInvoice, "නව බිල්පත");
    assert.equal(si.navInvoiceHistory, "බිල්පත් ඉතිහාසය");
    assert.equal(si.navDailyOperations, "දෛනික මෙහෙයුම්");
    assert.equal(si.tabAttendance, "සේවක පැමිණීම");
    assert.equal(si.tabMachineHours, "යන්ත්‍ර වැඩ පැය");
    assert.equal(si.tabProduction, "ලෝහ නිෂ්පාදනය");
    assert.equal(si.statusPaid, "සම්පූර්ණයෙන් ගෙවා ඇත");
    assert.equal(si.statusPartiallyPaid, "කොටසක් ගෙවා ඇත");
    assert.equal(si.statusUnpaid, "නොගෙවූ (ණය)");
    assert.equal(si.statusSubmitted, "අනුමැතියට යොමු කළා");
    assert.equal(si.statusApproved, "අනුමතයි");
    assert.equal(si.statusReturned, "සංශෝධනයට ආපසු එවූ");
    assert.equal(si.roleCashier, "මුදල් අයකැමි");
    assert.equal(si.roleOwner, "හිමිකරු");
  });

  it("renders CASHIER role in natural Sinhala by default without explicit user configuration", async () => {
    const materials: MaterialCatalogItem[] = [
      { id: 1, code: "3/4", name: '3/4"', unit: "m³", currentUnitPrice: "12000.00", isActive: true },
      { id: 2, code: "DUST", name: "Dust", unit: "m³", currentUnitPrice: "8500.00", isActive: true },
    ];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/auth/me") {
        return jsonResponse(200, {
          success: true,
          data: {
            user: {
              id: "c-101",
              username: "cashier1",
              fullName: "Sunil Shantha",
              role: "CASHIER",
            },
          },
        });
      }
      if (url.startsWith("/api/invoices")) {
        return jsonResponse(200, {
          success: true,
          data: { invoices: [] },
        });
      }
      if (url.startsWith("/api/materials")) {
        return jsonResponse(200, {
          success: true,
          data: { materials },
        });
      }
      return jsonResponse(404, { success: false, error: { message: "Not found" } });
    }) as typeof fetch;

    const container = document.getElementById("root")!;
    container.innerHTML = "";

    await act(async () => {
      const root = (await import("react-dom/client")).createRoot(container);
      root.render(React.createElement(App));
    });
    await act(async () => {
      await flush();
      await flush();
    });

    const renderedText = container.textContent ?? "";

    // 1. Check Cashier shell is rendered in natural Sinhala
    assert.match(renderedText, /මුදල් අයකැමි පුවරුව/);
    assert.match(renderedText, /ආයුබෝවන්, Sunil!/);
    assert.match(renderedText, /නව බිල්පතක් සකසන්න/);
    assert.match(renderedText, /බිල්පත් ඉතිහාසය සහ ගෙවීම්/);
    assert.match(renderedText, /මෑතකදී නිකුත් කළ බිල්පත්/);
    assert.match(renderedText, /තවම බිල්පත් නිකුත් කර නොමැත/);
    assert.match(renderedText, /පද්ධතියෙන් ඉවත් වන්න/);

    // 2. Language switcher pill displays current language (සිංහල) and option to toggle to English
    assert.match(renderedText, /🇱🇰 සිංහල/);
    assert.match(renderedText, /⇄ EN/);

    // 3. Test dynamic language toggle to English
    const toggleBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("🇱🇰 සිංහල")
    );
    assert.ok(toggleBtn, "Language toggle button must be present in header");

    await act(async () => {
      toggleBtn.click();
      await flush();
    });

    const englishText = container.textContent ?? "";
    assert.match(englishText, /Cashier Dashboard/);
    assert.match(englishText, /Welcome, Sunil!/);
    assert.match(englishText, /Create New Invoice/);
    assert.match(englishText, /🇬🇧 English/);
    assert.match(englishText, /⇄ සිං/);

    // 4. Test toggling back to Sinhala
    const toggleBackBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("🇬🇧 English")
    );
    assert.ok(toggleBackBtn, "Toggle back button must be present");

    await act(async () => {
      toggleBackBtn.click();
      await flush();
    });

    const revertedText = container.textContent ?? "";
    assert.match(revertedText, /මුදල් අයකැමි පුවරුව/);
  });
});
