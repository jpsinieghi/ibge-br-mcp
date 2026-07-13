import { beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../src/cache.js";
import { ibgeResolverMunicipiosLote } from "../src/tools/resolver-municipios-lote.js";

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

function municipio(id: number, nome: string, uf: string) {
  return {
    id,
    nome,
    microrregiao: { mesorregiao: { UF: { sigla: uf } } },
  };
}

describe("ibge_resolver_municipios_lote", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    cache.clear();
  });

  it("resolve nomes sem depender de acentos ou caixa", async () => {
    mockFetch.mockResolvedValueOnce(
      response([municipio(3550308, "São Paulo", "SP"), municipio(4205407, "Florianópolis", "SC")])
    );
    const result = await ibgeResolverMunicipiosLote({
      municipios: [
        { municipio: "sao paulo", uf: "SP" },
        { municipio: "Florianopolis", uf: "SC" },
        { municipio: "Cidade inexistente", uf: "SP" },
      ],
    });
    const structured = result.structured as {
      total_exato: number;
      total_nao_encontrado: number;
      resultados: Array<{ codigo_ibge_municipio: string | null; status: string }>;
    };
    expect(structured.total_exato).toBe(2);
    expect(structured.total_nao_encontrado).toBe(1);
    expect(structured.resultados[0]).toMatchObject({
      codigo_ibge_municipio: "3550308",
      status: "exato",
    });
  });
});
