import { z } from "zod";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable } from "../utils/index.js";
import type { StructuredToolResult } from "../structured.js";
import { consultarUltimoValor, INDICADORES_CIDADES } from "./cidades.js";

export const cidadesLoteSchema = z.object({
  municipios: z
    .array(z.string().regex(/^\d{7}$/))
    .min(1)
    .max(50)
    .describe("Lista de 1 a 50 códigos IBGE municipais, com 7 dígitos"),
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

    // Limita concorrência para não pressionar a API pública nem multiplicar retries.
    for (let i = 0; i < tarefas.length; i += 10) {
      const bloco = tarefas.slice(i, i + 10);
      const resultados = await Promise.allSettled(
        bloco.map(({ municipio, alias }) => consultarUltimoValor(alias, municipio))
      );
      resultados.forEach((resultado, index) => {
        const tarefa = bloco[index];
        if (resultado.status === "fulfilled") {
          itens.push({ municipio: tarefa.municipio, ...resultado.value });
        } else {
          erros.push({
            ...tarefa,
            motivo:
              resultado.reason instanceof Error
                ? resultado.reason.message
                : "Falha desconhecida na fonte pública",
          });
        }
      });
    }

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
