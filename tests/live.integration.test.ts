import { describe, expect, it } from "vitest";
import { ibgeCidades } from "../src/tools/cidades.js";
import { cache } from "../src/cache.js";
import { ibgeResolverMunicipiosLote } from "../src/tools/resolver-municipios-lote.js";
import { ibgeCidadesLote } from "../src/tools/cidades-lote.js";
import { ibgePopulacaoFaixaEtariaMunicipiosLote } from "../src/tools/populacao-por-faixa-etaria-municipios-lote.js";
import { ibgeReligiaoMunicipiosLote } from "../src/tools/religiao-municipios-lote.js";

const live = process.env.RUN_IBGE_LIVE_TESTS === "1" ? describe : describe.skip;

live("IBGE live smoke tests", () => {
  it("obtém população de Florianópolis com valor numérico e ano", async () => {
    cache.clear();
    const result = await ibgeCidades({
      tipo: "indicador",
      municipio: "4205407",
      indicador: "populacao",
    });
    expect(result.isError).not.toBe(true);
    const indicadores = result.structured?.indicadores as Array<{
      valor_numerico: number;
      ano: string;
    }>;
    expect(indicadores[0].valor_numerico).toBeGreaterThan(0);
    expect(indicadores[0].ano).toMatch(/^\d{4}$/);
  });

  it("rejeita IDH nacional como se fosse indicador municipal", async () => {
    cache.clear();
    const result = await ibgeCidades({
      tipo: "indicador",
      municipio: "3548807",
      indicador: "idh",
    });
    expect(result.structured?.indicadores).toEqual([]);
    expect(result.markdown).toContain("série nacional");
  });

  it("resolve município e UF contra o catálogo oficial completo", async () => {
    cache.clear();
    const result = await ibgeResolverMunicipiosLote({
      municipios: [{ municipio: "Florianopolis", uf: "SC" }],
    });
    const resultados = result.structured?.resultados as Array<{
      codigo_ibge_municipio: string;
      status: string;
    }>;
    expect(resultados[0]).toMatchObject({
      codigo_ibge_municipio: "4205407",
      status: "exato",
    });
  });

  it("consulta dois municípios em uma única requisição batch por indicador", async () => {
    cache.clear();
    const result = await ibgeCidadesLote({
      municipios: ["3550308", "3304557"],
      indicadores: ["populacao"],
    });
    const structured = result.structured as { total_retornado: number; parcial: boolean };
    expect(structured.total_retornado).toBe(2);
    expect(structured.parcial).toBe(false);
  });

  it("calcula população de 18 anos ou mais para município via SIDRA", async () => {
    cache.clear();
    const result = await ibgePopulacaoFaixaEtariaMunicipiosLote({
      municipios: ["4205407"],
      idade_minima: 18,
    });
    expect(result.isError).not.toBe(true);
    const itens = result.structured?.itens as Array<{
      populacao_faixa_etaria: number;
      populacao_total: number;
      ano: string;
    }>;
    expect(itens[0].populacao_faixa_etaria).toBeGreaterThan(0);
    expect(itens[0].populacao_faixa_etaria).toBeLessThan(itens[0].populacao_total);
    expect(itens[0].ano).toBe("2022");
  });

  it("consulta percentual católico municipal com denominador de 10 anos ou mais", async () => {
    cache.clear();
    const result = await ibgeReligiaoMunicipiosLote({ municipios: ["3509502"] });
    expect(result.isError).not.toBe(true);
    const itens = result.structured?.itens as Array<{
      populacao_10_anos_ou_mais: number;
      catolicos_10_anos_ou_mais: number;
      percentual_catolicos: number;
      ano: string;
    }>;
    expect(itens[0].populacao_10_anos_ou_mais).toBeGreaterThan(0);
    expect(itens[0].catolicos_10_anos_ou_mais).toBeGreaterThan(0);
    expect(itens[0].percentual_catolicos).toBeGreaterThan(0);
    expect(itens[0].percentual_catolicos).toBeLessThanOrEqual(100);
    expect(itens[0].ano).toBe("2022");
  });
});
