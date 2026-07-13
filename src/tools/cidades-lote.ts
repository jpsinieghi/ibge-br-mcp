import { z } from "zod";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable } from "../utils/index.js";
import type { StructuredToolResult } from "../structured.js";
import { INDICADORES_CIDADES } from "./cidades.js";
import { IBGE_API, type PesquisaResultado } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { formatNumber } from "../utils/index.js";

export const cidadesLoteSchema = z.object({
  municipios: z
    .array(z.string().regex(/^\d{7}$/))
    .min(1)
    .max(200)
    .describe("Lista de 1 a 200 códigos IBGE municipais, com 7 dígitos"),
  indicadores: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe("Lista de 1 a 5 aliases, como populacao, idh, pib_per_capita ou salario_medio"),
});

export type CidadesLoteInput = z.infer<typeof cidadesLoteSchema>;

const itemSchema = z.object({
  municipio: z.string(),
  alias: z.string(),
  indicador_id: z.number(),
  nome: z.string(),
  valor: z.string(),
  valor_numerico: z.number().nullable(),
  unidade: z.string(),
  pesquisa: z.string(),
  fonte: z.string(),
  ano: z.string(),
});

export const cidadesLoteOutputSchema = z.object({
  total_solicitado: z.number(),
  total_retornado: z.number(),
  parcial: z.boolean(),
  itens: z.array(itemSchema),
  erros: z.array(z.object({ municipio: z.string(), alias: z.string(), motivo: z.string() })),
});

export async function ibgeCidadesLote(input: CidadesLoteInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_cidades_lote", "cidades", async () => {
    const municipios = [...new Set(input.municipios)];
    const indicadores = [...new Set(input.indicadores.map((item) => item.toLowerCase()))];
    const desconhecidos = indicadores.filter((item) => !INDICADORES_CIDADES[item]);
    if (desconhecidos.length > 0) {
      return {
        markdown: `Indicadores desconhecidos: ${desconhecidos.join(", ")}.`,
        isError: true,
      };
    }

    const tarefas = municipios.flatMap((municipio) =>
      indicadores.map((alias) => ({ municipio, alias }))
    );
    const itens: Array<z.infer<typeof itemSchema>> = [];
    const erros: Array<{ municipio: string; alias: string; motivo: string }> = [];

    // A API aceita códigos separados por |. Assim, cada indicador usa uma única
    // requisição para todo o lote, em vez de uma requisição por município.
    const resultados = await Promise.allSettled(
      indicadores.map((alias) => consultarIndicadorEmLote(alias, municipios))
    );
    resultados.forEach((resultado, index) => {
      const alias = indicadores[index];
      if (resultado.status === "fulfilled") {
        itens.push(...resultado.value.itens);
        erros.push(...resultado.value.erros);
      } else {
        for (const municipio of municipios) {
          erros.push({
            municipio,
            alias,
            motivo:
              resultado.reason instanceof Error ? resultado.reason.message : "Falha desconhecida",
          });
        }
      }
    });

    let markdown = `## Indicadores municipais em lote\n\n`;
    markdown += `Retornados ${itens.length} de ${tarefas.length} pares município/indicador.\n\n`;
    if (itens.length > 0) {
      markdown += createMarkdownTable(
        ["Código IBGE", "Indicador", "Valor", "Ano"],
        itens.map((item) => [item.municipio, item.nome, item.valor, item.ano]),
        { alignment: ["center", "left", "right", "center"] }
      );
    }
    if (erros.length > 0) {
      markdown += `\n_Resultado parcial: ${erros.length} consulta(s) não retornaram valor._\n`;
    }

    return {
      markdown,
      structured: {
        total_solicitado: tarefas.length,
        total_retornado: itens.length,
        parcial: erros.length > 0,
        itens,
        erros,
      },
    };
  });
}

async function consultarIndicadorEmLote(alias: string, municipios: string[]) {
  const info = INDICADORES_CIDADES[alias];
  if (info.nivel === "brasil") {
    throw new Error(`O indicador ${info.id} não possui resultado municipal`);
  }
  const codigos = municipios.join("|");
  const url = `${IBGE_API.PESQUISAS}/${info.pesquisa}/indicadores/${info.id}/resultados/${codigos}`;
  const data = await cachedFetch<PesquisaResultado[]>(url, cacheKey(url), CACHE_TTL.MEDIUM);
  const series = data?.[0]?.res || [];
  const porCodigoSeis = new Map(series.map((item) => [item.localidade, item.res]));
  const itens: Array<z.infer<typeof itemSchema>> = [];
  const erros: Array<{ municipio: string; alias: string; motivo: string }> = [];

  for (const municipio of municipios) {
    const serie = porCodigoSeis.get(municipio.slice(0, 6));
    const entry = serie
      ? Object.entries(serie)
          .filter(([, value]) => value !== null && value !== "-" && value !== "...")
          .sort(([a], [b]) => b.localeCompare(a))[0]
      : undefined;
    if (!entry) {
      erros.push({ municipio, alias, motivo: "Fonte pública não retornou valor utilizável" });
      continue;
    }
    const [ano, raw] = entry;
    const parsed = Number(raw);
    const numero = Number.isFinite(parsed) ? parsed : null;
    let valor = String(raw);
    if (numero !== null) {
      if (info.unidade === "R$") valor = `R$ ${formatNumber(numero, { maximumFractionDigits: 2 })}`;
      else if (info.unidade === "índice")
        valor = formatNumber(numero, { maximumFractionDigits: 3 });
      else valor = `${formatNumber(numero, { maximumFractionDigits: 2 })} ${info.unidade}`;
    }
    itens.push({
      municipio,
      alias,
      indicador_id: info.id,
      nome: info.nome,
      valor,
      valor_numerico: numero,
      unidade: info.unidade,
      pesquisa: info.pesquisa,
      fonte: "IBGE",
      ano,
    });
  }
  return { itens, erros };
}
