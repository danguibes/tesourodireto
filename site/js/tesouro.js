/**
 * Núcleo de cálculo do Tesouro Direto — port do tesouro_core.py.
 *
 * Convenções (padrão ANBIMA / Tesouro Nacional):
 *   - Desconto exponencial em dias úteis / 252, calendário ANBIMA.
 *   - PU = VNA x Cotação, onde Cotação é o valor presente dos fluxos futuros
 *     por unidade de valor nominal, descontados à taxa contratada.
 *   - Cupom NTN-B / NTN-C: (1,06)^0,5 - 1 = 2,956301% do VNA, semestral.
 *   - Cupom NTN-F:         (1,10)^0,5 - 1 = 4,880885% sobre VN de R$ 1.000.
 *   - NTN-B1 (RendA+ / Educa+): n amortizações mensais iguais (240 / 60).
 *
 * Datas circulam como "dia" = número de dias desde 1970-01-01 (UTC), para
 * evitar fuso horário e horário de verão.
 */

export const MS_DIA = 86400000;

export const CUPOM_NTNB = Math.pow(1.06, 0.5) - 1;
export const CUPOM_NTNF = Math.pow(1.10, 0.5) - 1;

export const LTN = "LTN";
export const NTNF = "NTN-F";
export const LFT = "LFT";
export const NTNB_P = "NTN-B Principal";
export const NTNB = "NTN-B";
export const NTNC = "NTN-C";
export const NTNB1 = "NTN-B1";

export const INDEXADOR = {
  [LTN]: "prefixado", [NTNF]: "prefixado", [LFT]: "selic",
  [NTNB_P]: "ipca", [NTNB]: "ipca", [NTNB1]: "ipca", [NTNC]: "igpm",
};

export const ROTULO_FAMILIA = {
  [LTN]: "Prefixado (LTN)",
  [NTNF]: "Prefixado com juros semestrais (NTN-F)",
  [LFT]: "Selic (LFT)",
  [NTNB_P]: "IPCA+ (NTN-B Principal)",
  [NTNB]: "IPCA+ com juros semestrais (NTN-B)",
  [NTNC]: "IGP-M com juros semestrais (NTN-C)",
  [NTNB1]: "Amortização mensal (NTN-B1)",
};

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

export function diaDe(ano, mes, dia) {
  return Date.UTC(ano, mes - 1, dia) / MS_DIA;
}

/** "2026-10-23" ou "23/10/2026" -> número do dia. */
export function diaDeTexto(texto) {
  const t = String(texto).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return diaDe(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return diaDe(+m[3], +m[2], +m[1]);
  throw new Error(`Data não reconhecida: ${texto}`);
}

export function partesDoDia(dia) {
  const d = new Date(dia * MS_DIA);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

export function formatarDia(dia) {
  const p = partesDoDia(dia);
  return `${String(p.dia).padStart(2, "0")}/${String(p.mes).padStart(2, "0")}/${p.ano}`;
}

function diasNoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Soma `n` meses (pode ser negativo), truncando o dia ao fim do mês quando
 * necessário — mesmo comportamento do relativedelta do Python.
 */
export function somarMeses(dia, n) {
  const p = partesDoDia(dia);
  const total = (p.ano * 12 + (p.mes - 1)) + n;
  const ano = Math.floor(total / 12);
  const mes = (total % 12 + 12) % 12 + 1;
  return diaDe(ano, mes, Math.min(p.dia, diasNoMes(ano, mes)));
}

// ---------------------------------------------------------------------------
// Calendário ANBIMA
// ---------------------------------------------------------------------------

export class Calendario {
  /**
   * @param {string[]} feriados datas ISO ("2026-01-01") dos feriados ANBIMA
   * @param {string} inicio primeira data coberta
   * @param {string} fim última data coberta
   */
  constructor(feriados, inicio = "2000-01-03", fim = "2099-12-25") {
    this.base = diaDeTexto(inicio);
    this.fim = diaDeTexto(fim);
    const n = this.fim - this.base + 1;

    const feriado = new Uint8Array(n);
    for (const f of feriados) {
      const i = diaDeTexto(f) - this.base;
      if (i >= 0 && i < n) feriado[i] = 1;
    }

    this.util = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      // 1970-01-01 (dia 0) foi quinta-feira; 4 = quinta no índice 0=domingo.
      const semana = ((this.base + i) + 4) % 7;   // 0=dom ... 6=sáb
      this.util[i] = (!feriado[i] && semana !== 0 && semana !== 6) ? 1 : 0;
    }

    // acum[i] = dias úteis estritamente antes do dia i
    this.acum = new Int32Array(n);
    let soma = 0;
    for (let i = 0; i < n; i++) {
      this.acum[i] = soma;
      soma += this.util[i];
    }

    // prox[i] = índice do primeiro dia útil a partir de i
    this.prox = new Int32Array(n);
    let ultimo = n - 1;
    for (let i = n - 1; i >= 0; i--) {
      if (this.util[i]) ultimo = i;
      this.prox[i] = ultimo;
    }
  }

  _idx(dia) {
    const i = dia - this.base;
    if (i < 0 || i >= this.util.length) {
      throw new Error(`Data fora do calendário: ${formatarDia(dia)}`);
    }
    return i;
  }

  /** Dias úteis no intervalo [inicio, fim). */
  diasUteis(inicio, fim) {
    return this.acum[this._idx(fim)] - this.acum[this._idx(inicio)];
  }

  /** Leva ao próximo dia útil, se cair em feriado ou fim de semana. */
  ajusta(dia) {
    return this.base + this.prox[this._idx(dia)];
  }

  ehDiaUtil(dia) {
    return this.util[this._idx(dia)] === 1;
  }
}

// ---------------------------------------------------------------------------
// Famílias de título
// ---------------------------------------------------------------------------

export function classificar(nome) {
  const n = String(nome).trim().toLowerCase();
  if (n.includes("renda+") || n.includes("renda +") ||
      n.includes("educa+") || n.includes("educa +")) return NTNB1;
  if (n.includes("igpm") || n.includes("igp-m")) return NTNC;
  if (n.includes("ipca")) return n.includes("semestrais") ? NTNB : NTNB_P;
  if (n.includes("selic") || n.includes("reserva")) return LFT;
  if (n.includes("prefixado")) return n.includes("semestrais") ? NTNF : LTN;
  throw new Error(`Título não reconhecido: ${nome}`);
}

export function nParcelas(nome) {
  const n = String(nome).trim().toLowerCase();
  return (n.includes("educa+") || n.includes("educa +")) ? 60 : 240;
}

// ---------------------------------------------------------------------------
// Fluxos de caixa, por unidade de valor nominal (VNA = 1)
// ---------------------------------------------------------------------------

const _cacheFluxos = new Map();

/** @returns {Array<[number, number]>} [[dia_pagamento, valor_por_VNA], ...] */
export function fluxos(cal, nome, vencimento) {
  const fam = classificar(nome);
  const chave = `${fam === NTNB1 ? fam + "-" + nParcelas(nome) : fam}|${vencimento}`;
  const guardado = _cacheFluxos.get(chave);
  if (guardado) return guardado;

  let saida;

  if (fam === LTN || fam === LFT || fam === NTNB_P) {
    saida = [[cal.ajusta(vencimento), 1.0]];
  } else if (fam === NTNB1) {
    const n = nParcelas(nome);
    saida = [];
    for (let k = n - 1; k >= 0; k--) {
      saida.push([cal.ajusta(somarMeses(vencimento, -k)), 1.0 / n]);
    }
  } else {
    const cupom = (fam === NTNF) ? CUPOM_NTNF : CUPOM_NTNB;
    const datas = [];
    let d = vencimento;
    while (d >= cal.base) {
      datas.push(d);
      d = somarMeses(d, -6);
    }
    datas.sort((a, b) => a - b);
    saida = datas.map((x) => [cal.ajusta(x), cupom]);
    saida[saida.length - 1] = [saida[saida.length - 1][0], cupom + 1.0];
  }

  _cacheFluxos.set(chave, saida);
  return saida;
}

// ---------------------------------------------------------------------------
// Precificação
// ---------------------------------------------------------------------------

/** Valor presente dos fluxos futuros por unidade de VNA, à taxa dada (% a.a.). */
export function cotacao(cal, nome, vencimento, ref, taxa) {
  const i = 1 + taxa / 100;
  const refAcum = cal.acum[cal._idx(ref)];
  let total = 0;
  for (const [d, v] of fluxos(cal, nome, vencimento)) {
    if (d <= ref) continue;
    const du = cal.acum[cal._idx(d)] - refAcum;
    total += v / Math.pow(i, du / 252);
  }
  return total;
}

/** Extrai o VNA do preço observado: VNA = PU / cotação. */
export function vnaImplicito(cal, nome, vencimento, ref, taxa, pu) {
  const c = cotacao(cal, nome, vencimento, ref, taxa);
  return c > 0 ? pu / c : NaN;
}

// ---------------------------------------------------------------------------
// Simulação de uma compra
// ---------------------------------------------------------------------------

/**
 * Simula uma compra passada e devolve a série diária.
 *
 * @param {Calendario} cal
 * @param {object} papel  {titulo, vencimento (dia), d:[dias], tc, tv, pc, pv}
 * @param {number} diaCompra
 * @param {object} opcoes {valorAplicado} ou {quantidade}
 */
export function simular(cal, papel, diaCompra, opcoes = {}) {
  const { d, tc, tv, pc, pv } = papel;
  const venc = papel.vencimento;

  // Dia da compra: a data exata, ou o último pregão anterior a ela.
  let i0 = -1;
  for (let i = 0; i < d.length; i++) {
    if (d[i] <= diaCompra) i0 = i; else break;
  }
  if (i0 < 0) {
    throw new Error(
      `Esse papel só tem preço a partir de ${formatarDia(d[0])}.`);
  }

  const pu0 = pc[i0];
  const taxa0 = tc[i0];
  if (!isFinite(pu0) || pu0 <= 0) {
    throw new Error("Nesse dia o papel não estava disponível para compra.");
  }

  const quantidade = opcoes.quantidade != null
    ? opcoes.quantidade
    : (opcoes.valorAplicado != null ? opcoes.valorAplicado / pu0 : 1);

  const pos = {
    nome: papel.titulo,
    vencimento: venc,
    diaCompra: d[i0],
    taxa: taxa0,
    puCompra: pu0,
    quantidade,
    familia: classificar(papel.titulo),
    aplicado: pu0 * quantidade,
  };
  pos.indexador = INDEXADOR[pos.familia];

  const n = d.length - i0;
  const serie = {
    data: new Array(n), diasUteis: new Array(n), anos: new Array(n),
    taxaMercado: new Array(n), vna: new Array(n),
    puCurva: new Array(n), puMercado: new Array(n), recebido: new Array(n),
    curvaCaixa: new Array(n), curvaReinvest: new Array(n),
    mercadoCaixa: new Array(n), agio: new Array(n), agioPct: new Array(n),
  };

  // VNA de cada data, extraído do próprio preço de venda publicado.
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    serie.data[k] = d[i];
    serie.taxaMercado[k] = tv[i];
    const cotMercado = cotacao(cal, pos.nome, venc, d[i], tv[i]);
    serie.vna[k] = pv[i] / cotMercado;
    serie.puCurva[k] = cotacao(cal, pos.nome, venc, d[i], taxa0) * serie.vna[k];
    serie.puMercado[k] = pv[i];
  }

  // Pagamentos (cupons ou amortizações) ocorridos após a compra, pelo VNA
  // vigente na data em que cada um aconteceu.
  const recebido = new Float64Array(n);
  for (const [diaPag, v] of fluxos(cal, pos.nome, venc)) {
    if (diaPag <= pos.diaCompra) continue;
    let k = serie.data.findIndex((x) => x >= diaPag);
    if (k < 0) continue;
    const valor = v * serie.vna[k];
    for (let j = k; j < n; j++) recebido[j] += valor;
  }

  const vna0 = serie.vna[0];
  for (let k = 0; k < n; k++) {
    const du = cal.diasUteis(pos.diaCompra, serie.data[k]);
    serie.diasUteis[k] = du;
    serie.anos[k] = du / 252;
    serie.recebido[k] = recebido[k] * quantidade;
    serie.puCurva[k] *= quantidade;
    serie.puMercado[k] *= quantidade;
    serie.curvaCaixa[k] = serie.puCurva[k] + serie.recebido[k];
    serie.mercadoCaixa[k] = serie.puMercado[k] + serie.recebido[k];
    serie.curvaReinvest[k] =
      pu0 * Math.pow(1 + taxa0 / 100, du / 252) * (serie.vna[k] / vna0) * quantidade;
    serie.agio[k] = serie.mercadoCaixa[k] - serie.curvaCaixa[k];
    serie.agioPct[k] = serie.curvaCaixa[k]
      ? (serie.agio[k] / serie.curvaCaixa[k]) * 100 : NaN;
  }

  return { pos, serie };
}

/** Tabela dos pagamentos já ocorridos após a compra. */
export function pagamentosOcorridos(cal, pos, serie) {
  const linhas = [];
  const ultimo = serie.data[serie.data.length - 1];
  for (const [diaPag, v] of fluxos(cal, pos.nome, pos.vencimento)) {
    if (diaPag <= pos.diaCompra || diaPag > ultimo) continue;
    const k = serie.data.findIndex((x) => x >= diaPag);
    if (k < 0) continue;
    const porTitulo = v * serie.vna[k];
    linhas.push({
      dia: diaPag,
      tipo: pos.familia === NTNB1 ? "Amortização" : "Cupom",
      porTitulo,
      total: porTitulo * pos.quantidade,
    });
  }
  return linhas;
}
