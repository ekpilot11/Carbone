import { describe, expect, it } from "vitest";
import {
  canonicalOption,
  codedFields,
  FORM_SECTIONS,
  optionKey,
  RETIRED_FIELDS,
} from "./formFields.js";
import { BIOMETRY_SCHEMA } from "./scan.js";
import { FORM_SCHEMA, validate } from "./scanForm.js";

/**
 * The schema is generated from the field list, so these check the two can't
 * drift apart — and that the shape asked of the model is the shape the rest
 * of the app expects.
 */
interface SchemaNode {
  type?: unknown;
  enum?: unknown[];
  anyOf?: SchemaNode[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  required?: string[];
  description?: string;
}

describe("the extraction schema", () => {
  const schema = FORM_SCHEMA as SchemaNode & {
    properties: Record<string, SchemaNode & { properties: Record<string, SchemaNode> }>;
    required: string[];
  };

  it("asks for every section on the paper form", () => {
    expect(schema.required.sort()).toEqual(FORM_SECTIONS.map((s) => s.key).sort());
  });

  /**
   * The options the paper prints, plus the two ways of saying nothing: no
   * box marked, and a box marked that can't be attributed. They are not the
   * same fact and the review screen shows them differently.
   */
  it("offers a coded field the form's options and every way of not answering", () => {
    const ifis = schema.properties.biomicroscopia.properties.ifis;
    expect(ifis.enum).toEqual(["Ausente", "Suspeita", "Presente", "", "?", "2+"]);

    const nuclear = schema.properties.catarata.properties.nuclear;
    expect(nuclear.enum).toEqual(["Grau I", "Grau II", "Grau III", "Grau IV", "", "?", "2+"]);
  });

  /**
   * "Nothing" has to be reachable for every single field. This is
   * handwriting: a schema that forces a choice would make the model invent
   * one, and an invented "Sim" against a comorbidity is worse than a
   * visible gap. It used to be `null`; the API's union limit made it an
   * empty string, and the guarantee is the same either way.
   */
  it("lets every coded field come back empty", () => {
    for (const { section, field } of codedFields()) {
      const property = schema.properties[section].properties[field.key];
      expect(property.enum, `${section}.${field.key}`).toContain("");
    }
  });

  it("keeps every field's description, which is what tells the model what it is", () => {
    for (const { section, field } of codedFields()) {
      const property = schema.properties[section].properties[field.key];
      expect(property.description, `${section}.${field.key}`).toContain(field.label);
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

/**
 * The rules the API enforces, restated where they can run without a key.
 *
 * This file once asserted the shape the code produced rather than the shape
 * the API accepts, and so passed while the schema was rejected outright.
 * Two rejections have been paid for so far, both discovered by the clinic:
 *
 *     Invalid schema: Enum value 'OD' does not match declared type
 *     '['string', 'null']'
 *
 *     Schemas contains too many parameters with union types (31 parameters
 *     with type arrays or anyOf) … limit: 16 parameters with unions
 *
 * Each is a rule below, run over **both** schemas this app sends. Nothing
 * here can send a schema anywhere, so these walk it instead — and every
 * future 400 belongs here too, rather than being found the same way again.
 */
describe.each([
  ["the form schema", FORM_SCHEMA],
  ["the biometry schema", BIOMETRY_SCHEMA],
])("%s is one the API will accept", (_name, subject) => {
  function walk(node: SchemaNode, path: string, visit: (node: SchemaNode, path: string) => void) {
    visit(node, path);
    for (const branch of node.anyOf ?? []) walk(branch, `${path}|anyOf`, visit);
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      walk(child, `${path}.${key}`, visit);
    }
    if (node.items) walk(node.items, `${path}[]`, visit);
  }

  const root = subject as SchemaNode;

  it("never puts an enum beside a union type", () => {
    walk(root, "", (node, path) => {
      if (node.enum === undefined) return;
      // The API validates each enum value against the declared type, and a
      // union type has nothing single to validate against.
      expect(
        Array.isArray(node.type),
        `${path} declares enum with type ${JSON.stringify(node.type)}`,
      ).toBe(false);
    });
  });

  it("gives every node either one type or an anyOf", () => {
    walk(root, "", (node, path) => {
      const declared =
        typeof node.type === "string" || Array.isArray(node.type) || Array.isArray(node.anyOf);
      expect(declared, `${path} declares no type at all`).toBe(true);
    });
  });

  /**
   * The limit that made the whole form optional-by-value rather than
   * optional-by-type. The API counts every parameter anywhere in the schema
   * whose type is a union — nested per-eye fields included — and refuses
   * above sixteen. The form has 31 optional fields, so no arrangement of
   * unions fits, which is why "not marked" is an empty string, not a null.
   */
  it("stays under the API's limit of 16 union-typed parameters", () => {
    const unions: string[] = [];
    walk(root, "", (node, path) => {
      if (Array.isArray(node.type) || Array.isArray(node.anyOf)) unions.push(path || "(root)");
    });
    expect(
      unions.length,
      `${unions.length} union-typed parameters (limit 16): ${unions.slice(0, 8).join(", ")}`,
    ).toBeLessThanOrEqual(16);
  });
});

/**
 * What the model sends back, turned into an answer or a gap.
 *
 * This is the guarantee the whole review screen rests on, and the API's
 * union limit moved it: "nothing here" used to arrive as `null` and now
 * arrives as an empty string. The behaviour either side of that change has
 * to be identical, because a box the model could not read must never look
 * like a box nobody ticked.
 */
describe("reading the model's answer", () => {
  /** A half-filled form, exactly as the schema now asks for it. */
  const ANSWER = {
    identificacao: {
      paciente: "DJALMA SANTOS FERNANDES LEME",
      prontuario: "196752",
      dataNascimento: "08/12/1954",
      idade: "",
      cpf: "735.347.498-04",
    },
    anamnese: { olhoAcometido: "AO", usoOculos: "NÃO", cirurgiaOcularPrevia: "" },
    comorbidades: { dm2: "SIM", has: "SIM", glaucoma: "NÃO", tansulosina: "", outrasComorbidades: "" },
    avPio: { od: { sc: "20/80", cc: "", pio: "14" }, oe: { sc: "20/100", cc: "", pio: "14" } },
    biomicroscopia: {
      palpebrasCilios: "NORMAL",
      conjuntivaEsclera: "",
      cornea: "",
      camaraAnterior: "",
      ifis: "AUSENTE",
      dilatacaoPupilar: "BOA",
    },
    catarata: { nuclear: "GRAU III", cortical: "", subcapsularPosterior: "", outrasFormas: "" },
    fundoscopia: { mapeamentoRetina: "SEM ALTERAÇÕES", outroAchado: "" },
  };

  /** `form` is section → field → value; the test wants to reach into it. */
  const read = (parsed: unknown) => {
    const { form, unread, ambiguous } = validate(parsed);
    return { form: form as Record<string, Record<string, never>>, unread, ambiguous };
  };

  it("keeps what was answered, in the app's own spelling", () => {
    const { form } = read(ANSWER);
    expect(form.identificacao).toMatchObject({
      paciente: "DJALMA SANTOS FERNANDES LEME",
      cpf: "735.347.498-04",
    });
    // The paper prints "SIM" and "NÃO"; the app stores "Sim" and "Não".
    expect(form.comorbidades).toMatchObject({ dm2: "Sim", has: "Sim", glaucoma: "Não" });
    expect(form.catarata).toMatchObject({ nuclear: "Grau III" });
    expect(form.avPio.od).toEqual({ sc: "20/80", pio: "14" });
  });

  /**
   * The bug the clinic hit: a real form is mostly blank, and every blank
   * arrived carrying a *not read* tag. A tag on almost every field is the
   * same as no tag at all — the ones that genuinely need checking vanish
   * into the crowd.
   */
  it("treats a blank field as blank, not as something it failed to read", () => {
    const { form, unread } = read(ANSWER);
    for (const path of [
      "identificacao.idade",
      "anamnese.cirurgiaOcularPrevia",
      "comorbidades.tansulosina",
      "catarata.cortical",
      "biomicroscopia.cornea",
      "fundoscopia.outroAchado",
      "avPio.od.cc",
      "avPio.oe.cc",
    ]) {
      expect(unread, path).not.toContain(path);
    }
    // Blank all the same: nothing was stored as if it had been read.
    expect(form.comorbidades.tansulosina).toBeUndefined();
    expect(form.catarata.cortical).toBeUndefined();
    expect(form.avPio.od).not.toHaveProperty("cc");
  });

  /** The one thing that still earns the tag. */
  it("flags a field the model marked unreadable", () => {
    const { form, unread } = read({
      ...ANSWER,
      identificacao: { ...ANSWER.identificacao, cpf: "?" },
      biomicroscopia: { ...ANSWER.biomicroscopia, ifis: "?" },
      avPio: { ...ANSWER.avPio, od: { ...ANSWER.avPio.od, pio: "?" } },
    });
    expect(unread).toContain("identificacao.cpf");
    expect(unread).toContain("biomicroscopia.ifis");
    expect(unread).toContain("avPio.od.pio");
    // Never stored as the literal "?" — that would be a value, not a gap.
    expect(form.identificacao.cpf).toBeUndefined();
    expect(form.biomicroscopia.ifis).toBeUndefined();
  });

  /** A tag has to be rare to mean anything; this form earns exactly one. */
  it("keeps the tag rare on an ordinary form", () => {
    const { unread } = read({
      ...ANSWER,
      identificacao: { ...ANSWER.identificacao, cpf: "?" },
    });
    expect(unread).toEqual(["identificacao.cpf"]);
  });

  /**
   * Not the same as a form full of empty strings: the model said nothing at
   * all. The schema requires every field, so an answer missing all of them
   * is malformed, and "we never heard about this" is not evidence that the
   * paper is empty.
   */
  it("reports an answer that omits every field as unread, not as blank", () => {
    const { form, unread } = read({});
    expect(unread.length).toBeGreaterThan(25);
    for (const section of Object.values(form)) {
      for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
        // Per-eye groups are objects; every other stored value must be absent.
        if (key === "od" || key === "oe") expect(value).toEqual({});
        else expect(value).toBeUndefined();
      }
    }
  });

  /**
   * Two boxes ticked is not a reading failure — it is the paper
   * contradicting itself, and only the examiner can say which mark was
   * meant. It is asked as its own question rather than buried among the
   * fields nobody could read.
   */
  it("asks about a line with more than one box ticked", () => {
    const { form, unread, ambiguous } = read({
      ...ANSWER,
      comorbidades: { ...ANSWER.comorbidades, dm2: "2+" },
    });
    expect(ambiguous).toEqual(["comorbidades.dm2"]);
    // Not confused with a field nobody could read: different question,
    // different remedy.
    expect(unread).not.toContain("comorbidades.dm2");
    // And never resolved by picking one of them.
    expect(form.comorbidades.dm2).toBeUndefined();
  });

  it("keeps the three outcomes apart on one form", () => {
    const { unread, ambiguous } = read({
      ...ANSWER,
      comorbidades: { ...ANSWER.comorbidades, dm2: "2+", glaucoma: "?", has: "" },
    });
    expect(ambiguous).toEqual(["comorbidades.dm2"]);
    expect(unread).toEqual(["comorbidades.glaucoma"]);
    // "has" was blank: an answer, and no question at all.
  });

  /** One stray spelling would become a statistics category of its own. */
  it("drops an answer that isn't one of the form's options", () => {
    const { form, unread } = read({ biomicroscopia: { ifis: "provavelmente" } });
    expect(form.biomicroscopia.ifis).toBeUndefined();
    expect(unread).toContain("biomicroscopia.ifis");
  });
});
