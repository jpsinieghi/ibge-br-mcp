import { z } from "zod";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { parseHttpError } from "../errors.js";
import { withMetrics } from "../metrics.js";
import type { StructuredToolResult } from "../structured.js";
import { IBGE_API } from "../types.js";
import { createMarkdownTable, formatNumber } from "../utils/index.js";

const TABELA = "9514";
const ANO = "2022";
const VARIAVEL_POPULACAO = "93";
const CLASSIFICACAO_SEXO = "2";
const CATEGORIA_SEXO_TOTAL = "6794";
const CLASSIFICACAO_IDADE = "287";
const CATEGORIA_IDADE_TOTAL = "100362";

export const populacaoFaixaEtariaMunicipiosLoteSchema = z.object({
    municipios: z
      .array(z.string().regex(/^\d{7}$/))
      .min(1)
      .max(200)
      .describe("Lista de 1 a 200 códigos IBGE municipais, com 7 dígitos"),
    idade_minima: z.number().int().min(0).max(100).optional().default(18),
    idade_maxima: z
      .number()
      .int()
      .min(0)
      .max(99)
      .optional()
      .describe("Idade máxima inclusiva; omita para idade mínima ou mais"),
  });

export type PopulacaoFaixaEtariaMunicipiosLoteInput = z.infer<
  typeof populacaoFaixaEtariaMunicipiosLoteSchema
>;

const itemSchema = z.object({
  codigo_ibge_municipio: z.string(),
  municipio: z.string(),
  uf: z.string().nullable(),
  idade_minima: z.number(),
  idade_maxima: z.number().nullable(),
  faixa_etaria: z.string(),
  populacao_faixa_etaria: z.number(),
  populacao_total: z.number(),
  percentual_populacao_faixa_etaria: z.number(),
  unidade: z.literal("Pessoas"),
  ano: z.literal(ANO),
  tabela_sidra: z.literal(TABELA),
  pesquisa: z.literal("Censo Demográfico"),
  fonte: z.literal("IBGE"),
});

export const populacaoFaixaEtariaMunicipiosLoteOutputSchema = z.object({
  tabela_sidra: z.literal(TABELA),
  ano: z.literal(ANO),
  idade_minima: z.number(),
  idade_maxima: z.number().nullable(),
  faixa_etaria: z.string(),
  total_solicitado: z.number(),
  total_retornado: z.number(),
  parcial: z.boolean(),
  itens: z.array(itemSchema),
  erros: z.array(z.object({ municipio: z.string(), motivo: z.string() })),
});

interface CategoriaMeta {
  id: number;
  nome: string;
  nivel: number;
}

interface MetadadosAgregado {
  classificacoes?: Array<{
    id: number;
    categorias?: CategoriaMeta[];
  }>;
}

type SidraRow = Record<string, string>;

export async function ibgePopulacaoFaixaEtariaMunicipiosLote(
  input: PopulacaoFaixaEtariaMunicipiosLoteInput
): Promise<StructuredToolResult> {
  return withMetrics("ibge_populacao_por_faixa_etaria_municipios_lote", "sidra", async () => {
    const municipios = [...new Set(input.municipios)];
    const idadeMinima = input.idade_minima ?? 18;
    const idadeMaxima = input.idade_maxima;
    const faixaEtaria = formatarFaixaEtaria(idadeMinima, idadeMaxima);

    if (idadeMaxima !== undefined && idadeMaxima < idadeMinima) {
      return {
        markdown: "idade_maxima deve ser maior ou igual a idade_minima.",
        isError: true,
      };
    }

    try {
      const categorias = await obterCategoriasEtarias(idadeMinima, idadeMaxima);
      if (categorias.length === 0) {
        return {
          markdown: `Nenhuma categoria etária oficial encontrada para ${faixaEtaria}.`,
          isError: true,
        };
      }

      const idsIdade = [CATEGORIA_IDADE_TOTAL, ...categorias.map((item) => String(item.id))];
      const url =
        `${IBGE_API.SIDRA}/t/${TABELA}/n6/${municipios.join(",")}` +
        `/v/${VARIAVEL_POPULACAO}/p/${ANO}` +
        `/c${CLASSIFICACAO_SEXO}/${CATEGORIA_SEXO_TOTAL}` +
        `/c${CLASSIFICACAO_IDADE}/${idsIdade.join(",")}`;
      const data = await cachedFetch<SidraRow[]>(url, cacheKey(url), CACHE_TTL.STATIC);
      const rows = data.slice(1);
      const porMunicipio = new Map<string, SidraRow[]>();

      for (const row of rows) {
        const codigo = row.D1C;
        if (!codigo) continue;
        const atuais = porMunicipio.get(codigo) ?? [];
        atuais.push(row);
        porMunicipio.set(codigo, atuais);
      }

      const itens: Array<z.infer<typeof itemSchema>> = [];
      const erros: Array<{ municipio: string; motivo: string }> = [];
      const categoriasEsperadas = new Set(categorias.map((item) => String(item.id)));

      for (const codigo of municipios) {
        const registros = porMunicipio.get(codigo) ?? [];
        const totalRow = registros.find((row) => row.D5C === CATEGORIA_IDADE_TOTAL);
        const idadeRows = registros.filter((row) => categoriasEsperadas.has(row.D5C));
        const valoresIdade = idadeRows.map((row) => parseSidraNumber(row.V));
        const populacaoTotal = parseSidraNumber(totalRow?.V);

        if (
          populacaoTotal === null ||
          idadeRows.length !== categoriasEsperadas.size ||
          valoresIdade.some((valor) => valor === null)
        ) {
          erros.push({
            municipio: codigo,
            motivo:
              registros.length === 0
                ? "SIDRA não retornou o município"
                : "SIDRA não retornou todas as idades necessárias com valores numéricos",
          });
          continue;
        }

        const populacaoFaixa = valoresIdade.reduce<number>(
          (total, valor) => total + (valor ?? 0),
          0
        );
        const localidade = parseLocalidade(totalRow?.D1N ?? idadeRows[0]?.D1N ?? codigo);
        itens.push({
          codigo_ibge_municipio: codigo,
          municipio: localidade.municipio,
          uf: localidade.uf,
          idade_minima: idadeMinima,
          idade_maxima: idadeMaxima ?? null,
          faixa_etaria: faixaEtaria,
          populacao_faixa_etaria: populacaoFaixa,
          populacao_total: populacaoTotal,
          percentual_populacao_faixa_etaria:
            populacaoTotal > 0 ? Number(((populacaoFaixa / populacaoTotal) * 100).toFixed(4)) : 0,
          unidade: "Pessoas",
          ano: ANO,
          tabela_sidra: TABELA,
          pesquisa: "Censo Demográfico",
          fonte: "IBGE",
        });
      }

      let markdown = `## População municipal por faixa etária\n\n`;
      markdown += `**Faixa:** ${faixaEtaria}  \n`;
      markdown += `**Fonte:** IBGE, Censo Demográfico ${ANO}, SIDRA ${TABELA}  \n`;
      markdown += `Retornados ${itens.length} de ${municipios.length} municípios.\n\n`;
      if (itens.length > 0) {
        markdown += createMarkdownTable(
          ["Código IBGE", "Município", "População da faixa", "% da população total"],
          itens.map((item) => [
            item.codigo_ibge_municipio,
            item.uf ? `${item.municipio}/${item.uf}` : item.municipio,
            formatNumber(item.populacao_faixa_etaria),
            `${formatNumber(item.percentual_populacao_faixa_etaria, {
              maximumFractionDigits: 2,
            })}%`,
          ]),
          { alignment: ["center", "left", "right", "right"] }
        );
      }
      if (erros.length > 0) {
        markdown += `\n_Resultado parcial: ${erros.length} município(s) sem cálculo seguro._\n`;
      }

      return {
        markdown,
        structured: {
          tabela_sidra: TABELA,
          ano: ANO,
          idade_minima: idadeMinima,
          idade_maxima: idadeMaxima ?? null,
          faixa_etaria: faixaEtaria,
          total_solicitado: municipios.length,
          total_retornado: itens.length,
          parcial: erros.length > 0,
          itens,
          erros,
        },
      };
    } catch (error) {
      return {
        markdown: parseHttpError(
          error instanceof Error ? error : new Error(String(error)),
          "ibge_populacao_por_faixa_etaria_municipios_lote",
          { totalMunicipios: municipios.length, idadeMinima, idadeMaxima },
          ["ibge_sidra_metadados", "ibge_sidra"]
        ),
        isError: true,
      };
    }
  });
}

async function obterCategoriasEtarias(idadeMinima: number, idadeMaxima?: number) {
  const url = `${IBGE_API.AGREGADOS}/${TABELA}/metadados`;
  const metadata = await cachedFetch<MetadadosAgregado>(url, cacheKey(url), CACHE_TTL.STATIC);
  const classificacao = metadata.classificacoes?.find((item) => item.id === 287);
  if (!classificacao?.categorias) throw new Error("Metadados de idade ausentes na tabela 9514");

  return classificacao.categorias.filter((categoria) => {
    const idade = idadeExataDaCategoria(categoria);
    if (idade === null) return false;
    if (idade < idadeMinima) return false;
    if (idadeMaxima !== undefined && idade > idadeMaxima) return false;
    return true;
  });
}

function idadeExataDaCategoria(categoria: CategoriaMeta): number | null {
  if (categoria.nome === "Menos de 1 ano" && categoria.nivel === 2) return 0;
  if (categoria.nome === "100 anos ou mais") return 100;
  if (categoria.nivel !== 2) return null;
  const match = categoria.nome.match(/^(\d+) anos?$/u);
  return match ? Number(match[1]) : null;
}

function parseSidraNumber(value?: string): number | null {
  if (!value || value === "-" || value === "..." || value === "X") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLocalidade(value: string): { municipio: string; uf: string | null } {
  const match = value.match(/^(.*) \(([A-Z]{2})\)$/u);
  return match ? { municipio: match[1], uf: match[2] } : { municipio: value, uf: null };
}

function formatarFaixaEtaria(idadeMinima: number, idadeMaxima?: number): string {
  return idadeMaxima === undefined
    ? `${idadeMinima} anos ou mais`
    : `${idadeMinima} a ${idadeMaxima} anos`;
}
