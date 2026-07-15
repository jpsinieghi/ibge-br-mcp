import { beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../src/cache.js";
import { ibgeReligiaoMunicipiosLote } from "../src/tools/religiao-municipios-lote.js";

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
  variaveis: [{ id: 140 }, { id: 1000140 }, { id: 13495 }],
  classificacoes: [
    {
      id: 133,
      categorias: [{ id: 95278 }, { id: 95263 }, { id: 95277 }, { id: 2836 }],
    },
  ],
};

const header = {
  D1C: "Município (Código)",
  D1N: "Município",
  D2C: "Variável (Código)",
  D4C: "Religião (Código)",
  D5C: "Sexo (Código)",
  D6C: "Grupo de idade (Código)",
  V: "Valor",
};

function row(
  variavel: string,
  religiao: string,
  valor: string,
  codigo = "3509502",
  localidade = "Campinas (SP)"
) {
  return {
    D1C: codigo,
    D1N: localidade,
    D2C: variavel,
    D4C: religiao,
    D5C: "6794",
    D6C: "95253",
    V: valor,
  };
}

describe("ibge_religiao_municipios_lote", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    cache.clear();
  });

  it("retorna quantidade e percentual de católicos sobre a população de 10 anos ou mais", async () => {
    mockFetch
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(
        response([
          header,
          row("140", "95278", "1012969"),
          row("1000140", "95278", "100.00"),
          row("140", "95263", "510812"),
          row("1000140", "95263", "50.43"),
        ])
      );

    const result = await ibgeReligiaoMunicipiosLote({ municipios: ["3509502"] });
    const structured = result.structured as {
      parcial: boolean;
      itens: Array<{
        municipio: string;
        uf: string;
        populacao_10_anos_ou_mais: number;
        catolicos_10_anos_ou_mais: number;
        percentual_catolicos: number;
      }>;
    };

    expect(structured.parcial).toBe(false);
    expect(structured.itens[0]).toMatchObject({
      municipio: "Campinas",
      uf: "SP",
      populacao_10_anos_ou_mais: 1012969,
      catolicos_10_anos_ou_mais: 510812,
      percentual_catolicos: 50.43,
    });
    const sidraUrl = String(mockFetch.mock.calls[1][0]);
    expect(sidraUrl).toContain("/v/140,1000140/");
    expect(sidraUrl).not.toContain("13495");
  });

  it("aceita mais de um grupo e interpreta o símbolo SIDRA de zero absoluto", async () => {
    mockFetch
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(
        response([
          header,
          row("140", "95278", "1012969"),
          row("140", "95263", "510812"),
          row("1000140", "95263", "50.43"),
          row("140", "2836", "-"),
          row("1000140", "2836", "-"),
        ])
      );

    const result = await ibgeReligiaoMunicipiosLote({
      municipios: ["3509502", "3509502"],
      grupos_religiosos: ["catolica_apostolica_romana", "sem_religiao", "sem_religiao"],
    });
    const structured = result.structured as {
      total_solicitado: number;
      itens: Array<{ grupos: Array<{ grupo_religioso: string; pessoas_10_anos_ou_mais: number }> }>;
    };

    expect(structured.total_solicitado).toBe(1);
    expect(structured.itens[0].grupos).toHaveLength(2);
    expect(structured.itens[0].grupos[1]).toMatchObject({
      grupo_religioso: "sem_religiao",
      pessoas_10_anos_ou_mais: 0,
    });
  });

  it("separa corretamente os resultados de dois municípios na mesma consulta", async () => {
    mockFetch
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(
        response([
          header,
          row("140", "95278", "1012969"),
          row("140", "95263", "510812"),
          row("1000140", "95263", "50.43"),
          row("140", "95278", "460000", "4205407", "Florianópolis (SC)"),
          row("140", "95263", "230000", "4205407", "Florianópolis (SC)"),
          row("1000140", "95263", "50.00", "4205407", "Florianópolis (SC)"),
        ])
      );

    const result = await ibgeReligiaoMunicipiosLote({
      municipios: ["3509502", "4205407"],
    });
    const structured = result.structured as {
      parcial: boolean;
      total_retornado: number;
      itens: Array<{ codigo_ibge_municipio: string; percentual_catolicos: number }>;
    };

    expect(structured).toMatchObject({ parcial: false, total_retornado: 2 });
    expect(structured.itens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codigo_ibge_municipio: "3509502",
          percentual_catolicos: 50.43,
        }),
        expect.objectContaining({
          codigo_ibge_municipio: "4205407",
          percentual_catolicos: 50,
        }),
      ])
    );
  });

  it("não devolve resultado municipal quando falta o percentual oficial", async () => {
    mockFetch
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(
        response([header, row("140", "95278", "1012969"), row("140", "95263", "510812")])
      );

    const result = await ibgeReligiaoMunicipiosLote({ municipios: ["3509502"] });
    expect(result.structured).toMatchObject({ parcial: true, total_retornado: 0 });
  });
});
