/** Formatação em português do Brasil. */

import { partesDoDia, MS_DIA } from "./tesouro.js";

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const INT = new Intl.NumberFormat("pt-BR");

export function brl(v) {
  return Number.isFinite(v) ? BRL.format(v) : "—";
}

export function num(v, casas = 2) {
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", {
    minimumFractionDigits: casas, maximumFractionDigits: casas,
  });
}

export function inteiro(v) {
  return Number.isFinite(v) ? INT.format(v) : "—";
}

export function pct(v, casas = 2, comSinal = true) {
  if (!Number.isFinite(v)) return "—";
  const s = comSinal && v > 0 ? "+" : "";
  return `${s}${num(v, casas)}%`;
}

export function data(dia) {
  const p = partesDoDia(dia);
  return `${String(p.dia).padStart(2, "0")}/${String(p.mes).padStart(2, "0")}/${p.ano}`;
}

export function mesAno(dia) {
  const p = partesDoDia(dia);
  return `${String(p.mes).padStart(2, "0")}/${p.ano}`;
}

/** Número do dia -> "AAAA-MM-DD", o formato do <input type="date">. */
export function paraInput(dia) {
  const p = partesDoDia(dia);
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

/** Número do dia -> objeto Date em UTC, que é o que o uPlot consome. */
export function paraSegundos(dia) {
  return (dia * MS_DIA) / 1000;
}

export { NUM };
