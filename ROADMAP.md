# Roadmap — ibge-br-mcp

This document tracks the direction of the project: what's done, what's planned,
and ideas under consideration. It is updated periodically. Suggestions are
welcome — open an issue to discuss a specific item.

## ✅ Completed (v1.9.x)

- [x] 23 tools covering all major IBGE APIs
- [x] Automatic caching with configurable TTL
- [x] Retry mechanism with exponential backoff
- [x] 227 automated tests
- [x] Bilingual documentation (EN / PT-BR)
- [x] GitHub Actions CI/CD (lint, format check, build, test matrix on Node 18/20/22, coverage, type-check, audit)
- [x] Published to npm and the MCP Registry

## 📋 Planned

### Short-term (v1.10.x)

- [ ] `ibge_areas` — territorial areas by locality
- [ ] `ibge_fronteiras` — country borders
- [ ] Improve error messages with more context
- [ ] Add request timeout configuration

### Medium-term (v2.0.0)

- [ ] Field selection for responses (return only requested fields)
- [ ] Batch request support
- [ ] Response streaming for large datasets
- [ ] OpenAPI/Swagger documentation

### Long-term

- [ ] Integration with other Brazilian data sources (INEP, ANS, Receita Federal)
- [ ] Data visualization helpers
- [ ] Offline mode with cached data

## 🧪 Test coverage

Core modules (cache, validation, errors, types) are at 97%+. The tool modules
themselves are thinly covered. Goal: raise tool-module coverage to at least 50%,
prioritizing the highest-value tools.

Priority order:

- [ ] `sidra.ts` — most complex, highest value
- [ ] `indicadores.ts` — frequently used
- [ ] `censo.ts` — many themes
- [ ] `nomes.ts` — simple, good starting point
- [ ] `malhas.ts` — multiple response formats (GeoJSON, SVG)

Approach: mock API responses, then test parameter validation, response
formatting, and error handling. See existing tests under `tests/` for patterns.

## 📚 Documentation & examples

Practical, runnable examples for common tasks:

- [ ] Basic: list states/municipalities, population for a city, name frequency
- [ ] Advanced: compare GDP across states (`ibge_comparar`), demographic
      dashboard from Census data, map visualization (`ibge_malhas`)
- [ ] Integration: combine IBGE data with BCB indicators, export to CSV/Excel

## 🆕 Additional IBGE APIs under consideration

Based on the [IBGE API catalog](https://servicodados.ibge.gov.br/api/docs/):

- [ ] **Áreas Territoriais** — land areas by locality
- [ ] **Divisões Administrativas** — historical administrative divisions
- [ ] **Produtos e Preços (PAM)** — agricultural product prices
- [ ] **Produção Agrícola** — agricultural production data
- [ ] **Metadados** — statistical metadata
- [ ] **Geocodificação** — address geocoding (limited)

New tools follow the existing pattern (see `src/tools/estados.ts`): Zod input
validation, standardized error handling, response formatting, and caching.
