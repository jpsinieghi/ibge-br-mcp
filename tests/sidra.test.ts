import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeSidra, listSidraTables } from "../src/tools/sidra.js";
import { cache } from "../src/cache.js";
import { mockResponse, sidraResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const popByUf = sidraResponse(
  { D1N: "Unidade da Federação", D2N: "Ano", V: "Valor" },
  { D1N: "São Paulo", D2N: "2022", V: "44411238" },
  { D1N: "Rio de Janeiro", D2N: "2022", V: "16055174" }
);

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

describe("ibge_sidra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the SIDRA path /t/{tabela}/n{nivel}/{loc}/v/{var}/p/{per}", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    await ibgeSidra({
      tabela: "6579",
      nivel_territorial: "3",
      localidades: "35,33",
      variaveis: "9324",
      periodos: "2022",
    });

    const url = lastUrl();
    expect(url).toContain("/t/6579");
    expect(url).toContain("/n3/35,33");
    expect(url).toContain("/v/9324");
    expect(url).toContain("/p/2022");
  });

  it("renders a Markdown table using the header row labels and known table name", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    const result = await ibgeSidra({ tabela: "6579", nivel_territorial: "3" });

    expect(result).toContain("SIDRA - Estimativas de população");
    expect(result).toContain("Unidade da Federação");
    expect(result).toContain("São Paulo");
    // value formatted with thousand separators
    expect(result).toContain("44.411.238");
  });

  it("returns raw JSON when formato='json'", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    const result = await ibgeSidra({ tabela: "6579", formato: "json" });

    expect(result.trim().startsWith("[")).toBe(true);
    expect(JSON.parse(result)).toHaveLength(popByUf.length);
  });

  it("appends classification path from 'id[categorias]'", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    await ibgeSidra({ tabela: "6579", classificacoes: "2[6794]" });

    expect(lastUrl()).toContain("/c2/6794");
  });

  it("rejects an invalid territorial level without calling the API", async () => {
    const result = await ibgeSidra({ tabela: "6579", nivel_territorial: "999" });

    expect(result).toContain("Nível territorial inválido");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects an invalid period without calling the API", async () => {
    const result = await ibgeSidra({ tabela: "6579", periodos: "não-é-período" });

    expect(result).toContain("periodos");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reports an empty result distinctly from a failure", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));

    const result = await ibgeSidra({ tabela: "6579" });

    expect(result).toContain("Nenhum dado encontrado");
    expect(result).not.toContain("Código HTTP");
  });

  it("handles a header-only response (no data rows)", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sidraResponse({ D1N: "UF", V: "Valor" })));

    const result = await ibgeSidra({ tabela: "6579" });

    expect(result).toContain("Nenhum dado encontrado para os filtros aplicados");
  });

  it("surfaces an upstream HTTP error with related tools", async () => {
    mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

    const result = await ibgeSidra({ tabela: "6579" });

    expect(result).toContain("Erro");
    expect(result).toContain("ibge_sidra_metadados");
  });
});

describe("listSidraTables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  it("queries the aggregates endpoint filtered by pesquisa and returns JSON", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([{ id: "6579", nome: "Estimativas" }]));

    const result = await listSidraTables("33");

    expect(lastUrl()).toContain("?pesquisa=33");
    expect(JSON.parse(result)[0].id).toBe("6579");
  });
});
