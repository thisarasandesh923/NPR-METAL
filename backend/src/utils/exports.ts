import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export type ExportFormat = "csv" | "xlsx" | "pdf";

export interface ExportColumn {
  header: string;
  key: string;
  width?: number;
  align?: "left" | "right";
}

export interface TabularExportPayload {
  title: string;
  subtitle: string;
  filenameBase: string;
  columns: ExportColumn[];
  rows: Array<Record<string, string | number | null | undefined>>;
}

/**
 * Neutralizes CSV / Excel formula injection (DDE / spreadsheet macro attacks)
 * per OWASP guidance by prefixing dangerous leading characters with "'".
 */
export function sanitizeSpreadsheetValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (str.length === 0) {
    return "";
  }
  const trimmedLeading = str.replace(/^[\s\u00A0]+/, "");
  if (
    /^[=+\-@\t\r]/.test(str) ||
    /^[=+\-@\t\r]/.test(trimmedLeading)
  ) {
    return `'${str}`;
  }
  return str;
}

function escapeCsvCell(raw: string): string {
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function buildCsvBuffer(payload: TabularExportPayload): Buffer {
  const headerLine = payload.columns
    .map((c) => escapeCsvCell(sanitizeSpreadsheetValue(c.header)))
    .join(",");

  const dataLines = payload.rows.map((row) =>
    payload.columns
      .map((col) => escapeCsvCell(sanitizeSpreadsheetValue(row[col.key])))
      .join(",")
  );

  // Include UTF-8 BOM so Sri Lankan/Sinhala/Unicode symbols (e.g. m³, ×) render cleanly in Excel
  const csvContent = `\uFEFF${[headerLine, ...dataLines].join("\r\n")}\r\n`;
  return Buffer.from(csvContent, "utf8");
}

export async function buildXlsxBuffer(
  payload: TabularExportPayload
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NPR Metal Crusher System";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(payload.title.slice(0, 31) || "Report");

  sheet.addRow([sanitizeSpreadsheetValue(payload.title)]);
  sheet.addRow([sanitizeSpreadsheetValue(payload.subtitle)]);
  sheet.addRow([]);

  const headerRow = sheet.addRow(
    payload.columns.map((c) => sanitizeSpreadsheetValue(c.header))
  );
  headerRow.font = { bold: true };

  for (const row of payload.rows) {
    sheet.addRow(
      payload.columns.map((col) => sanitizeSpreadsheetValue(row[col.key]))
    );
  }

  payload.columns.forEach((col, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = col.width ?? Math.max(col.header.length + 4, 16);
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export async function buildPdfBuffer(
  payload: TabularExportPayload
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: payload.columns.length > 5 ? "landscape" : "portrait",
      margin: 36,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(15).fillColor("#092547").text("NPR METAL CRUSHER", {
      align: "left",
    });
    doc.fontSize(12).fillColor("#f58220").text(payload.title);
    doc.fontSize(9).fillColor("#475569").text(payload.subtitle);
    doc.moveDown(0.8);

    const usableWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colCount = Math.max(payload.columns.length, 1);
    const colWidth = usableWidth / colCount;

    const renderHeader = () => {
      const y = doc.y;
      doc.fontSize(8).fillColor("#092547");
      payload.columns.forEach((col, i) => {
        doc.text(col.header, doc.page.margins.left + i * colWidth, y, {
          width: colWidth - 4,
          ellipsis: true,
        });
      });
      doc.moveDown(0.5);
      doc
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .strokeColor("#cbd5e1")
        .stroke();
      doc.moveDown(0.4);
    };

    renderHeader();

    if (payload.rows.length === 0) {
      doc.fontSize(9).fillColor("#64748b").text("No matching records found for selected period.");
    } else {
      for (const row of payload.rows) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 30) {
          doc.addPage();
          renderHeader();
        }
        const rowY = doc.y;
        doc.fontSize(8).fillColor("#1e293b");
        let maxBottom = rowY + 12;
        payload.columns.forEach((col, i) => {
          const textVal =
            row[col.key] === null || row[col.key] === undefined
              ? ""
              : String(row[col.key]);
          doc.text(textVal, doc.page.margins.left + i * colWidth, rowY, {
            width: colWidth - 4,
            lineBreak: false,
            ellipsis: true,
          });
          if (doc.y > maxBottom) {
            maxBottom = doc.y;
          }
        });
        doc.y = maxBottom + 3;
      }
    }

    doc.end();
  });
}
