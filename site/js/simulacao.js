/** Tela de simulação: uma compra hipotética, curva contra mercado. */

import {
  simular, pagamentosOcorridos, classificar, ROTULO_FAMILIA, NTNC,
  diaDeTexto, INDEXADOR,
} from "./tesouro.js";
import * as D from "./dados.js";
import { brl, num, pct, data, mesAno, paraInput, paraSegundos, inteiro } from "./formato.js";
import { desenharLinhas, desenharLegenda } from "./grafico.js";

const estado = {
  titulo: null, id: null, diaCompra: null, valor: 10000,
  reinvest: true, ipca: false, selic: false, igpm: false,
};

let lista, porTit, cal, grafico;

export async function montar(trilho, palco) {
  [cal, lista] = await Promise.all([D.calendario(), D.papeis()]);
  porTit = D.porTitulo(lista);
  const info = await D.meta();

  if (!estado.titulo) {
    estado.titulo = porTit.has("Tesouro IPCA+")
      ? "Tesouro IPCA+" : [...porTit.keys()][0];
  }

  trilho.innerHTML = `
    <div class="grupo">
      <label class="campo"><span>Título</span>
        <select id="selTitulo">${[...porTit.keys()].map((t) =>
          `<option${t === estado.titulo ? " selected" : ""}>${t}</option>`).join("")}</select>
      </label>
      <label class="campo"><span>Vencimento</span><select id="selVenc"></select></label>
      <label class="campo"><span>Data da compra</span>
        <input type="date" id="inpData"></label>
      <label class="campo"><span>Valor aplicado</span>
        <input type="number" id="inpValor" min="30" step="100" value="${estado.valor}"></label>
    </div>
    <div class="grupo">
      <h2>Linhas de referência</h2>
      <label class="marcador" style="color:var(--reinvest)">
        <input type="checkbox" id="cbReinvest"${estado.reinvest ? " checked" : ""}>
        <i></i><span style="color:var(--tinta)">Curva com reinvestimento</span></label>
      <label class="marcador" style="color:var(--ipca)">
        <input type="checkbox" id="cbIpca"${estado.ipca ? " checked" : ""}>
        <i></i><span style="color:var(--tinta)">IPCA acumulado</span></label>
      <label class="marcador" style="color:var(--selic)">
        <input type="checkbox" id="cbSelic"${estado.selic ? " checked" : ""}>
        <i></i><span style="color:var(--tinta)">Selic acumulada</span></label>
      <label class="marcador esconde" id="rotIgpm" style="color:var(--igpm)">
        <input type="checkbox" id="cbIgpm"${estado.igpm ? " checked" : ""}>
        <i></i><span style="color:var(--tinta)">IGP-M acumulado</span></label>
    </div>
    <p class="nota">${inteiro(info.observacoes)} observações.<br>
      Dados até ${info.ultimaDataBaseTexto}.</p>`;

  palco.innerHTML = `<div class="carregando">Carregando…</div>`;

  trilho.querySelector("#selTitulo").onchange = (e) => {
    estado.titulo = e.target.value;
    estado.id = null; estado.diaCompra = null;
    montar(trilho, palco);
  };

  preencherVencimentos(trilho);

  trilho.querySelector("#selVenc").onchange = (e) => {
    estado.id = e.target.value;
    ajustarData(trilho);
    render(palco);
  };
  trilho.querySelector("#inpData").onchange = (e) => {
    if (e.target.value) estado.diaCompra = diaDeTexto(e.target.value);
    render(palco);
  };
  trilho.querySelector("#inpValor").onchange = (e) => {
    estado.valor = Math.max(30, Number(e.target.value) || 10000);
    render(palco);
  };
  for (const [id, chave] of [["cbReinvest", "reinvest"], ["cbIpca", "ipca"],
                             ["cbSelic", "selic"], ["cbIgpm", "igpm"]]) {
    trilho.querySelector(`#${id}`).onchange = (e) => {
      estado[chave] = e.target.checked;
      render(palco);
    };
  }

  await render(palco);
}

function preencherVencimentos(trilho) {
  const opcoes = porTit.get(estado.titulo);
  if (!estado.id || !opcoes.some((p) => p.id === estado.id)) {
    estado.id = opcoes[0].id;
  }
  trilho.querySelector("#selVenc").innerHTML = opcoes.map((p) =>
    `<option value="${p.id}"${p.id === estado.id ? " selected" : ""}>` +
    `${data(p.vencimento)} (preços de ${mesAno(p.primeira)} a ${mesAno(p.ultima)})` +
    `</option>`).join("");

  trilho.querySelector("#rotIgpm").classList.toggle(
    "esconde", classificar(estado.titulo) !== NTNC);

  ajustarData(trilho);
}

function ajustarData(trilho) {
  const p = lista.find((x) => x.id === estado.id);
  const inp = trilho.querySelector("#inpData");
  inp.min = paraInput(p.primeira);
  inp.max = paraInput(p.ultima);
  if (estado.diaCompra == null ||
      estado.diaCompra < p.primeira || estado.diaCompra > p.ultima) {
    // Dois anos antes do fim da série, ou o começo dela se for mais curta.
    estado.diaCompra = Math.max(p.primeira, p.ultima - 730);
  }
  inp.value = paraInput(estado.diaCompra);
}

async function render(palco) {
  const dados = await D.papel(estado.id);

  let res;
  try {
    res = simular(cal, dados, estado.diaCompra, { valorAplicado: estado.valor });
  } catch (e) {
    palco.innerHTML = `<div class="aviso">${e.message}</div>`;
    return;
  }
  const { pos, serie } = res;
  const n = serie.data.length - 1;
  const pagaFluxo = serie.recebido[n] > 0;

  const linhas = [
    { rotulo: "Valor na curva", cor: "curva", valores: serie.curvaCaixa },
    { rotulo: "Valor a mercado", cor: "mercado", valores: serie.mercadoCaixa },
  ];
  if (estado.reinvest && pagaFluxo) {
    linhas.push({ rotulo: "Na curva, reinvestindo", cor: "reinvest",
                  valores: serie.curvaReinvest });
  }

  const quer = [];
  if (estado.ipca) quer.push(["ipca", "Só a inflação (IPCA)"]);
  if (estado.selic) quer.push(["selic", "Selic acumulada"]);
  if (estado.igpm && pos.indexador === "igpm") quer.push(["igpm", "Só o IGP-M"]);

  if (quer.length) {
    const idx = await D.indices();
    for (const [chave, rotulo] of quer) {
      const v = alinhar(idx, chave, serie.data);
      if (v) linhas.push({ rotulo, cor: chave, valores:
        v.map((x) => (x == null ? null : pos.aplicado * x)) });
    }
  }

  const agio = serie.agio[n];
  const abaixo = agio < 0;
  const mercado = serie.mercadoCaixa[n];

  palco.innerHTML = `
    <header class="cabeca">
      <h1>${pos.nome}, vencimento ${data(pos.vencimento)}</h1>
      <p>${ROTULO_FAMILIA[pos.familia]}. Compra em ${data(pos.diaCompra)} a
         ${num(pos.taxa, 2)}% a.a., PU de ${brl(pos.puCompra)},
         ${num(pos.quantidade, 4)} títulos.</p>
    </header>

    <p class="veredito${abaixo ? " abaixo" : ""}">
      Vendendo em ${data(serie.data[n])} você receberia <strong>${brl(mercado)}</strong>,
      ${abaixo
        ? `<strong>${brl(Math.abs(agio))} abaixo</strong> do valor na curva.
           Levar até o vencimento devolve essa diferença, desde que o título seja mantido.`
        : `<strong>${brl(agio)} acima</strong> do valor na curva.
           Vender antecipadamente antecipa rendimento.`}
    </p>

    <dl class="cifras">
      ${cifra("Aplicado", brl(pos.aplicado), null)}
      ${cifra("Na curva", brl(serie.curvaCaixa[n]),
              serie.curvaCaixa[n] / pos.aplicado - 1)}
      ${cifra("A mercado", brl(mercado), mercado / pos.aplicado - 1)}
      ${cifra("Ágio sobre a curva", brl(agio), serie.agioPct[n] / 100)}
    </dl>

    <section class="tela">
      <div class="legenda" id="legenda"></div>
      <div class="grafico" id="grafico"></div>
    </section>

    <section class="secao">
      <h2>O contrato: na compra e hoje</h2>
      ${tabelaContrato(pos, serie, n, pagaFluxo)}
      <p class="prosa">A taxa da compra é a de aplicação e a de hoje é a de
        resgate; o spread entre as duas é do próprio Tesouro. A cotação é o PU
        dividido pelo VNA, e é a única medida da tabela que independe de quando
        você comprou — ela vale igual para todo mundo que carrega o papel. O VNA
        carrega apenas o indexador; nos prefixados é fixo em R$ 1.000.</p>
    </section>

    ${quer.length ? secaoRetornos(linhas, pos, n) : ""}
    ${pagaFluxo ? secaoPagamentos(cal, pos, serie) : ""}

    <section class="secao">
      <details><summary>Como o valor na curva é calculado</summary>
        <div class="prosa" style="padding-top:.6rem">
          <p>Toma-se o mesmo fluxo de caixa contratual do título e desconta-se à
          taxa travada no dia da compra, em dias úteis sobre 252, calendário
          ANBIMA. O VNA de cada data sai do próprio preço publicado pelo Tesouro
          (VNA = PU ÷ cotação), o que dispensa baixar séries separadas de IPCA,
          IGP-M ou Selic.</p>
          <p>Títulos com cupom ou amortização devolvem dinheiro pelo caminho. A
          linha “na curva” trata esse dinheiro como caixa parado; a linha
          “reinvestindo” supõe reaplicação à mesma taxa contratada. O valor a
          mercado recebe o mesmo tratamento de caixa, para a comparação ficar
          entre iguais.</p>
          <p>Os valores são brutos: não entram imposto de renda, taxa de custódia
          da B3 nem corretagem. Os preços são os de abertura de cada dia útil.
          Ferramenta de análise, não recomendação de investimento.</p>
        </div>
      </details>
    </section>`;

  desenharLegenda(palco.querySelector("#legenda"), linhas);
  if (grafico) { grafico._obs?.disconnect(); grafico.destroy(); }
  grafico = desenharLinhas(
    palco.querySelector("#grafico"),
    serie.data.map(paraSegundos), linhas, { altura: 400 });
}

function alinhar(idx, chave, datas) {
  const col = idx[chave];
  if (!col) return null;
  const out = new Array(datas.length);
  let j = 0, ultimo = null;
  for (let k = 0; k < datas.length; k++) {
    while (j < idx.d.length && idx.d[j] <= datas[k]) {
      if (col[j] != null) ultimo = col[j];
      j++;
    }
    out[k] = ultimo;
  }
  const base = out.find((v) => v != null);
  if (!base) return null;
  return out.map((v) => (v == null ? null : v / base));
}

function cifra(rotulo, valor, variacao) {
  const d = variacao == null ? "" :
    `<span class="delta ${variacao >= 0 ? "sobe" : "desce"}">${pct(variacao * 100)}</span>`;
  return `<div><dt>${rotulo}</dt><dd>${valor}</dd>${d}</div>`;
}

function tabelaContrato(pos, serie, n, pagaFluxo) {
  const q = pos.quantidade;
  const cotCompra = pos.puCompra / serie.vna[0];
  const cotHoje = (serie.puMercado[n] / q) / serie.vna[n];
  const duRest = cal.diasUteis(serie.data[n], pos.vencimento);
  const duTotal = cal.diasUteis(pos.diaCompra, pos.vencimento);

  const linhas = [
    ["Taxa (% a.a.)", `${num(pos.taxa, 2)} contratada`,
     `${num(serie.taxaMercado[n], 2)} de mercado`,
     `${pct(serie.taxaMercado[n] - pos.taxa, 2)} p.p.`],
    ["PU por título", brl(pos.puCompra), brl(serie.puMercado[n] / q),
     pct((serie.puMercado[n] / q / pos.puCompra - 1) * 100)],
    ["Cotação (% do VNA)", `${num(cotCompra * 100, 2)}%`,
     `${num(cotHoje * 100, 2)}%`, `${pct((cotHoje - cotCompra) * 100, 2)} p.p.`],
    ["VNA", brl(serie.vna[0]), brl(serie.vna[n]),
     pct((serie.vna[n] / serie.vna[0] - 1) * 100)],
    ["Dias úteis até o vencimento", inteiro(duTotal), inteiro(duRest),
     `${inteiro(serie.diasUteis[n])} decorridos`],
    ["Prazo restante", `${num(duTotal / 252, 1)} anos`,
     `${num(duRest / 252, 1)} anos`, `${num(serie.anos[n], 1)} anos decorridos`],
  ];

  if (pagaFluxo) {
    linhas.push(["Caixa recebido", "—", brl(serie.recebido[n]),
      `${num(serie.recebido[n] / serie.curvaCaixa[n] * 100, 1)}% do valor na curva`]);
  }

  return `<div class="rolagemH"><table class="tabela"><thead><tr>
      <th>Item</th><th>Na compra</th><th>Hoje</th><th>Variação</th>
    </tr></thead><tbody>${linhas.map((l) =>
      `<tr><td>${l[0]}</td><td>${l[1]}</td><td>${l[2]}</td><td>${l[3]}</td></tr>`
    ).join("")}</tbody></table></div>`;
}

function secaoRetornos(linhas, pos, n) {
  const corpo = linhas.map((s) => {
    const v = s.valores[n];
    if (!Number.isFinite(v)) return "";
    return `<tr><td>${s.rotulo}</td><td>${brl(v)}</td>` +
           `<td>${pct((v / pos.aplicado - 1) * 100)}</td></tr>`;
  }).join("");

  return `<section class="secao"><h2>Retorno de cada linha</h2>
    <table class="tabela"><thead><tr>
      <th>Linha</th><th>Valor final</th><th>Retorno</th>
    </tr></thead><tbody>${corpo}</tbody></table>
    <p class="prosa" style="margin-top:.8rem">As linhas de indexador mostram
      quanto o mesmo dinheiro valeria se apenas acompanhasse o índice, sem juro
      real nenhum. Elas não vêm de fonte externa: o VNA de cada data é extraído
      dos próprios preços do Tesouro, e a razão entre dois VNAs é a variação
      acumulada do indexador. O VNA embute a projeção de inflação do mês
      corrente, então anda um pouco à frente do IPCA do IBGE — é o índice que o
      título de fato paga.</p></section>`;
}

function secaoPagamentos(cal, pos, serie) {
  const pags = pagamentosOcorridos(cal, pos, serie);
  if (!pags.length) return "";
  const total = serie.recebido[serie.recebido.length - 1];
  return `<section class="secao">
    <details><summary>Pagamentos recebidos — ${pags.length} evento(s),
      ${brl(total)} no total</summary>
      <div class="rolagem" style="margin-top:.6rem">
      <table class="tabela"><thead><tr>
        <th>Data</th><th>Tipo</th><th>Por título</th><th>Total</th>
      </tr></thead><tbody>${pags.map((p) =>
        `<tr><td>${data(p.dia)}</td><td>${p.tipo}</td>` +
        `<td>${brl(p.porTitulo)}</td><td>${brl(p.total)}</td></tr>`
      ).join("")}</tbody></table></div>
    </details></section>`;
}
