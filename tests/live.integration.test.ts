import { describe, expect, it } from "vitest";
import { ibgeCidades } from "../src/tools/cidades.js";
import { cache } from "../src/cache.js";

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
});
