import { z } from "zod";
import { IBGE_API, type Municipio } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable } from "../utils/index.js";
import type { StructuredToolResult } from "../structured.js";

const entradaSchema = z.object({
  municipio: z.string().trim().min(2).max(120),
  uf: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
});

export const resolverMunicipiosLoteSchema = z.object({
  municipios: z.array(entradaSchema).min(1).max(200),
});

export type ResolverMunicipiosLoteInput = z.infer<typeof resolverMunicipiosLoteSchema>;

const resultadoSchema = z.object({
  municipio_original: z.string(),
  uf_original: z.string(),
  municipio_normalizado: z.string(),
  status: z.enum(["exato", "ambiguo", "nao_encontrado"]),
  codigo_ibge_municipio: z.string().nullable(),
  municipio_ibge: z.string().nullable(),
  uf_ibge: z.string().nullable(),
  candidatos: z.array(
    z.object({ codigo_ibge_municipio: z.string(), municipio: z.string(), uf: z.string() })
  ),
});

export const resolverMunicipiosLoteOutputSchema = z.object({
  total_solicitado: z.number(),
  total_exato: z.number(),
  total_ambiguo: z.number(),
  total_nao_encontrado: z.number(),
  cobertura_percentual: z.number(),
  resultados: z.array(resultadoSchema),
});

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function municipioUf(municipio: Municipio): string {
  return municipio.microrregiao?.mesorregiao?.UF?.sigla || "";
}

export async function ibgeResolverMunicipiosLote(
  input: ResolverMunicipiosLoteInput
): Promise<StructuredToolResult> {
  return withMetrics("ibge_resolver_municipios_lote", "localidades", async () => {
    const url = `${IBGE_API.LOCALIDADES}/municipios?orderBy=nome`;
    const oficiais = await cachedFetch<Municipio[]>(url, cacheKey(url), CACHE_TTL.STATIC);
    const index = new Map<string, Municipio[]>();
    for (const municipio of oficiais) {
      const key = `${municipioUf(municipio)}|${normalizeName(municipio.nome)}`;
      index.set(key, [...(index.get(key) || []), municipio]);
    }

    const resultados = input.municipios.map((entrada) => {
      const normalizado = normalizeName(entrada.municipio);
      const candidatos = index.get(`${entrada.uf}|${normalizado}`) || [];
      const status =
        candidatos.length === 1 ? "exato" : candidatos.length > 1 ? "ambiguo" : "nao_encontrado";
      const unico = candidatos.length === 1 ? candidatos[0] : null;
      return {
        municipio_original: entrada.municipio,
        uf_original: entrada.uf,
        municipio_normalizado: normalizado,
        status,
        codigo_ibge_municipio: unico ? String(unico.id) : null,
        municipio_ibge: unico?.nome || null,
        uf_ibge: unico ? municipioUf(unico) : null,
        candidatos: candidatos.map((item) => ({
          codigo_ibge_municipio: String(item.id),
          municipio: item.nome,
          uf: municipioUf(item),
        })),
      };
    });

    const totalExato = resultados.filter((item) => item.status === "exato").length;
    const totalAmbiguo = resultados.filter((item) => item.status === "ambiguo").length;
    const totalNaoEncontrado = resultados.filter((item) => item.status === "nao_encontrado").length;
    const cobertura = Number(((totalExato / resultados.length) * 100).toFixed(2));
    const markdown =
      `## Resolução municipal em lote\n\nCorrespondência exata: ${totalExato}/${resultados.length} (${cobertura}%).\n\n` +
      createMarkdownTable(
        ["Município informado", "UF", "Status", "Código IBGE", "Município IBGE"],
        resultados.map((item) => [
          item.municipio_original,
          item.uf_original,
          item.status,
          item.codigo_ibge_municipio || "-",
          item.municipio_ibge || "-",
        ])
      );

    return {
      markdown,
      structured: {
        total_solicitado: resultados.length,
        total_exato: totalExato,
        total_ambiguo: totalAmbiguo,
        total_nao_encontrado: totalNaoEncontrado,
        cobertura_percentual: cobertura,
        resultados,
      },
    };
  });
}
