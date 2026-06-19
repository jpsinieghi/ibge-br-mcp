import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeCenso } from "../src/tools/censo.js";
import { ibgeIndicadores } from "../src/tools/indicadores.js";
import { ibgeDatasaude } from "../src/tools/datasaude.js";
import { cache } from "../src/cache.js";
import { mockResponse, sidraResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const sidraPop = sidraResponse(
  { D1N: "Unidade da Federação", D2N: "Ano", V: "Valor" },
  { D1N: "São Paulo", D2N: "2022", V: "44411238" }
);

describe("ibge_censo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats a census table for a known theme", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sidraPop));

    const result = await ibgeCenso({ tema: "populacao", nivel_territorial: "3" });

    expect(result).toContain("Censo Demográfico");
    expect(result).toContain("Tabela SIDRA:");
    expect(result).toContain("São Paulo");
    expect(result).toContain("44.411.238");
  });

  it("returns embedded JSON when formato='json'", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sidraPop));

    const result = await ibgeCenso({ tema: "populacao", formato: "json" });

    expect(result).toContain("```json");
    expect(result).toContain('"São Paulo"');
  });

  it("lists available tables for tema='listar' without calling the API", async () => {
    const result = await ibgeCenso({ tema: "listar" });

    expect(result).toContain("Tabelas do Censo");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("distinguishes an empty result from an upstream failure", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));

    const result = await ibgeCenso({ tema: "populacao" });

    expect(result).toContain("Nenhum dado encontrado");
    expect(result).not.toContain("Código HTTP");
  });

  it("surfaces an upstream error gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

    const result = await ibgeCenso({ tema: "populacao" });

    expect(result).toContain("Erro");
  });
});

describe("ibge_indicadores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists indicators when called with no indicator", async () => {
    const result = await ibgeIndicadores({});

    expect(result.length).toBeGreaterThan(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("formats a known indicator", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sidraPop));

    const result = await ibgeIndicadores({ indicador: "desemprego", nivel_territorial: "3" });

    expect(result).toContain("Tabela SIDRA:");
    expect(result).toContain("São Paulo");
  });

  it("returns embedded JSON when formato='json'", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sidraPop));

    const result = await ibgeIndicadores({
      indicador: "desemprego",
      nivel_territorial: "3",
      formato: "json",
    });

    expect(result).toContain("```json");
  });

  it("reports an unknown indicator without calling the API", async () => {
    const result = await ibgeIndicadores({ indicador: "inexistente-xyz" });

    expect(result).toContain("não encontrado");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reports 'no data' distinctly for a valid indicator with an empty response", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));

    const result = await ibgeIndicadores({ indicador: "desemprego", nivel_territorial: "3" });

    expect(result).toContain("Nenhum dado encontrado");
  });
});

describe("ibge_datasaude", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists health indicators for indicador='listar' without calling the API", async () => {
    const result = await ibgeDatasaude({ indicador: "listar" });

    expect(result).toContain("Indicadores de Saúde");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("formats a known health indicator", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sidraPop));

    const result = await ibgeDatasaude({ indicador: "esperanca_vida", nivel_territorial: "3" });

    expect(result).toContain("**Fonte:**");
    expect(result).toContain("São Paulo");
  });

  it("reports an unknown indicator without calling the API", async () => {
    const result = await ibgeDatasaude({ indicador: "inexistente-xyz" });

    expect(result).toContain("não encontrado");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("distinguishes an empty result from an upstream failure", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));

    const result = await ibgeDatasaude({ indicador: "esperanca_vida", nivel_territorial: "3" });

    expect(result).toContain("Nenhum dado encontrado");
    expect(result).not.toContain("Código HTTP");
  });

  it("surfaces an upstream error gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("HTTP 500: Internal Server Error"));

    const result = await ibgeDatasaude({ indicador: "esperanca_vida", nivel_territorial: "3" });

    expect(result).toContain("Erro");
  });
});
