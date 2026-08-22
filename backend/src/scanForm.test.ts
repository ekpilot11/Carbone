import { describe, expect, it } from "vitest";
import { codedFields, detailKey, FORM_SECTIONS } from "./formFields.js";
import { FORM_SCHEMA } from "./scanForm.js";

/**
 * The schema is generated from the field list, so these check the two can't
 * drift apart — and that the shape asked of the model is the shape the rest
 * of the app expects.
 */
describe("the extraction schema", () => {
  const schema = FORM_SCHEMA as {
    properties: Record<string, { properties: Record<string, { enum?: unknown[] }>; required: string[] }>;
    required: string[];
  };

  it("asks for every section on the paper form", () => {
    expect(schema.required.sort()).toEqual(FORM_SECTIONS.map((s) => s.key).sort());
  });

  it("offers a coded field exactly the options the form prints, plus null", () => {
    const ifis = schema.properties.biomicroscopia.properties.ifis;
    expect(ifis.enum).toEqual(["ausente", "suspeita", "presente", null]);

    const dilatacao = schema.properties.biomicroscopia.properties.dilatacaoPupilar;
    expect(dilatacao.enum).toEqual(["boa", "regular", "insuficiente", null]);
  });

  /**
   * Null has to be reachable for every single field. This is handwriting:
   * a schema that forces a choice would make the model invent one, and an
   * invented "SIM" against a comorbidity is worse than a visible gap.
   */
  it("lets every coded field come back as null", () => {
    for (const { section, field } of codedFields()) {
      const property = schema.properties[section].properties[field.key];
      expect(property.enum, `${section}.${field.key}`).toContain(null);
    }
  });

  it("opens a detail line for the options that have one on paper", () => {
    expect(schema.properties.biomicroscopia.required).toContain(detailKey("cornea"));
    expect(schema.properties.anamnese.required).toContain(detailKey("cirurgiaOcularPrevia"));
    // ...and not for the ones that don't.
    expect(schema.properties.biomicroscopia.required).not.toContain(detailKey("ifis"));
  });

  it("asks for both eyes where the form has a row per eye", () => {
    expect(schema.properties.avPio.required).toEqual(expect.arrayContaining(["od", "oe"]));
    expect(schema.properties.refracao.required).toEqual(expect.arrayContaining(["od", "oe"]));
  });

  it("carries the prontuário, which everything else is matched by", () => {
    expect(schema.properties.identificacao.required).toContain("prontuario");
  });
});

describe("the field list the statistics will count", () => {
  it("includes the ones the clinic asked to filter on", () => {
    const keys = codedFields().map(({ field }) => field.key);
    expect(keys).toContain("dilatacaoPupilar");
    expect(keys).toContain("ifis");
    expect(keys).toContain("tansulosina");
    expect(keys).toContain("dm2");
  });

  it("gives every coded field at least two options to distinguish", () => {
    for (const { field } of codedFields()) {
      expect(field.options.length, field.key).toBeGreaterThan(1);
    }
  });

  it("keeps field keys unique within a section", () => {
    for (const section of FORM_SECTIONS) {
      const keys = [...section.coded.map((f) => f.key), ...section.text.map((f) => f.key)];
      expect(new Set(keys).size, section.key).toBe(keys.length);
    }
  });
});
