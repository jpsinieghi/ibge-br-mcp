import { beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../src/cache.js";
import { ibgePopulacaoFaixaEtariaMunicipiosLote } from "../src/tools/populacao-por-faixa-etaria-municipios-lote.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function response(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  } as Response;
}

const metadata = {
  classificacoes: [
    {
      id: 287,
      categorias: [
        { id: 100362, nome: "Total", nivel: 0 },
        { id: 6574, nome: "17 anos", nivel: 2 },
        { id: 6575, nome: "18 anos", nivel: 2 },
        { id: 6576, nome: "19 anos", nivel: 2 },
        { id: 6577, nome: "20 anos", nivel: 2 },
        { id: 6653, nome: "100 anos ou mais", nivel: 1 },
      ],
    },
  ],
};

const header = { D1C: "Município (Código)", D1N: "Município", D5C: "Idade", V: "Valor" };

describe("ibge_populacao_por_faixa_etaria_municipios_lote", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    cache.clear();
  });

  it("soma 18 anos ou mais e preserva total e proveniência", async () => {
    mockFetch
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(
        response([
          header,
          { D1C: "4205407", D1N: "Florianópolis (SC)", D5C: "100362", V: "537211" },
          { D1C: "4205407", D1N: "Florianópolis (SC)", D5C: "6575", V: "6000" },
          { D1C: "4205407", D1N: "Florianópolis (SC)", D5C: "6576", V: "6100" },
          { D1C: "4205407", D1N: "Florianópolis (SC)", D5C: "6577", V: "6200" },
          { D1C: "4205407", D1N: "Florianópolis (SC)", D5C: "6653", V: "80" },
        ])
      );

    const result = await ibgePopulacaoFaixaEtariaMunicipiosLote({
      municipios: ["4205407"],
      idade_minima: 18,
    });
    const structured = result.structured as {
      parcial: boolean;
      itens: Array<{
        municipio: string;
        uf: string;
        populacao_faixa_etaria: number;
        populacao_total: number;
        tabela_sidra: string;
      }>;
    };

    expect(structured.parcial).toBe(false);
    expect(structured.itens[0]).toMatchObject({
      municipio: "Florianópolis",
      uf: "SC",
      populacao_faixa_etaria: 18380,
      populacao_total: 537211,
      tabela_sidra: "9514",
    });
  });

  it("não devolve soma incompleta quando falta uma idade", async () => {
    mockFetch
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(
        response([
          header,
          { D1C: "4205407", D1N: "Florianópolis (SC)", D5C: "100362", V: "537211" },
          { D1C: "4205407", D1N: "Florianópolis (SC)", D5C: "6575", V: "6000" },
        ])
      );
    const result = await ibgePopulacaoFaixaEtariaMunicipiosLote({
      municipios: ["4205407"],
      idade_minima: 18,
    });
    expect(result.structured).toMatchObject({ parcial: true, total_retornado: 0 });
  });
});
