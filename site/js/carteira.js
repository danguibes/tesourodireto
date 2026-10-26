/** Tela de carteira: importa uma planilha de compras e consolida o ágio. */

import { simular, diaDeTexto, classificar } from "./tesouro.js";
import * as D from "./dados.js";
import { brl, num, pct, data, inteiro, paraSegundos } from "./formato.js";
import { desenharLinhas, desenharLegenda } from "./grafico.js";

const MODELO =
  "data_compra;titulo;quantidade;vencimento;pu_compra\n" +
  "30/01/2023;Tesouro IPCA+ 2035;1,5;;\n" +
  "15/06/2024;Tesouro Prefixado 2029;10;;\n" +
  "02/09/2025;Tesouro Renda+ Aposentadoria Extra 2030;4,2;;\n";

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
      <h2>Planilha de compras</h2>
      <p class="nota">Três colunas bastam: <b>data_compra</b>, <b>titulo</b> e
        <b>quantidade</b>. O título pode vir como aparece na corretora.</p>
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
      <p>Suba uma planilha com as suas compras e veja o ágio ou deságio de cada
         posição na data mais recente disponível.</p>
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
          <p>Obrigatórias: <b>data_compra</b>, <b>titulo</b> e
            <b>quantidade</b>. Em vez de quantidade você pode informar
            <b>valor_aplicado</b> em reais.</p>
          <p>O ano no nome do RendA+ e do Educa+ é o da conversão, e o site já
            traduz para o vencimento real: RendA+ 2030 vence em 15/12/2049,
            Educa+ 2026 em 15/12/2030.</p>
          <p>Duas colunas opcionais cobrem casos específicos.
            <b>vencimento</b> é necessária quando o ano sozinho é ambíguo, como
            no Tesouro IPCA+ 2026, que vence em maio e em agosto.
            <b>pu_compra</b> é o preço que você realmente pagou; sem ela, o site
            usa o preço de abertura publicado naquele dia.</p>
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

function marcarSalva(palco, salva) {
  const alvo = palco.querySelector("#salva");
  if (!alvo || !salva) return;
  const quando = new Date(salva.em).toLocaleDateString("pt-BR");
  alvo.innerHTML = `<div class="salva">
      <span>Carteira lembrada neste navegador: <b>${escapar(salva.nome)}</b>,
        enviada em ${quando}. A planilha não sai do seu computador.</span>
      <button class="botao fraco" id="btnEsquecer">Esquecer</button>
    </div>`;
  alvo.querySelector("#btnEsquecer").onclick = () => {
    esquecer();
    limparGraficos();
    alvo.innerHTML = "";
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

  const faltando = ["data_compra", "titulo"]
    .filter((c) => !(c in (entradas[0] || {})));
  if (faltando.length) {
    saida.innerHTML =
      `<div class="aviso">A planilha precisa das colunas: ${faltando.join(", ")}.</div>`;
    return false;
  }
  if (!("quantidade" in entradas[0]) && !("valor_aplicado" in entradas[0])) {
    saida.innerHTML =
      `<div class="aviso">Informe uma coluna quantidade ou valor_aplicado.</div>`;
    return false;
  }

  const linhas = [], problemas = [];

  for (let i = 0; i < entradas.length; i++) {
    const e = entradas[i];
    const rot = `linha ${i + 2}`;

    let diaCompra;
    try {
      diaCompra = diaDeTexto(e.data_compra);
    } catch {
      problemas.push(`${rot}: data de compra inválida (“${e.data_compra}”)`);
      continue;
    }

    let venc = null;
    if (e.vencimento) {
      try { venc = diaDeTexto(e.vencimento); } catch { venc = null; }
    }

    const achado = D.resolverTitulo(lista, e.titulo, venc);
    if (!achado.papel) { problemas.push(`${rot}: ${achado.erro}`); continue; }

    const qtd = numeroBr(e.quantidade);
    const val = numeroBr(e.valor_aplicado);
    if (!Number.isFinite(qtd) && !Number.isFinite(val)) {
      problemas.push(`${rot}: sem quantidade nem valor aplicado`);
      continue;
    }

    let res;
    try {
      const dados = await D.papel(achado.papel.id);
      res = simular(cal, dados, diaCompra,
        Number.isFinite(qtd) ? { quantidade: qtd } : { valorAplicado: val });
    } catch (err) {
      problemas.push(`${rot}: ${err.message}`);
      continue;
    }

    const { pos, serie } = res;
    const n = serie.data.length - 1;
    const puInf = numeroBr(e.pu_compra);
    const aplicado = Number.isFinite(puInf) ? puInf * pos.quantidade : pos.aplicado;

    linhas.push({
      titulo: pos.nome, vencimento: pos.vencimento, compra: pos.diaCompra,
      taxa: pos.taxa, quantidade: pos.quantidade, aplicado,
      curva: serie.curvaCaixa[n], mercado: serie.mercadoCaixa[n],
      agio: serie.agio[n], agioPct: serie.agioPct[n],
      serie: { dias: serie.data, curva: serie.curvaCaixa, mercado: serie.mercadoCaixa },
    });
  }

  if (!linhas.length) {
    saida.innerHTML = avisos(problemas) +
      `<div class="aviso">Nenhuma linha pôde ser processada.</div>`;
    return false;
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

    <section class="secao">
      <h2>Histórico: curva e mercado</h2>
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
      <h2>Ágio por compra</h2>
      ${barras(linhas)}
      <p class="prosa" style="margin-top:.9rem">Cada barra é uma compra, não um
        título: o mesmo papel adquirido em datas diferentes trava taxas
        diferentes e por isso aparece mais de uma vez, podendo inclusive ficar
        de lados opostos do zero.</p>
    </section>

    <section class="secao">
      <h2>Posição a posição</h2>
      <div class="rolagem rolagemH">${tabela(linhas)}</div>
      <p style="margin-top:.9rem">
        <button class="botao fraco" id="btnCsv">Baixar resultado em CSV</button>
      </p>
    </section>`;

  saida.querySelector("#btnCsv").onclick = () => baixarCsv(linhas);

  const botoes = [...saida.querySelectorAll("#periodos button")];
  const mostrar = (i) => {
    botoes.forEach((b, k) => b.setAttribute("aria-pressed", String(k === i)));
    desenharHistorico(saida, historico(linhas, PERIODOS[i][1]));
  };
  botoes.forEach((b, i) => { b.onclick = () => mostrar(i); });
  mostrar(0);
  return true;
}

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
  const n = problemas.length;
  return `<section class="secao"><h2>${n} ${n === 1 ? "linha" : "linhas"}
    com problema</h2>${problemas.map((p) =>
      `<div class="aviso">${p}</div>`).join("")}</section>`;
}

function barras(linhas) {
  const maxAbs = Math.max(...linhas.map((l) => Math.abs(l.agioPct)), 0.5);
  const ordenadas = [...linhas].sort((a, b) => b.agioPct - a.agioPct);

  return `<div class="barras">${ordenadas.map((l) => {
    const larg = Math.abs(l.agioPct) / maxAbs * 50;
    const pos = l.agioPct >= 0;
    const rotulo = `${l.titulo.replace("Tesouro ", "")} ` +
      `${new Date(l.vencimento * 86400000).getUTCFullYear()} · ${data(l.compra)}`;
    return `<div class="linha">
      <span title="${rotulo}">${rotulo}</span>
      <span class="trilhoBarra">
        <span class="barra${pos ? " pos" : ""}" style="${
          pos ? `left:50%;width:${larg}%` : `right:50%;width:${larg}%`}"></span>
        <span class="valor" style="${pos
          ? `left:calc(50% + ${larg}% + 6px)`
          : `right:calc(50% + ${larg}% + 6px)`}">${pct(l.agioPct)}</span>
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
      <td>${num(l.taxa, 2)}</td><td>${num(l.quantidade, 4)}</td>
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
