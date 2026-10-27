/** Tela de carteira: importa uma planilha de compras e consolida o ágio. */

import {
  simular, diaDeTexto, classificar, fluxos, INDEXADOR, NTNB1, LTN, LFT, NTNB_P,
} from "./tesouro.js";
import * as D from "./dados.js";
import { brl, num, pct, data, inteiro, paraSegundos } from "./formato.js";
import { desenharLinhas, desenharLegenda } from "./grafico.js";

const MODELO =
  "data;operacao;titulo;quantidade;vencimento;pu\n" +
  "30/01/2023;compra;Tesouro IPCA+ 2035;1,5;;\n" +
  "15/06/2024;compra;Tesouro Prefixado 2029;10;;\n" +
  "02/09/2025;compra;Tesouro Renda+ Aposentadoria Extra 2030;4,2;;\n" +
  "10/03/2026;venda;Tesouro Prefixado 2029;4;;\n";

let cal, lista, info;
let graficos = [];

// A última planilha fica só neste navegador (localStorage), nunca sai dele.
// O acesso pode lançar em janela anônima ou com dados bloqueados, e aí a
// tela só deixa de lembrar — continua funcionando.
const CHAVE = "tesourodireto.carteira.v1";

function guardar(nome, texto) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify({ nome, texto, em: Date.now() }));
  } catch { /* sem armazenamento: segue sem lembrar */ }
}

function lerGuardada() {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE));
    return v && typeof v.texto === "string" ? v : null;
  } catch {
    return null;
  }
}

function esquecer() {
  try { localStorage.removeItem(CHAVE); } catch { /* idem */ }
}

// Janelas do histórico, em dias corridos; null é desde a primeira compra.
const PERIODOS = [["30 dias", 30], ["90 dias", 90], ["1 ano", 365], ["Tudo", null]];

export async function montar(trilho, palco) {
  [cal, lista, info] = await Promise.all([
    D.calendario(), D.papeis(), D.meta()]);

  trilho.innerHTML = `
    <div class="grupo">
      <h2>Planilha de operações</h2>
      <p class="nota">Uma linha por compra ou venda: <b>data</b>,
        <b>operacao</b>, <b>titulo</b> e <b>quantidade</b>. O título pode vir
        como aparece na corretora.</p>
      <button class="botao fraco" id="btnModelo">Baixar modelo em CSV</button>
    </div>
    <p class="nota">Dados até ${info.ultimaDataBaseTexto}.</p>`;

  trilho.querySelector("#btnModelo").onclick = () => {
    const url = URL.createObjectURL(
      new Blob(["﻿" + MODELO], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "modelo_carteira.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  palco.innerHTML = `
    <header class="cabeca">
      <h1>Carteira</h1>
      <p>Suba uma planilha com as suas compras e vendas e veja o ágio ou deságio
         de cada posição na data mais recente disponível.</p>
    </header>
    <div class="solta" id="solta">
      <p style="margin-top:0">Arraste o arquivo aqui, ou</p>
      <button class="botao" id="btnEscolher">Escolher arquivo</button>
      <input type="file" id="inpArquivo" accept=".csv,.txt" class="esconde">
      <p class="nota" style="margin-bottom:0">CSV separado por ponto e vírgula
        ou por vírgula.</p>
    </div>
    <div id="salva"></div>
    <div id="saida"></div>
    <section class="secao">
      <details><summary>Como montar a planilha</summary>
        <div class="prosa" style="padding-top:.6rem">
          <p>Obrigatórias: <b>data</b>, <b>titulo</b> e <b>quantidade</b>. Em
            vez de quantidade, uma compra pode informar <b>valor_aplicado</b> em
            reais; uma venda precisa da quantidade.</p>
          <p><b>operacao</b> diz se a linha é <b>compra</b> ou <b>venda</b> (também
            vale C, V, aplicação ou resgate). Sem essa coluna, tudo é compra — as
            planilhas antigas, com <b>data_compra</b>, continuam funcionando.
            Cada venda sai primeiro das compras mais antigas do mesmo papel, a
            regra que o Tesouro Direto usa para o imposto de renda.</p>
          <p>O ano no nome do RendA+ e do Educa+ é o da conversão, e o site já
            traduz para o vencimento real: RendA+ 2030 vence em 15/12/2049,
            Educa+ 2026 em 15/12/2030.</p>
          <p>Duas colunas opcionais cobrem casos específicos.
            <b>vencimento</b> é necessária quando o ano sozinho é ambíguo, como
            no Tesouro IPCA+ 2026, que vence em maio e em agosto.
            <b>pu</b> é o preço que você realmente pagou ou recebeu por título;
            sem ela, o site usa o preço publicado naquele dia (de compra numa
            compra, de venda numa venda).</p>
        </div>
      </details>
    </section>`;

  const solta = palco.querySelector("#solta");
  const inp = palco.querySelector("#inpArquivo");

  palco.querySelector("#btnEscolher").onclick = () => inp.click();
  inp.onchange = () => inp.files[0] && abrirArquivo(inp.files[0], palco);

  solta.addEventListener("dragover", (e) => {
    e.preventDefault(); solta.classList.add("sobre");
  });
  solta.addEventListener("dragleave", () => solta.classList.remove("sobre"));
  solta.addEventListener("drop", (e) => {
    e.preventDefault();
    solta.classList.remove("sobre");
    if (e.dataTransfer.files[0]) abrirArquivo(e.dataTransfer.files[0], palco);
  });

  const salva = lerGuardada();
  if (salva && await processar(salva.texto, palco)) marcarSalva(palco, salva);
}

async function abrirArquivo(arquivo, palco) {
  const texto = await arquivo.text();
  // Só lembra planilha que rendeu ao menos uma posição.
  if (await processar(texto, palco)) {
    guardar(arquivo.name, texto);
    marcarSalva(palco, lerGuardada());
  }
}

/**
 * Com carteira carregada, a área grande de envio dá lugar a uma faixa de uma
 * linha: nome do arquivo, trocar e esquecer. A faixa também aceita arrastar.
 */
function marcarSalva(palco, salva) {
  const alvo = palco.querySelector("#salva");
  const solta = palco.querySelector("#solta");
  if (!alvo || !salva) return;
  const quando = new Date(salva.em).toLocaleDateString("pt-BR");
  alvo.innerHTML = `<div class="salva" title="A planilha fica só neste navegador; ela não é enviada a lugar nenhum.">
      <span><b>${escapar(salva.nome)}</b>
        <span class="nota">· lembrada neste navegador desde ${quando}</span></span>
      <span class="acoes">
        <button class="botao fraco" id="btnTrocar">Trocar planilha</button>
        <button class="botao fraco" id="btnEsquecer">Esquecer</button>
      </span>
    </div>`;
  solta.classList.add("esconde");

  const faixa = alvo.querySelector(".salva");
  alvo.querySelector("#btnTrocar").onclick = () => palco.querySelector("#inpArquivo").click();
  faixa.addEventListener("dragover", (e) => { e.preventDefault(); faixa.classList.add("sobre"); });
  faixa.addEventListener("dragleave", () => faixa.classList.remove("sobre"));
  faixa.addEventListener("drop", (e) => {
    e.preventDefault();
    faixa.classList.remove("sobre");
    if (e.dataTransfer.files[0]) abrirArquivo(e.dataTransfer.files[0], palco);
  });

  alvo.querySelector("#btnEsquecer").onclick = () => {
    esquecer();
    limparGraficos();
    alvo.innerHTML = "";
    solta.classList.remove("esconde");
    palco.querySelector("#saida").innerHTML = "";
  };
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function limparGraficos() {
  for (const g of graficos) { g?._obs?.disconnect(); g?.destroy(); }
  graficos = [];
}

// ---------------------------------------------------------------- planilha

function separador(primeiraLinha) {
  const p = (primeiraLinha.match(/;/g) || []).length;
  const v = (primeiraLinha.match(/,/g) || []).length;
  return p >= v ? ";" : ",";
}

function partir(linha, sep) {
  const out = [];
  let atual = "", aspas = false;
  for (const c of linha) {
    if (c === '"') aspas = !aspas;
    else if (c === sep && !aspas) { out.push(atual); atual = ""; }
    else atual += c;
  }
  out.push(atual);
  return out.map((s) => s.trim().replace(/^"|"$/g, ""));
}

function lerCsv(texto) {
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/)
    .filter((l) => l.trim());
  if (!linhas.length) throw new Error("Arquivo vazio.");
  const sep = separador(linhas[0]);
  const cab = partir(linhas[0], sep).map(
    (c) => c.toLowerCase().replace(/\s+/g, "_"));
  return linhas.slice(1).map((l) => {
    const campos = partir(l, sep);
    return Object.fromEntries(cab.map((c, i) => [c, campos[i] ?? ""]));
  });
}

function numeroBr(v) {
  if (v == null || v === "") return NaN;
  let s = String(v).trim().replace(/R\$\s*/i, "").replace(/\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// ------------------------------------------------------ compras e vendas

/** "compra", "C", "aplicação" → compra; "venda", "V", "resgate" → venda. */
function operacaoDe(v) {
  const s = String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase();
  if (!s || s.startsWith("c") || s.startsWith("aplica")) return "compra";
  if (s.startsWith("v") || s.startsWith("resgat")) return "venda";
  return null;
}

/** Último índice com dia <= d (o pregão vigente naquela data). */
function idxAte(dias, d) {
  let k = -1;
  for (let i = 0; i < dias.length && dias[i] <= d; i++) k = i;
  return k;
}

/**
 * Lê as operações e devolve as compras ("lotes") já abatidas pelas vendas.
 *
 * Cada compra é simulada para UMA unidade; como curva, mercado e ágio são
 * lineares na quantidade, o valor da posição em cada dia é a série unitária
 * vezes a quantidade que ainda estava em carteira naquele dia. As vendas
 * abatem primeiro das compras mais antigas do mesmo papel (PEPS, a regra do
 * Tesouro Direto para o imposto de renda). No mesmo dia, compras entram antes
 * das vendas. Venda maior que o saldo daquela data é recusada inteira.
 */
async function montarLotes(entradas, colData, problemas) {
  const ops = [];
  entradas.forEach((e, i) => {
    const rot = `linha ${i + 2}`;
    const tipo = operacaoDe(e.operacao ?? e.tipo);
    if (!tipo) {
      problemas.push(`${rot}: operação “${e.operacao ?? e.tipo}” não reconhecida; use compra ou venda`);
      return;
    }
    let dia;
    try { dia = diaDeTexto(e[colData]); } catch {
      problemas.push(`${rot}: data inválida (“${e[colData]}”)`);
      return;
    }
    let venc = null;
    if (e.vencimento) {
      try { venc = diaDeTexto(e.vencimento); } catch { venc = null; }
    }
    const achado = D.resolverTitulo(lista, e.titulo, venc);
    if (!achado.papel) { problemas.push(`${rot}: ${achado.erro}`); return; }

    const qtd = numeroBr(e.quantidade);
    const val = numeroBr(e.valor_aplicado);
    if (tipo === "venda" && !(qtd > 0)) {
      problemas.push(`${rot}: venda precisa da quantidade vendida`);
      return;
    }
    if (tipo === "compra" && !Number.isFinite(qtd) && !Number.isFinite(val)) {
      problemas.push(`${rot}: sem quantidade nem valor aplicado`);
      return;
    }
    const pu = numeroBr(e.pu ?? e.pu_compra ?? e.pu_venda);
    ops.push({ rot, ordem: i, tipo, dia, papel: achado.papel, qtd, val, pu });
  });

  const grupos = new Map();
  for (const op of ops) {
    if (!grupos.has(op.papel.id)) grupos.set(op.papel.id, []);
    grupos.get(op.papel.id).push(op);
  }

  const lotes = [], vendas = [];
  for (const [id, grupo] of grupos) {
    grupo.sort((a, b) => a.dia - b.dia
      || (a.tipo === b.tipo ? 0 : a.tipo === "compra" ? -1 : 1)
      || a.ordem - b.ordem);
    const dados = await D.papel(id);
    const fila = [];

    for (const op of grupo) {
      if (op.tipo === "compra") {
        let res;
        try { res = simular(cal, dados, op.dia, { quantidade: 1 }); } catch (err) {
          problemas.push(`${op.rot}: ${err.message}`);
          continue;
        }
        const q = Number.isFinite(op.qtd) ? op.qtd : op.val / res.pos.puCompra;
        if (!(q > 0)) { problemas.push(`${op.rot}: quantidade inválida`); continue; }
        const lote = { res, original: q, restante: q, saidas: [], puInf: op.pu };
        fila.push(lote);
        lotes.push(lote);
        continue;
      }

      const saldo = fila.reduce((s, l) => s + l.restante, 0);
      if (op.qtd > saldo + 1e-9) {
        problemas.push(`${op.rot}: venda de ${num(op.qtd, 4)} ${op.papel.titulo} ` +
          `${anoDe(op.papel.vencimento)} em ${data(op.dia)}, mas o saldo nessa data ` +
          `era ${num(saldo, 4)}; a venda foi ignorada`);
        continue;
      }

      let falta = op.qtd, custo = 0, curva = 0, puMercado = null;
      for (const lote of fila) {
        if (falta <= 1e-12) break;
        const tira = Math.min(lote.restante, falta);
        if (tira <= 0) continue;
        lote.restante -= tira;
        lote.saidas.push({ dia: op.dia, qtd: tira });
        falta -= tira;
        const s = lote.res.serie;
        const k = Math.max(0, idxAte(s.data, op.dia));
        custo += tira * (Number.isFinite(lote.puInf) ? lote.puInf : lote.res.pos.puCompra);
        curva += tira * s.puCurva[k];
        puMercado ??= s.puMercado[k];
      }
      const puVenda = Number.isFinite(op.pu) ? op.pu : puMercado;
      vendas.push({
        dia: op.dia, titulo: op.papel.titulo, vencimento: op.papel.vencimento,
        qtd: op.qtd, puVenda, informado: Number.isFinite(op.pu),
        recebido: puVenda * op.qtd, custo, curva,
      });
    }
  }
  vendas.sort((a, b) => a.dia - b.dia);
  return { lotes, vendas };
}

/** Série da compra em reais: a unitária vezes o que estava em carteira no dia. */
function dadosDoLote(lote) {
  const { pos, serie } = lote.res;
  const emCarteira = (d) => lote.original -
    lote.saidas.reduce((s, x) => s + (x.dia <= d ? x.qtd : 0), 0);
  const q = serie.data.map(emCarteira);
  return {
    titulo: pos.nome, vencimento: pos.vencimento, compra: pos.diaCompra,
    serie: {
      dias: serie.data,
      curva: serie.curvaCaixa.map((v, k) => v * q[k]),
      mercado: serie.mercadoCaixa.map((v, k) => v * q[k]),
    },
  };
}

function secaoSaldo(lotes) {
  const porPapel = new Map();
  for (const l of lotes) {
    const { nome, vencimento } = l.res.pos;
    const ch = `${nome}|${vencimento}`;
    if (!porPapel.has(ch)) porPapel.set(ch, { nome, vencimento, comprado: 0, saldo: 0 });
    const p = porPapel.get(ch);
    p.comprado += l.original;
    p.saldo += l.restante;
  }
  const papeis = [...porPapel.values()]
    .sort((a, b) => a.nome.localeCompare(b.nome) || a.vencimento - b.vencimento);

  return `<section class="secao">
      <h2>Saldo por papel</h2>
      <p class="nota" style="margin-top:-.4rem;margin-bottom:.8rem">Confira com o
        extrato do Tesouro Direto ou da corretora. Se algum saldo estiver maior,
        falta registrar uma venda na planilha.</p>
      <div class="rolagemH"><table class="tabela"><thead><tr>
        <th>Título</th><th>Vencimento</th><th>Comprado</th><th>Vendido</th><th>Saldo</th>
      </tr></thead><tbody>${papeis.map((p) => `<tr${p.saldo <= 1e-9 ? ' class="zerado"' : ""}>
        <td>${p.nome}</td><td>${data(p.vencimento)}</td>
        <td>${num(p.comprado, 2)}</td><td>${num(p.comprado - p.saldo, 2)}</td>
        <td><b>${num(p.saldo, 2)}</b></td></tr>`).join("")}</tbody></table></div>
    </section>`;
}

function secaoVendas(vendas) {
  if (!vendas.length) return "";
  const soma = (c) => vendas.reduce((s, v) => s + v[c], 0);
  const linhaV = (v) => `<tr>
      <td>${data(v.dia)}</td><td>${v.titulo.replace("Tesouro ", "")} ${anoDe(v.vencimento)}</td>
      <td>${num(v.qtd, 4)}</td>
      <td>${brl(v.puVenda)}${v.informado ? "" : '<sup title="PU de venda publicado pelo Tesouro nesse dia">*</sup>'}</td>
      <td>${brl(v.recebido)}</td><td>${brl(v.custo)}</td>
      <td>${brl(v.recebido - v.custo)}</td><td>${brl(v.recebido - v.curva)}</td>
    </tr>`;
  return `<section class="secao">
      <h2>Vendas realizadas</h2>
      <div class="rolagemH"><table class="tabela"><thead><tr>
        <th>Data</th><th>Título</th><th>Qtd.</th><th>PU de venda</th><th>Recebido</th>
        <th>Custo (PEPS)</th><th>Resultado bruto</th><th>Ante a curva</th>
      </tr></thead><tbody>${vendas.map(linhaV).join("")}
        <tr class="total"><td>Total</td><td></td><td></td><td></td>
          <td>${brl(soma("recebido"))}</td><td>${brl(soma("custo"))}</td>
          <td>${brl(soma("recebido") - soma("custo"))}</td>
          <td>${brl(soma("recebido") - soma("curva"))}</td></tr>
      </tbody></table></div>
      <div class="prosa" style="margin-top:.9rem">
        <p>Cada venda sai primeiro das compras mais antigas do mesmo papel. O
          custo é o preço dessas compras; o resultado bruto não inclui cupons
          recebidos antes da venda nem imposto de renda.</p>
        <p><b>Ante a curva</b> compara o que entrou com o que aquelas unidades
          valiam na curva no dia: positivo é ágio capturado, negativo é deságio
          aceito. Sem a coluna <b>pu</b>, vale o PU de venda publicado pelo
          Tesouro naquele dia (marcado com *).</p>
      </div>
    </section>`;
}

// ------------------------------------------------------------ processamento

/** Reprecifica a planilha e desenha o resultado; devolve se houve posição. */
async function processar(texto, palco) {
  const saida = palco.querySelector("#saida");
  limparGraficos();
  saida.innerHTML = `<div class="carregando">Reprecificando as posições…</div>`;

  let entradas;
  try {
    entradas = lerCsv(texto);
  } catch (e) {
    saida.innerHTML = `<div class="aviso">Não consegui ler a planilha: ${e.message}</div>`;
    return false;
  }

  // A data vem como "data" ou, nas planilhas de antes das vendas, "data_compra".
  const cab = entradas[0] || {};
  const colData = ["data", "data_compra", "data_operacao"].find((c) => c in cab);
  if (!colData || !("titulo" in cab)) {
    saida.innerHTML =
      `<div class="aviso">A planilha precisa das colunas data e titulo.</div>`;
    return false;
  }
  if (!("quantidade" in cab) && !("valor_aplicado" in cab)) {
    saida.innerHTML =
      `<div class="aviso">Informe uma coluna quantidade ou valor_aplicado.</div>`;
    return false;
  }

  const problemas = [];
  const { lotes, vendas } = await montarLotes(entradas, colData, problemas);

  // Posição aberta: só o que sobrou de cada compra depois das vendas.
  const linhas = lotes.filter((l) => l.restante > 1e-9).map((lote) => {
    const { pos, serie } = lote.res;
    const n = serie.data.length - 1;
    const q = lote.restante;
    const pu = Number.isFinite(lote.puInf) ? lote.puInf : pos.puCompra;
    return {
      ...dadosDoLote(lote),
      taxa: pos.taxa, quantidade: q, original: lote.original, aplicado: pu * q,
      curva: serie.curvaCaixa[n] * q, mercado: serie.mercadoCaixa[n] * q,
      agio: serie.agio[n] * q, agioPct: serie.agioPct[n],
      vnaHoje: serie.vna[n],
    };
  });
  // Histórico: todas as compras, inclusive as já vendidas, até a venda.
  const todas = lotes.map(dadosDoLote);

  if (!lotes.length) {
    saida.innerHTML = avisos(problemas) +
      `<div class="aviso">Nenhuma linha pôde ser processada.</div>`;
    return false;
  }
  if (!linhas.length) {
    saida.innerHTML = `${avisos(problemas)}
      <div class="aviso">Nenhuma posição em aberto: tudo o que foi comprado já foi
        vendido.</div>
      ${secaoSaldo(lotes)}${secaoVendas(vendas)}`;
    return true;
  }

  const somar = (c) => linhas.reduce((s, l) => s + l[c], 0);
  const totAplicado = somar("aplicado");
  const totCurva = somar("curva");
  const totMercado = somar("mercado");
  const totAgio = totMercado - totCurva;

  saida.innerHTML = `
    ${avisos(problemas)}
    <section class="secao">
      <h2>Consolidado em ${info.ultimaDataBaseTexto}</h2>
      <dl class="cifras">
        <div><dt>Aplicado</dt><dd>${brl(totAplicado)}</dd></div>
        <div><dt>Na curva</dt><dd>${brl(totCurva)}</dd>
          <span class="delta ${totCurva >= totAplicado ? "sobe" : "desce"}">
            ${pct((totCurva / totAplicado - 1) * 100)}</span></div>
        <div><dt>A mercado</dt><dd>${brl(totMercado)}</dd>
          <span class="delta ${totMercado >= totAplicado ? "sobe" : "desce"}">
            ${pct((totMercado / totAplicado - 1) * 100)}</span></div>
        <div><dt>Ágio sobre a curva</dt><dd>${brl(totAgio)}</dd>
          <span class="delta ${totAgio >= 0 ? "sobe" : "desce"}">
            ${pct((totMercado / totCurva - 1) * 100)}</span></div>
      </dl>
    </section>

    ${secaoSaldo(lotes)}

    <section class="secao">
      <h2 id="tituloHist">Histórico: curva e mercado</h2>
      <div id="filtroHist"></div>
      <div class="periodos" id="periodos" role="group" aria-label="Período">
        ${PERIODOS.map(([rot], i) => `<button class="botao fraco" data-i="${i}"
          aria-pressed="${i === 0}">${rot}</button>`).join("")}
      </div>
      <div class="legenda" id="legHist"></div>
      <div class="grafico" id="grafHist"></div>
      <h3 class="subtitulo">Ágio sobre a curva, em reais</h3>
      <div class="grafico" id="grafAgio"></div>
      <details style="margin-top:1rem"><summary>Dia a dia</summary>
        <div class="rolagem rolagemH" id="tabHist" style="margin-top:.6rem"></div>
      </details>
      <p class="prosa" style="margin-top:.9rem">Soma de todas as posições em
        cada dia útil. Uma compra feita dentro do período entra na soma a partir
        do dia dela, o que dá um degrau nas duas linhas e no ágio em %, porque a
        base cresce. O ágio em reais quase não se mexe nesse dia — a compra nova
        nasce com ágio perto de zero —, e por isso é ele que vai no gráfico.</p>
    </section>

    <section class="secao">
      <h2>Fluxo de caixa futuro</h2>
      <p class="controle">
        <label for="inpCorrecao">Correção anual projetada dos indexados</label>
        <input type="number" id="inpCorrecao" value="0" step="0.5" min="-5" max="30"
          inputmode="decimal"> % a.a.
        <span class="nota">0 = valores de hoje</span>
      </p>
      <dl class="cifras" id="cifrasFluxo"></dl>
      <div class="legenda" id="legFluxo"></div>
      <div id="colunasFluxo"></div>
      <details style="margin-top:1rem"><summary>Ano a ano</summary>
        <div class="rolagem rolagemH" id="tabFluxo" style="margin-top:.6rem"></div>
      </details>
      <div class="prosa" style="margin-top:.9rem">
        <p>Pagamentos que ainda vão acontecer, somados por ano. Prefixado,
          Selic e IPCA+ sem juros pagam tudo no vencimento. Os títulos com juros
          semestrais pagam cupom sobre o principal inteiro a cada seis meses e
          devolvem o principal só no vencimento — o principal não diminui no
          caminho. RendA+ e Educa+ devolvem o principal em parcelas mensais
          iguais (240 e 60), que já vêm corrigidas pelo IPCA.</p>
        <p>O valor futuro dos títulos atrelados a IPCA, IGP-M e Selic depende
          do índice até lá, que ninguém sabe. Com correção zero, eles aparecem
          pelo valor de hoje (o VNA mais recente); com uma correção, o VNA cresce
          a essa taxa até cada pagamento. Os prefixados não mudam: o valor deles
          já é fixo em reais. Valores brutos, sem imposto de renda.</p>
      </div>
    </section>

    <section class="secao">
      <h2>Ágio por compra</h2>
      ${barras(linhas)}
      <p class="prosa" style="margin-top:.9rem">Cada barra é uma compra, não um
        título: o mesmo papel adquirido em datas diferentes trava taxas
        diferentes e por isso aparece mais de uma vez, podendo inclusive ficar
        de lados opostos do zero. Clique numa barra para ver no histórico só
        aquele papel, com todas as compras dele.</p>
    </section>

    <section class="secao">
      <h2>Posição a posição</h2>
      <div class="rolagem rolagemH">${tabela(linhas)}</div>
      <p style="margin-top:.9rem">
        <button class="botao fraco" id="btnCsv">Baixar resultado em CSV</button>
      </p>
    </section>

    ${secaoVendas(vendas)}`;

  saida.querySelector("#btnCsv").onclick = () => baixarCsv(linhas);

  // O histórico pode ser filtrado por papel (título + vencimento) clicando
  // numa barra do ágio por compra; clicar de novo, ou no botão, desfaz.
  let periodo = 0, filtro = null;
  const botoes = [...saida.querySelectorAll("#periodos button")];
  const caixaFiltro = saida.querySelector("#filtroHist");

  const mostrar = () => {
    botoes.forEach((b, k) => b.setAttribute("aria-pressed", String(k === periodo)));
    const usadas = filtro ? linhas.filter((l) => chaveDe(l) === filtro) : linhas;
    const doHist = filtro ? todas.filter((l) => chaveDe(l) === filtro) : todas;
    desenharHistorico(saida, historico(doHist, PERIODOS[periodo][1]));
    desenharFluxo(saida, projetarFluxo(usadas, correcao()));

    for (const el of saida.querySelectorAll(".barras .linha")) {
      const sel = el.dataset.chave === filtro;
      el.setAttribute("aria-pressed", String(sel));
      el.classList.toggle("apagada", filtro != null && !sel);
    }
    if (!filtro) { caixaFiltro.innerHTML = ""; return; }
    const l = usadas[0];
    caixaFiltro.innerHTML = `<div class="salva">
        <span>Só <b>${l.titulo} ${anoDe(l.vencimento)}</b>
          <span class="nota">· vence em ${data(l.vencimento)} · ${doHist.length}
          ${doHist.length === 1 ? "compra" : "compras"}</span></span>
        <button class="botao fraco" id="btnTodas">Mostrar a carteira toda</button>
      </div>`;
    caixaFiltro.querySelector("#btnTodas").onclick = () => { filtro = null; mostrar(); };
  };

  botoes.forEach((b, i) => { b.onclick = () => { periodo = i; mostrar(); }; });

  const inpCorrecao = saida.querySelector("#inpCorrecao");
  const correcao = () => {
    const v = Number(String(inpCorrecao.value).replace(",", "."));
    return Number.isFinite(v) ? v : 0;
  };
  inpCorrecao.addEventListener("input", () => {
    const usadas = filtro ? linhas.filter((l) => chaveDe(l) === filtro) : linhas;
    desenharFluxo(saida, projetarFluxo(usadas, correcao()));
  });

  const escolher = (linha) => {
    if (!linha) return;
    filtro = filtro === linha.dataset.chave ? null : linha.dataset.chave;
    mostrar();
    saida.querySelector("#tituloHist").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const listaBarras = saida.querySelector(".barras");
  listaBarras.addEventListener("click", (e) => escolher(e.target.closest(".linha")));
  listaBarras.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    escolher(e.target.closest(".linha"));
  });

  mostrar();
  return true;
}

const chaveDe = (l) => `${l.titulo}|${l.vencimento}`;

// ------------------------------------------------------------ fluxo futuro

const PARTES = [
  { chave: "principal", rotulo: "Principal no vencimento", cor: "curva" },
  { chave: "cupons", rotulo: "Cupons semestrais", cor: "ipca" },
  { chave: "renda", rotulo: "Parcelas mensais (RendA+ e Educa+)", cor: "igpm" },
];

/**
 * Pagamentos futuros da carteira, por ano.
 *
 * Usa os mesmos fluxos contratuais da precificação (fração do VNA em cada
 * data) vezes a quantidade e o VNA. O VNA de hoje é o último conhecido; para
 * os indexados ele cresce à correção informada, e nos prefixados fica fixo.
 * O pagamento final dos títulos com cupom é separado em cupom e principal.
 */
function projetarFluxo(linhas, correcaoAa) {
  const hoje = info.ultimaDataBase;
  const porAno = new Map();
  const tot = { principal: 0, cupons: 0, renda: 0, total: 0, prox12: 0, ultimo: null };

  for (const l of linhas) {
    const fam = classificar(l.titulo);
    const indexado = INDEXADOR[fam] !== "prefixado";
    const fl = fluxos(cal, l.titulo, l.vencimento);
    const semCupom = fam === LTN || fam === LFT || fam === NTNB_P;

    fl.forEach(([dia, v], i) => {
      if (dia <= hoje) return;
      const anos = (dia - hoje) / 365.25;
      const vna = l.vnaHoje * (indexado ? Math.pow(1 + correcaoAa / 100, anos) : 1);
      const fator = vna * l.quantidade;

      const partes = { principal: 0, cupons: 0, renda: 0 };
      if (fam === NTNB1) partes.renda = v * fator;
      else if (semCupom) partes.principal = v * fator;
      else {
        const ultimo = i === fl.length - 1;
        partes.principal = (ultimo ? 1 : 0) * fator;
        partes.cupons = (v - (ultimo ? 1 : 0)) * fator;
      }

      const ano = new Date(dia * 86400000).getUTCFullYear();
      if (!porAno.has(ano)) porAno.set(ano, { principal: 0, cupons: 0, renda: 0 });
      const acc = porAno.get(ano);
      for (const k of Object.keys(partes)) { acc[k] += partes[k]; tot[k] += partes[k]; }
      const soma = partes.principal + partes.cupons + partes.renda;
      tot.total += soma;
      if (dia - hoje <= 365) tot.prox12 += soma;
      if (tot.ultimo == null || dia > tot.ultimo) tot.ultimo = dia;
    });
  }

  // Anos sem pagamento entram zerados, para o eixo não pular anos.
  const anos = [...porAno.keys()].sort((a, b) => a - b);
  const linhasAno = [];
  for (let a = anos[0]; anos.length && a <= anos[anos.length - 1]; a++) {
    const v = porAno.get(a) || { principal: 0, cupons: 0, renda: 0 };
    linhasAno.push({ ano: a, ...v, total: v.principal + v.cupons + v.renda });
  }
  return { anos: linhasAno, tot, correcaoAa };
}

function desenharFluxo(saida, f) {
  const { anos, tot } = f;
  const cifras = saida.querySelector("#cifrasFluxo");
  const colunas = saida.querySelector("#colunasFluxo");
  if (!anos.length) {
    cifras.innerHTML = "";
    saida.querySelector("#legFluxo").innerHTML = "";
    colunas.innerHTML = `<p class="nota">Nenhum pagamento futuro: tudo já venceu.</p>`;
    saida.querySelector("#tabFluxo").innerHTML = "";
    return;
  }

  cifras.innerHTML = `
    <div><dt>A receber até o fim</dt><dd>${brl(tot.total)}</dd></div>
    <div><dt>Nos próximos 12 meses</dt><dd>${brl(tot.prox12)}</dd></div>
    <div><dt>Último pagamento</dt><dd>${data(tot.ultimo)}</dd></div>`;

  const usadas = PARTES.filter((p) => tot[p.chave] > 0);
  desenharLegenda(saida.querySelector("#legFluxo"), usadas);

  const max = Math.max(...anos.map((a) => a.total));
  const passo = Math.ceil(anos.length / 12);
  colunas.innerHTML = `<div class="colunas">
      <span class="topo">${brl(max)}</span>
      ${anos.map((a, i) => `<div class="coluna" title="${a.ano}: ${brl(a.total)}${
        usadas.map((p) => `\n${p.rotulo}: ${brl(a[p.chave])}`).join("")}">
        ${usadas.map((p) => `<span style="height:${(a[p.chave] / max * 100).toFixed(2)}%;background:var(--${p.cor})"></span>`).join("")}
        <em>${i % passo === 0 ? a.ano : ""}</em>
      </div>`).join("")}
    </div>`;

  saida.querySelector("#tabFluxo").innerHTML = `<table class="tabela"><thead><tr>
      <th>Ano</th>${usadas.map((p) => `<th>${p.rotulo}</th>`).join("")}<th>Total</th>
    </tr></thead><tbody>${anos.filter((a) => a.total > 0).map((a) => `<tr>
      <td>${a.ano}</td>${usadas.map((p) => `<td>${brl(a[p.chave])}</td>`).join("")}
      <td>${brl(a.total)}</td></tr>`).join("")}</tbody></table>`;
}
const anoDe = (dia) => new Date(dia * 86400000).getUTCFullYear();

// ---------------------------------------------------------------- histórico

/**
 * Soma curva e mercado de todas as posições em cada dia útil da janela.
 *
 * Cada posição contribui a partir do dia da compra. Se faltar o preço de um
 * papel num dia, repete o último valor dele, para a soma não afundar por um
 * buraco na série; depois do vencimento, o último valor (já em caixa) fica.
 */
function historico(linhas, diasCorridos) {
  const ultimo = info.ultimaDataBase;
  const primeira = Math.min(...linhas.map((l) => l.compra));
  const desde = diasCorridos == null ? primeira : Math.max(primeira, ultimo - diasCorridos);

  const dias = [...new Set(linhas.flatMap((l) =>
    l.serie.dias.filter((d) => d >= desde && d <= ultimo)))].sort((a, b) => a - b);

  const curva = new Array(dias.length).fill(0);
  const mercado = new Array(dias.length).fill(0);

  for (const l of linhas) {
    const s = l.serie;
    let j = 0, c = null, m = null;
    for (let k = 0; k < dias.length; k++) {
      while (j < s.dias.length && s.dias[j] <= dias[k]) {
        c = s.curva[j]; m = s.mercado[j]; j++;
      }
      if (c != null) { curva[k] += c; mercado[k] += m; }
    }
  }

  const agio = mercado.map((v, k) => v - curva[k]);
  const agioPct = mercado.map((v, k) => (curva[k] ? (v / curva[k] - 1) * 100 : null));
  return { dias, curva, mercado, agio, agioPct };
}

function desenharHistorico(saida, h) {
  limparGraficos();
  const x = h.dias.map(paraSegundos);
  const linhasValor = [
    { rotulo: "Na curva", cor: "curva", valores: h.curva },
    { rotulo: "A mercado", cor: "mercado", valores: h.mercado },
  ];
  desenharLegenda(saida.querySelector("#legHist"), linhasValor);
  graficos.push(desenharLinhas(saida.querySelector("#grafHist"), x, linhasValor,
    { altura: 300 }));
  graficos.push(desenharLinhas(saida.querySelector("#grafAgio"), x,
    [{ rotulo: "Ágio", cor: "mercado", valores: h.agio }],
    { altura: 180 }));

  const n = h.dias.length;
  saida.querySelector("#tabHist").innerHTML = `<table class="tabela"><thead><tr>
      <th>Dia</th><th>Na curva</th><th>A mercado</th><th>Ágio</th><th>Ágio %</th>
    </tr></thead><tbody>${Array.from({ length: n }, (_, i) => n - 1 - i).map((k) => `<tr>
      <td>${data(h.dias[k])}</td><td>${brl(h.curva[k])}</td><td>${brl(h.mercado[k])}</td>
      <td>${brl(h.agio[k])}</td><td>${pct(h.agioPct[k])}</td>
    </tr>`).join("")}</tbody></table>`;
}

function avisos(problemas) {
  if (!problemas.length) return "";
  const linhaDe = (p) => Number((p.match(/^linha (\d+)/) || [])[1]) || 0;
  problemas = [...problemas].sort((a, b) => linhaDe(a) - linhaDe(b));
  const n = problemas.length;
  return `<section class="secao"><h2>${n} ${n === 1 ? "linha" : "linhas"}
    com problema</h2>${problemas.map((p) =>
      `<div class="aviso">${p}</div>`).join("")}</section>`;
}

/**
 * Barras de ágio por compra. O zero fica no meio só quando há barras dos dois
 * lados; se todas forem negativas (ou todas positivas), ele vai para a borda
 * e as barras usam a largura toda. Em qualquer caso a barra mais longa deixa
 * espaço para o rótulo de %, que assim nunca invade o nome do título.
 */
function barras(linhas) {
  const maxAbs = Math.max(...linhas.map((l) => Math.abs(l.agioPct)), 0.5);
  const ordenadas = [...linhas].sort((a, b) => b.agioPct - a.agioPct);
  const temPos = linhas.some((l) => l.agioPct > 0);
  const temNeg = linhas.some((l) => l.agioPct < 0);
  const zero = temPos && temNeg ? 50 : temNeg ? 100 : 0;
  const ROTULO = "4.8rem";

  return `<div class="barras" style="--zero:${zero}%">${ordenadas.map((l) => {
    const f = Math.abs(l.agioPct) / maxAbs;
    const pos = l.agioPct >= 0;
    const lado = pos ? 100 - zero : zero;
    const larg = `calc((${lado}% - ${ROTULO}) * ${f.toFixed(4)})`;
    const rotulo = `${l.titulo.replace("Tesouro ", "")} ${anoDe(l.vencimento)}` +
      ` · ${data(l.compra)}`;
    return `<div class="linha" role="button" tabindex="0" aria-pressed="false"
        data-chave="${chaveDe(l)}">
      <span title="${rotulo}">${rotulo}</span>
      <span class="trilhoBarra">
        <span class="barra${pos ? " pos" : ""}" style="${pos
          ? `left:${zero}%;width:${larg}`
          : `right:${100 - zero}%;width:${larg}`}"></span>
        <span class="valor" style="${pos
          ? `left:calc(${zero}% + ${larg} + 6px)`
          : `right:calc(${100 - zero}% + ${larg} + 6px)`}">${pct(l.agioPct)}</span>
      </span></div>`;
  }).join("")}</div>`;
}

function tabela(linhas) {
  return `<table class="tabela"><thead><tr>
      <th>Título</th><th>Vencimento</th><th>Compra</th><th>Taxa</th>
      <th>Qtd.</th><th>Aplicado</th><th>Na curva</th><th>A mercado</th>
      <th>Ágio</th><th>Ágio %</th>
    </tr></thead><tbody>${linhas.map((l) => `<tr>
      <td>${l.titulo}</td><td>${data(l.vencimento)}</td><td>${data(l.compra)}</td>
      <td>${num(l.taxa, 2)}</td><td>${num(l.quantidade, 4)}${
        l.original - l.quantidade > 1e-9
          ? ` <span class="nota">de ${num(l.original, 4)}</span>` : ""}</td>
      <td>${brl(l.aplicado)}</td><td>${brl(l.curva)}</td><td>${brl(l.mercado)}</td>
      <td>${brl(l.agio)}</td><td>${pct(l.agioPct)}</td>
    </tr>`).join("")}</tbody></table>`;
}

function baixarCsv(linhas) {
  const cab = ["titulo", "vencimento", "compra", "taxa", "quantidade",
               "aplicado", "na_curva", "a_mercado", "agio", "agio_pct"];
  const br = (v) => String(v).replace(".", ",");
  const corpo = linhas.map((l) => [
    l.titulo, data(l.vencimento), data(l.compra), br(l.taxa.toFixed(2)),
    br(l.quantidade.toFixed(4)), br(l.aplicado.toFixed(2)),
    br(l.curva.toFixed(2)), br(l.mercado.toFixed(2)),
    br(l.agio.toFixed(2)), br(l.agioPct.toFixed(2)),
  ].join(";"));
  const url = URL.createObjectURL(new Blob(
    ["﻿" + [cab.join(";"), ...corpo].join("\n")],
    { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "carteira_agio.csv"; a.click();
  URL.revokeObjectURL(url);
}
