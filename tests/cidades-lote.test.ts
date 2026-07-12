import { beforeEach, describe, expect, it, vi } from "vitest";
import { ibgeCidadesLote } from "../src/tools/cidades-lote.js";
import { cache } from "../src/cache.js";

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

function serie(valor: string) {
  return [{ res: [{ res: { "2022": valor } }] }];
}

describe("ibge_cidades_lote", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    cache.clear();
  });

  it("preserva valor numérico, unidade e ano", async () => {
    mockFetch.mockResolvedValueOnce(response(serie("1521.11")));
    const result = await ibgeCidadesLote({
      municipios: ["3548807"],
      indicadores: ["pib_per_capita"],
    });
    const structured = result.structured as {
      parcial: boolean;
      itens: Array<{ valor_numerico: number; unidade: string; ano: string }>;
    };
    expect(structured.parcial).toBe(false);
    expect(structured.itens[0]).toMatchObject({
      valor_numerico: 1521.11,
      unidade: "R$",
      ano: "2022",
    });
  });

  it("retorna falhas parciais sem perder os sucessos", async () => {
    mockFetch
      .mockResolvedValueOnce(response(serie("587486")))
      .mockRejectedValueOnce(new Error("upstream indisponível"));
    const result = await ibgeCidadesLote({
      municipios: ["4205407", "3548807"],
      indicadores: ["populacao"],
    });
    const structured = result.structured as {
      parcial: boolean;
      total_retornado: number;
      erros: unknown[];
    };
    expect(structured.parcial).toBe(true);
    expect(structured.total_retornado).toBe(1);
    expect(structured.erros).toHaveLength(1);
  });
});
