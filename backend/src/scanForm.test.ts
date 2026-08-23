import { describe, expect, it } from "vitest";
import {
  canonicalOption,
  codedFields,
  FORM_SECTIONS,
  optionKey,
  RETIRED_FIELDS,
} from "./formFields.js";
import { FORM_SCHEMA } from "./scanForm.js";

/**
 * The schema is generated from the field list, so these check the two can't
 * drift apart — and that the shape asked of the model is the shape the rest
 * of the app expects.
 */
describe("the extraction schema", () => {
  const schema = FORM_SCHEMA as {
    properties: Record<
      string,
      { properties: Record<string, { enum?: unknown[] }>; required: string[] }
    >;
    required: string[];
  };

  it("asks for every section on the paper form", () => {
    expect(schema.required.sort()).toEqual(FORM_SECTIONS.map((s) => s.key).sort());
  });

  it("offers a coded field exactly the options the form prints, plus null", () => {
    const ifis = schema.properties.biomicroscopia.properties.ifis;
    expect(ifis.enum).toEqual(["Ausente", "Suspeita", "Presente", null]);

    const nuclear = schema.properties.catarata.properties.nuclear;
    expect(nuclear.enum).toEqual(["Grau I", "Grau II", "Grau III", "Grau IV", null]);
  });

  /**
   * Null has to be reachable for every single field. This is handwriting:
   * a schema that forces a choice would make the model invent one, and an
   * invented "Sim" against a comorbidity is worse than a visible gap.
   */
  it("lets every coded field come back as null", () => {
    for (const { section, field } of codedFields()) {
      const property = schema.properties[section].properties[field.key];
      expect(property.enum, `${section}.${field.key}`).toContain(null);
    }
  });

  it("asks for both eyes where the form has a row per eye", () => {
    expect(schema.properties.avPio.required).toEqual(expect.arrayContaining(["od", "oe"]));
  });

  /**
   * The identity this app now reads off a page. The CPF is what a
   * consultation is later matched to an exam by; the date of birth is what
   * does it when there is no CPF.
   */
  it("carries the identifying fields", () => {
    const identity = schema.properties.identificacao.required;
    expect(identity).toContain("cpf");
    expect(identity).toContain("dataNascimento");
    expect(identity).toContain("paciente");
    // Recorded, but never matched on — the same patient can be issued a
    // different one on a later visit.
    expect(identity).toContain("prontuario");
  });

  /** The new form is checkboxes only; nothing opens a "qual?" line any more. */
  it("asks for no detail lines, because the paper no longer has any", () => {
    for (const section of FORM_SECTIONS) {
      for (const field of section.coded) {
        expect(field.detailFor, `${section.key}.${field.key}`).toBeUndefined();
      }
    }
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

  it("counts the cataract classification the new form added", () => {
    const keys = codedFields()
      .filter(({ section }) => section === "catarata")
      .map(({ field }) => field.key);
    expect(keys).toEqual(["nuclear", "cortical", "subcapsularPosterior", "outrasFormas"]);
  });

  it("gives every coded field at least two options to distinguish", () => {
    for (const { field } of codedFields()) {
      expect(field.options.length, field.key).toBeGreaterThan(1);
    }
  });

  it("keeps field keys unique within a section", () => {
    for (const section of FORM_SECTIONS) {
      const keys = [
        ...section.coded.map((f) => f.key),
        ...section.text.map((f) => f.key),
        ...(section.perEye ? ["od", "oe"] : []),
      ];
      expect(new Set(keys).size, section.key).toBe(keys.length);
    }
  });
});

describe("matching an answer to an option", () => {
  const ifis = FORM_SECTIONS.find((s) => s.key === "biomicroscopia")!.coded.find(
    (f) => f.key === "ifis",
  )!;
  const retina = FORM_SECTIONS.find((s) => s.key === "fundoscopia")!.coded.find(
    (f) => f.key === "mapeamentoRetina",
  )!;

  it("reads the form's own upper case back as the stored spelling", () => {
    expect(canonicalOption(ifis, "AUSENTE")).toBe("Ausente");
    expect(canonicalOption(ifis, "suspeita")).toBe("Suspeita");
  });

  it("forgives a dropped accent, which is how these get typed", () => {
    expect(canonicalOption(retina, "sem alteracoes")).toBe("Sem alterações");
    expect(optionKey("Não")).toBe(optionKey("NAO"));
  });

  /**
   * Statistics group by these strings. One stray spelling becomes a category
   * of its own that nobody notices, so anything that isn't an option is not
   * an answer.
   */
  it("refuses a word that isn't one of the options", () => {
    expect(canonicalOption(ifis, "provavel")).toBeUndefined();
    expect(canonicalOption(ifis, "")).toBeUndefined();
  });
});

/**
 * The clinic replaced its earlier Ficha de Triagem with this form. Fields it
 * dropped are out of the schema — there is nothing on the paper to read — but
 * consultations already stored still hold them, and they keep their labels so
 * a stored record can be shown in full.
 */
describe("fields the older form had", () => {
  it("keeps them out of the schema", () => {
    const asked = new Set(
      FORM_SECTIONS.flatMap((s) => [
        ...s.coded.map((f) => `${s.key}.${f.key}`),
        ...s.text.map((f) => `${s.key}.${f.key}`),
      ]),
    );
    for (const retired of RETIRED_FIELDS) {
      expect(asked.has(`${retired.section}.${retired.key}`), retired.key).toBe(false);
    }
  });

  it("still names the ones a stored consultation may hold", () => {
    const keys = RETIRED_FIELDS.map((f) => `${f.section}.${f.key}`);
    expect(keys).toContain("biomicroscopia.cristalino");
    expect(keys).toContain("hipoteseDiagnostica.texto");
    expect(keys).toContain("anamnese.queixaPrincipal");
    expect(RETIRED_FIELDS.every((f) => f.label.trim() !== "")).toBe(true);
  });
});
