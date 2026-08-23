import { parseXml, readCentralDirectory, readEntry } from "./zip.js";

/**
 * Just enough .xlsx to read a patient list.
 *
 * A spreadsheet is a ZIP of XML, read by the shared reader in zip.ts. What
 * comes back is a grid of strings; every question of *meaning* belongs to
 * patientList.ts, which is where it can be tested without a binary fixture.
 *
 * It reads the workbook's first sheet, resolved through the relationships
 * file rather than assumed to be `sheet1.xml`, so a workbook whose sheets
 * were reordered still gives the sheet a person sees first.
 */

/** A worksheet as rows of columns, both trimmed of trailing blanks. */
export type Grid = string[][];

/** Turns "BC12" into a zero-based column index. */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function sheetToGrid(sheet: Document, shared: string[]): Grid {
  const grid: Grid = [];
  for (const row of Array.from(sheet.getElementsByTagName("row"))) {
    const cells: string[] = [];
    for (const cell of Array.from(row.getElementsByTagName("c"))) {
      const index = columnIndex(cell.getAttribute("r") ?? "A");
      const type = cell.getAttribute("t");
      let value = "";
      if (type === "inlineStr") {
        value = Array.from(cell.getElementsByTagName("t"))
          .map((node) => node.textContent ?? "")
          .join("");
      } else {
        const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
        // A shared string is stored as its index into the workbook's table;
        // a number (or a date serial) is stored as itself.
        value = type === "s" ? (shared[Number(raw)] ?? "") : raw;
      }
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    grid.push(cells);
  }
  return grid;
}

export async function readSpreadsheet(file: File): Promise<Grid> {
  const data = new DataView(await file.arrayBuffer());
  const entries = readCentralDirectory(data);
  const find = (name: string) => entries.find((entry) => entry.name === name);

  const workbookEntry = find("xl/workbook.xml");
  if (!workbookEntry) throw new Error("That file isn't an Excel workbook.");

  const shared: string[] = [];
  const sharedEntry = find("xl/sharedStrings.xml");
  if (sharedEntry) {
    const doc = parseXml(await readEntry(data, sharedEntry));
    for (const si of Array.from(doc.getElementsByTagName("si"))) {
      shared.push(
        Array.from(si.getElementsByTagName("t"))
          .map((node) => node.textContent ?? "")
          .join(""),
      );
    }
  }

  // First sheet in the workbook's own order → its relationship id → its file.
  const workbook = parseXml(await readEntry(data, workbookEntry));
  const firstSheet = workbook.getElementsByTagName("sheet")[0];
  const relationshipId =
    firstSheet?.getAttribute("r:id") ?? firstSheet?.getAttributeNS(null, "id") ?? "";

  let sheetPath = "xl/worksheets/sheet1.xml";
  const relsEntry = find("xl/_rels/workbook.xml.rels");
  if (relsEntry && relationshipId) {
    const rels = parseXml(await readEntry(data, relsEntry));
    for (const rel of Array.from(rels.getElementsByTagName("Relationship"))) {
      if (rel.getAttribute("Id") !== relationshipId) continue;
      const target = rel.getAttribute("Target") ?? "";
      sheetPath = target.startsWith("/")
        ? target.slice(1)
        : `xl/${target.replace(/^\.\//, "")}`;
      break;
    }
  }

  const sheetEntry = find(sheetPath) ?? find("xl/worksheets/sheet1.xml");
  if (!sheetEntry) throw new Error("That workbook has no readable sheet.");

  return sheetToGrid(parseXml(await readEntry(data, sheetEntry)), shared);
}

/**
 * The same grid, from a CSV or TSV file. Brazilian Excel exports use `;` as
 * the separator (the comma being busy as a decimal point), so the separator
 * is detected rather than assumed.
 */
export function parseDelimited(text: string): Grid {
  const body = text.replace(/^﻿/, "");
  const firstLine = body.slice(0, body.indexOf("\n") + 1 || undefined);
  const separator = firstLine.includes("\t")
    ? "\t"
    : (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";

  const grid: Grid = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quoted) {
      if (char === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === separator) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      grid.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    grid.push(row);
  }
  return grid;
}

export function isSpreadsheetFile(file: File): boolean {
  return /\.(xlsx|csv|tsv|txt)$/i.test(file.name);
}
