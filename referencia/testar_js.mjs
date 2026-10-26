/**
 * Compara o port JavaScript com a implementação Python já validada.
 *
 * Roda com:  node referencia/testar_js.mjs
 * Exige que gerar_fixture.py tenha produzido feriados.json e fixture/casos.json.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  Calendario, classificar, fluxos, cotacao, simular, formatarDia,
} from "../site/js/tesouro.js";

const AQUI = dirname(fileURLToPath(import.meta.url));

const feriadosJson = JSON.parse(
  readFileSync(join(AQUI, "fixture", "feriados.json"), "utf-8"));
const casos = JSON.parse(
  readFileSync(join(AQUI, "fixture", "casos.json"), "utf-8"));

const cal = new Calendario(
  feriadosJson.feriados, feriadosJson.inicio, feriadosJson.fim);

let falhas = 0;
let total = 0;
const piores = {};

function registrar(grupo, erro) {
  total++;
  if (!(grupo in piores) || erro > piores[grupo]) piores[grupo] = erro;
}

function exigir(grupo, esperado, obtido, tolerancia, contexto) {
  total++;
  const erro = Math.abs(esperado) > 1e-9
    ? Math.abs(obtido - esperado) / Math.abs(esperado)
    : Math.abs(obtido - esperado);
  if (!(grupo in piores) || erro > piores[grupo]) piores[grupo] = erro;
  if (!(erro <= tolerancia) || !isFinite(obtido)) {
    falhas++;
    if (falhas <= 10) {
      console.error(`  FALHA [${grupo}] ${contexto}\n` +
        `    esperado ${esperado}\n    obtido   ${obtido}\n    erro ${erro}`);
    }
  }
}

function exigirIgual(grupo, esperado, obtido, contexto) {
  total++;
  if (esperado !== obtido) {
    falhas++;
    if (falhas <= 10) {
      console.error(`  FALHA [${grupo}] ${contexto}: ` +
        `esperado ${esperado}, obtido ${obtido}`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log("1. Calendário — contagem de dias úteis");
for (const c of casos.calendario) {
  exigirIgual("calendario", c.du, cal.diasUteis(c.a, c.b),
    `${formatarDia(c.a)} -> ${formatarDia(c.b)}`);
}

console.log("2. Calendário — ajuste para o próximo dia útil");
for (const c of casos.ajusta) {
  exigirIgual("ajusta", c.ajustado, cal.ajusta(c.d), formatarDia(c.d));
  exigirIgual("ehDiaUtil", c.util, cal.ehDiaUtil(c.d), formatarDia(c.d));
}

console.log("3. Fluxos de caixa por família");
for (const c of casos.fluxos) {
  exigirIgual("familia", c.familia, classificar(c.nome), c.nome);
  const fl = fluxos(cal, c.nome, c.venc);
  exigirIgual("n_fluxos", c.n, fl.length, c.nome);
  for (let i = 0; i < Math.min(fl.length, c.fluxos.length); i++) {
    exigirIgual("fluxo_data", c.fluxos[i][0], fl[i][0],
      `${c.nome} fluxo ${i}`);
    exigir("fluxo_valor", c.fluxos[i][1], fl[i][1], 1e-12,
      `${c.nome} fluxo ${i}`);
  }
}

console.log("4. Cotação");
for (const c of casos.cotacao) {
  exigir("cotacao", c.cotacao, cotacao(cal, c.nome, c.venc, c.ref, c.taxa),
    1e-12, `${c.nome} ref ${formatarDia(c.ref)} taxa ${c.taxa}`);
}

console.log("5. Simulação completa");
for (const c of casos.simulacao) {
  const papel = {
    titulo: c.nome,
    vencimento: c.venc,
    d: c.serie.map((l) => l.dia),
    tc: c.serie.map((l) => l.tc),
    tv: c.serie.map((l) => l.tv),
    pc: c.serie.map((l) => l.pc),
    pv: c.serie.map((l) => l.pv),
  };
  const { pos, serie } = simular(cal, papel, c.diaCompra,
    { valorAplicado: c.valorAplicado });

  exigir("pu0", c.esperado.pu0, pos.puCompra, 1e-12, c.nome);
  exigir("taxa0", c.esperado.taxa0, pos.taxa, 1e-12, c.nome);
  exigir("quantidade", c.esperado.quantidade, pos.quantidade, 1e-12, c.nome);
  exigirIgual("n_serie", c.esperado.linhas.length, serie.data.length, c.nome);

  for (let k = 0; k < c.esperado.linhas.length; k++) {
    const e = c.esperado.linhas[k];
    const ctx = `${c.nome} em ${formatarDia(e.dia)}`;
    exigirIgual("serie_data", e.dia, serie.data[k], ctx);
    exigirIgual("serie_du", e.du, serie.diasUteis[k], ctx);
    exigir("vna", e.vna, serie.vna[k], 1e-11, ctx);
    exigir("puCurva", e.puCurva, serie.puCurva[k], 1e-11, ctx);
    exigir("puMercado", e.puMercado, serie.puMercado[k], 1e-11, ctx);
    exigir("recebido", e.recebido, serie.recebido[k], 1e-11, ctx);
    exigir("curvaCaixa", e.curvaCaixa, serie.curvaCaixa[k], 1e-11, ctx);
    exigir("curvaReinvest", e.curvaReinvest, serie.curvaReinvest[k], 1e-11, ctx);
    exigir("mercadoCaixa", e.mercadoCaixa, serie.mercadoCaixa[k], 1e-11, ctx);
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${total.toLocaleString("pt-BR")} comparações, ${falhas} falha(s)`);
console.log("\nMaior erro relativo por grupo:");
for (const [g, e] of Object.entries(piores).sort((a, b) => b[1] - a[1])) {
  if (e > 0) console.log(`  ${g.padEnd(16)} ${e.toExponential(2)}`);
}
if (falhas) {
  console.error("\nO port JavaScript NÃO reproduz o Python.");
  process.exit(1);
}
console.log("\nO port JavaScript reproduz o Python em todos os casos.");
