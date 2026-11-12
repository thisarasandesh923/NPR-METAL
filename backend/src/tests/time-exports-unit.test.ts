import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCsvBuffer,
  buildPdfBuffer,
  buildXlsxBuffer,
  sanitizeSpreadsheetValue,
  type TabularExportPayload,
} from "../utils/exports.js";
import {
  computeIntervalSpanMinutes,
  minutesToDecimalHours,
  normalizeTimeString,
  parseTimeToMinutes,
  rangesOverlap,
  toAbsoluteMinuteRange,
} from "../utils/time.js";

describe("Operations Time Utilities — Unit Tests", () => {
  it("parses, normalizes, and handles same-day and overnight shifts", () => {
    assert.equal(parseTimeToMinutes("08:05", "Start"), 485);
    assert.equal(normalizeTimeString("08:05:30", "Start"), "08:05:00");
    assert.equal(computeIntervalSpanMinutes("08:00", "17:30", false), 570);
    assert.equal(computeIntervalSpanMinutes("22:00", "06:00", true), 480);
    assert.equal(minutesToDecimalHours(510), "8.50");
  });

  it("detects overlapping shifts including across midnight", () => {
    const overnight = toAbsoluteMinuteRange("2026-11-10", "22:00", "06:00", true);
    const nextMorningOverlap = toAbsoluteMinuteRange("2026-11-11", "05:30", "12:00", false);
    const nextMorningClear = toAbsoluteMinuteRange("2026-11-11", "06:00", "14:00", false);

    assert.equal(rangesOverlap(overnight, nextMorningOverlap), true);
    assert.equal(rangesOverlap(overnight, nextMorningClear), false);
  });
});

describe("Report Export Utilities — Formula Injection & Binary Formats", () => {
  const samplePayload: TabularExportPayload = {
    title: "Test Export",
    subtitle: "2026-11-01 to 2026-11-12",
    filenameBase: "test-export",
    columns: [
      { key: "name", header: "Customer" },
      { key: "amount", header: "Amount (LKR)", align: "right" },
    ],
    rows: [
      { name: "=CMD|' /C calc'!A0", amount: "12000.00" },
      { name: "+SUM(A1:A2)", amount: "500.00" },
      { name: "  -2+3", amount: "100.00" },
      { name: "@HYPERLINK", amount: "50.00" },
    ],
  };

  it("neutralizes dangerous leading characters in spreadsheets", () => {
    assert.equal(sanitizeSpreadsheetValue("=1+1"), "'=1+1");
    assert.equal(sanitizeSpreadsheetValue("+cmd"), "'+cmd");
    assert.equal(sanitizeSpreadsheetValue("  -alert"), "'  -alert");
    assert.equal(sanitizeSpreadsheetValue("@evil"), "'@evil");
    assert.equal(sanitizeSpreadsheetValue("Safe Customer"), "Safe Customer");
  });

  it("builds BOM UTF-8 CSV, valid XLSX (PK), and valid PDF (%PDF-)", async () => {
    const csv = buildCsvBuffer(samplePayload).toString("utf8");
    assert.ok(csv.startsWith("\uFEFF"));
    assert.ok(csv.includes("'=CMD"));
    assert.ok(csv.includes("'+SUM"));
    assert.ok(csv.includes("'@HYPERLINK"));

    const xlsx = await buildXlsxBuffer(samplePayload);
    assert.equal(xlsx.subarray(0, 2).toString("utf8"), "PK");

    const pdf = await buildPdfBuffer(samplePayload);
    assert.equal(pdf.subarray(0, 5).toString("utf8"), "%PDF-");
  });
});
