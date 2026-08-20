// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readSpreadsheet } from "./xlsx";
import { readPatientList } from "./patientList";

/**
 * The reader is exercised against a workbook built here rather than a
 * committed .xlsx — the clinic's real list is full of patient names and has
 * no business in a repository.
 *
 * ZIP entries are written *stored* (uncompressed), which the reader supports
 * and which keeps this fixture free of any compression library. The CRC
 * fields are left zero: nothing reads them.
 */
function zip(files: { name: string; content: string }[]): File {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, name.length, true);
    const headerBytes = new Uint8Array(header.buffer);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(6, 20, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);

    local.push(headerBytes, name, data);
    central.push(new Uint8Array(entry.buffer), name);
    offset += headerBytes.length + name.length + data.length;
  }

  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new File([...local, ...central, new Uint8Array(end.buffer)] as BlobPart[], "list.xlsx");
}

/** Two sheets, deliberately in an order where "first" and "sheet1.xml" differ. */
function workbook(): File {
  return zip([
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Lista" sheetId="2" r:id="rId7"/><sheet name="Observações" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0"?><Relationships>
        <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId7" Target="worksheets/sheet9.xml"/></Relationships>`,
    },
    {
      name: "xl/sharedStrings.xml",
      content: `<?xml version="1.0"?><sst><si><t>Paciente</t></si><si><t>Olho</t></si><si><t>ANA SOUZA</t></si><si><t>OD</t></si><si><t>22,16</t></si></sst>`,
    },
    {
      // The wrong sheet: it must not be the one read.
      name: "xl/worksheets/sheet1.xml",
      content: `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Observações</t></is></c></row></sheetData></worksheet>`,
    },
    {
      name: "xl/worksheets/sheet9.xml",
      content: `<?xml version="1.0"?><worksheet><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>AXL</t></is></c><c r="D1" t="inlineStr"><is><t>K1</t></is></c><c r="E1" t="inlineStr"><is><t>K2</t></is></c><c r="F1" t="inlineStr"><is><t>ACD</t></is></c></row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c><c r="D2"><v>44.6</v></c><c r="E2"><v>45.15</v></c><c r="F2"><v>2.89</v></c></row>
      </sheetData></worksheet>`,
    },
  ]);
}

describe("reading an .xlsx without a spreadsheet library", () => {
  it("reads the sheet the workbook lists first, not the file named sheet1", async () => {
    const grid = await readSpreadsheet(workbook());
    expect(grid[0]).toEqual(["Paciente", "Olho", "AXL", "K1", "K2", "ACD"]);
    expect(grid[1][0]).toBe("ANA SOUZA");
  });

  it("resolves shared strings, inline strings and bare numbers alike", async () => {
    const list = readPatientList(await readSpreadsheet(workbook()));
    expect(list.patients).toHaveLength(1);
    const eye = list.patients[0].rows.OD;
    // "22,16" arrived as a shared string with a comma; the K values arrived
    // as plain numbers with a point. Both end up as the same kind of value.
    expect(eye.axialLength).toBe("22.16");
    expect(eye.k1).toBe("44.60");
    expect(eye.k2).toBe("45.15");
    expect(eye.acd).toBe("2.89");
  });

  it("refuses a file that isn't a workbook, rather than reading nonsense", async () => {
    await expect(readSpreadsheet(new File(["not a zip"], "x.xlsx"))).rejects.toThrow();
  });
});
