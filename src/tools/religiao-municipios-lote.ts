import { z } from "zod";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { parseHttpError } from "../errors.js";
import { withMetrics } from "../metrics.js";
import type { StructuredToolResult } from "../structured.js";
import { IBGE_API } from "../types.js";
import { createMarkdownTable, formatNumber } from "../utils/index.js";

const TABELA = "9537";
const ANO = "2022";
const VARIAVEL_PESSOAS = "140";
const VARIAVEL_PERCENTUAL_TOTAL_GERAL = "1000140";
const CLASSIFICACAO_RELIGIAO = "133";
const CATEGORIA_RELIGIAO_TOTAL = "95278";
const CLASSIFICACAO_SEXO = "2";
const CATEGORIA_SEXO_TOTAL = "6794";
const CLASSIFICACAO_GRUPO_IDADE = "58";
const CATEGORIA_GRUPO_IDADE_TOTAL = "95253";

const GRUPOS_RELIGIOSOS = {
  catolica_apostolica_romana: {
    codigo: "95263",
    descricao: "Católica Apostólica Romana",
  },
  evangelicas: { codigo: "95277", descricao: "Evangélicas" },
  espirita: { codigo: "2826", descricao: "Espírita" },
  umbanda_e_candomble: { codigo: "2827", descricao: "Umbanda e Candomblé" },
  tradicoes_indigenas: { codigo: "95274", descricao: "Tradições indígenas" },
  outras_religiosidades: { codigo: "95275", descricao: "Outras religiosidades" },
  sem_religiao: { codigo: "2836", descricao: "Sem religião" },
  nao_sabe: { codigo: "12890", descricao: "Não sabe" },
  sem_declaracao: { codigo: "2837", descricao: "Sem declaração" },
} as const;

const grupoReligiosoSchema = z.enum([
  "catolica_apostolica_romana",
  "evangelicas",
  "espirita",
  "umbanda_e_candomble",
  "tradicoes_indigenas",
  "outras_religiosidades",
  "sem_religiao",
  "nao_sabe",
  "sem_declaracao",
]);

type GrupoReligioso = z.infer<typeof grupoReligiosoSchema>;

export const religiaoMunicipiosLoteSchema = z.object({
  municipios: z
    .array(z.string().regex(/^\d{7}$/))
    .min(1)
    .max(200)
    .describe("Lista de 1 a 200 códigos IBGE municipais, com 7 dígitos"),
  grupos_religiosos: z
    .array(grupoReligiosoSchema)
    .min(1)
    .max(5)
    .optional()
    .default(["catolica_apostolica_romana"])
    .describe("De 1 a 5 grandes grupos religiosos oficiais; o padrão é Católica Apostólica Romana"),
});

export type ReligiaoMunicipiosLoteInput = z.infer<typeof religiaoMunicipiosLoteSchema>;

const grupoResultadoSchema = z.object({
  grupo_religioso: grupoReligiosoSchema,
  codigo_categoria_sidra: z.string(),
  descricao: z.string(),
  pessoas_10_anos_ou_mais: z.number(),
  percentual_populacao_10_anos_ou_mais: z.number(),
});

const itemSchema = z.object({
  codigo_ibge_municipio: z.string(),
  municipio: z.string(),
  uf: z.string().nullable(),
  populacao_10_anos_ou_mais: z.number(),
  catolicos_10_anos_ou_mais: z.number().nullable(),
  percentual_catolicos: z.number().nullable(),
  grupos: z.array(grupoResultadoSchema),
  unidade_contagem: z.literal("Pessoas"),
  unidade_percentual: z.literal("%"),
  ano: z.literal(ANO),
  tabela_sidra: z.literal(TABELA),
  pesquisa: z.literal("Censo Demográfico"),
  fonte: z.literal("IBGE"),
  tipo_resultado: z.literal("resultados_preliminares_da_amostra"),
});

export const religiaoMunicipiosLoteOutputSchema = z.object({
  tabela_sidra: z.literal(TABELA),
  ano: z.literal(ANO),
  base_populacional: z.literal("Pessoas de 10 anos ou mais"),
  grupos_religiosos: z.array(grupoReligiosoSchema),
  total_solicitado: z.number(),
  total_retornado: z.number(),
  parcial: z.boolean(),
  itens: z.array(itemSchema),
  erros: z.array(z.object({ municipio: z.string(), motivo: z.string() })),
});

interface MetadadosAgregado {
  variaveis?: Array<{ id: number }>;
  classificacoes?: Array<{
    id: number;
    categorias?: Array<{ id: number }>;
  }>;
}

type SidraRow = Record<string, string>;

export async function ibgeReligiaoMunicipiosLote(
  input: ReligiaoMunicipiosLoteInput
): Promise<StructuredToolResult> {
  return withMetrics("ibge_religiao_municipios_lote", "sidra", async () => {
    const municipios = [...new Set(input.municipios)];
    const grupos = [
      ...new Set(input.grupos_religiosos ?? ["catolica_apostolica_romana"]),
    ] as GrupoReligioso[];

    try {
      await validarMetadados(grupos);

      const categorias = [
        CATEGORIA_RELIGIAO_TOTAL,
        ...grupos.map((grupo) => GRUPOS_RELIGIOSOS[grupo].codigo),
      ];
      const url =
        `${IBGE_API.SIDRA}/t/${TABELA}/n6/${municipios.join(",")}` +
        `/v/${VARIAVEL_PESSOAS},${VARIAVEL_PERCENTUAL_TOTAL_GERAL}/p/${ANO}` +
        `/c${CLASSIFICACAO_RELIGIAO}/${categorias.join(",")}` +
        `/c${CLASSIFICACAO_SEXO}/${CATEGORIA_SEXO_TOTAL}` +
        `/c${CLASSIFICACAO_GRUPO_IDADE}/${CATEGORIA_GRUPO_IDADE_TOTAL}`;
      const data = await cachedFetch<SidraRow[]>(url, cacheKey(url), CACHE_TTL.STATIC);
      const porMunicipio = agruparPorMunicipio(data.slice(1));
      const itens: Array<z.infer<typeof itemSchema>> = [];
      const erros: Array<{ municipio: string; motivo: string }> = [];

      for (const codigo of municipios) {
        const registros = porMunicipio.get(codigo) ?? [];
        const totalRow = encontrarRegistro(registros, VARIAVEL_PESSOAS, CATEGORIA_RELIGIAO_TOTAL);
        const populacaoTotal = parseSidraNumber(totalRow?.V);

        if (populacaoTotal === null) {
          erros.push({
            municipio: codigo,
            motivo:
              registros.length === 0
                ? "SIDRA não retornou o município"
                : "SIDRA não retornou o total da população de 10 anos ou mais",
          });
          continue;
        }

        const resultados = [] as Array<z.infer<typeof grupoResultadoSchema>>;
        let erroGrupo: string | null = null;

        for (const grupo of grupos) {
          const configuracao = GRUPOS_RELIGIOSOS[grupo];
          const pessoas = parseSidraNumber(
            encontrarRegistro(registros, VARIAVEL_PESSOAS, configuracao.codigo)?.V
          );
          const percentual = parseSidraNumber(
            encontrarRegistro(registros, VARIAVEL_PERCENTUAL_TOTAL_GERAL, configuracao.codigo)?.V
          );

          if (pessoas === null || percentual === null) {
            erroGrupo = `SIDRA não retornou quantidade e percentual válidos para ${configuracao.descricao}`;
            break;
          }

          const percentualCalculado =
            populacaoTotal > 0 ? Number(((pessoas / populacaoTotal) * 100).toFixed(2)) : 0;
          if (Math.abs(percentualCalculado - percentual) > 0.05) {
            erroGrupo = `Percentual oficial inconsistente com a contagem para ${configuracao.descricao}`;
            break;
          }

          resultados.push({
            grupo_religioso: grupo,
            codigo_categoria_sidra: configuracao.codigo,
            descricao: configuracao.descricao,
            pessoas_10_anos_ou_mais: pessoas,
            percentual_populacao_10_anos_ou_mais: percentual,
          });
        }

        if (erroGrupo) {
          erros.push({ municipio: codigo, motivo: erroGrupo });
          continue;
        }

        const localidade = parseLocalidade(totalRow?.D1N ?? registros[0]?.D1N ?? codigo);
        const catolicos = resultados.find(
          (resultado) => resultado.grupo_religioso === "catolica_apostolica_romana"
        );
        itens.push({
          codigo_ibge_municipio: codigo,
          municipio: localidade.municipio,
          uf: localidade.uf,
          populacao_10_anos_ou_mais: populacaoTotal,
          catolicos_10_anos_ou_mais: catolicos?.pessoas_10_anos_ou_mais ?? null,
          percentual_catolicos: catolicos?.percentual_populacao_10_anos_ou_mais ?? null,
          grupos: resultados,
          unidade_contagem: "Pessoas",
          unidade_percentual: "%",
          ano: ANO,
          tabela_sidra: TABELA,
          pesquisa: "Censo Demográfico",
          fonte: "IBGE",
          tipo_resultado: "resultados_preliminares_da_amostra",
        });
      }

      let markdown = "## Religião por município\n\n";
      markdown += `**Base:** pessoas de 10 anos ou mais  \n`;
      markdown += `**Fonte:** IBGE, Censo Demográfico ${ANO}, resultados preliminares da amostra, SIDRA ${TABELA}  \n`;
      markdown += `Retornados ${itens.length} de ${municipios.length} municípios.\n\n`;

      if (itens.length > 0) {
        markdown += createMarkdownTable(
          [
            "Código IBGE",
            "Município",
            "População 10+",
            ...grupos.map((grupo) => `${GRUPOS_RELIGIOSOS[grupo].descricao} (%)`),
          ],
          itens.map((item) => [
            item.codigo_ibge_municipio,
            item.uf ? `${item.municipio}/${item.uf}` : item.municipio,
            formatNumber(item.populacao_10_anos_ou_mais),
            ...grupos.map((grupo) => {
              const resultado = item.grupos.find((atual) => atual.grupo_religioso === grupo);
              return resultado
                ? `${formatNumber(resultado.percentual_populacao_10_anos_ou_mais, {
                    maximumFractionDigits: 2,
                  })}%`
                : "—";
            }),
          ]),
          { alignment: ["center", "left", "right", ...grupos.map(() => "right" as const)] }
        );
      }
      if (erros.length > 0) {
        markdown += `\n_Resultado parcial: ${erros.length} município(s) sem resultado seguro._\n`;
      }
      markdown +=
        "\n_Nota: religião é uma informação declarada no questionário da amostra. Os percentuais usam como denominador a população de 10 anos ou mais, não a população total nem a população adulta._\n";

      return {
        markdown,
        structured: {
          tabela_sidra: TABELA,
          ano: ANO,
          base_populacional: "Pessoas de 10 anos ou mais",
          grupos_religiosos: grupos,
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
          "ibge_religiao_municipios_lote",
          { totalMunicipios: municipios.length, gruposReligiosos: grupos },
          ["ibge_censo", "ibge_sidra_metadados", "ibge_sidra"]
        ),
        isError: true,
      };
    }
  });
}

async function validarMetadados(grupos: GrupoReligioso[]): Promise<void> {
  const url = `${IBGE_API.AGREGADOS}/${TABELA}/metadados`;
  const metadados = await cachedFetch<MetadadosAgregado>(url, cacheKey(url), CACHE_TTL.STATIC);
  const variaveis = new Set((metadados.variaveis ?? []).map((variavel) => String(variavel.id)));
  if (!variaveis.has(VARIAVEL_PESSOAS) || !variaveis.has(VARIAVEL_PERCENTUAL_TOTAL_GERAL)) {
    throw new Error("Variáveis esperadas ausentes nos metadados da tabela SIDRA 9537");
  }

  const religiao = metadados.classificacoes?.find(
    (classificacao) => String(classificacao.id) === CLASSIFICACAO_RELIGIAO
  );
  const categorias = new Set((religiao?.categorias ?? []).map((categoria) => String(categoria.id)));
  const esperadas = [
    CATEGORIA_RELIGIAO_TOTAL,
    ...grupos.map((grupo) => GRUPOS_RELIGIOSOS[grupo].codigo),
  ];
  if (esperadas.some((categoria) => !categorias.has(categoria))) {
    throw new Error("Categorias religiosas esperadas ausentes nos metadados da tabela SIDRA 9537");
  }
}

function agruparPorMunicipio(rows: SidraRow[]): Map<string, SidraRow[]> {
  const porMunicipio = new Map<string, SidraRow[]>();
  for (const row of rows) {
    const codigo = row.D1C;
    if (!codigo) continue;
    const atuais = porMunicipio.get(codigo) ?? [];
    atuais.push(row);
    porMunicipio.set(codigo, atuais);
  }
  return porMunicipio;
}

function encontrarRegistro(
  registros: SidraRow[],
  variavel: string,
  categoriaReligiao: string
): SidraRow | undefined {
  return registros.find(
    (row) =>
      row.D2C === variavel &&
      row.D4C === categoriaReligiao &&
      row.D5C === CATEGORIA_SEXO_TOTAL &&
      row.D6C === CATEGORIA_GRUPO_IDADE_TOTAL
  );
}

function parseSidraNumber(value?: string): number | null {
  if (!value) return null;
  if (value === "-") return 0;
  if (value === "..." || value === ".." || value === "X") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLocalidade(value: string): { municipio: string; uf: string | null } {
  const match = value.match(/^(.*) \(([A-Z]{2})\)$/u);
  return match ? { municipio: match[1], uf: match[2] } : { municipio: value, uf: null };
}
