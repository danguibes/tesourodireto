/**
 * Tesouro Direto — último preço e taxa de cada título, a partir do site.
 *
 * FONTE: Tesouro Transparente (Tesouro Nacional), conjunto de dados
 * "Taxas dos Títulos Ofertados pelo Tesouro Direto", licença aberta ODbL.
 *
 * POR QUE NÃO LÊ MAIS O PORTAL
 * Desde outubro de 2026 o portal do Tesouro Transparente responde aos
 * servidores do Google (e a qualquer script) com uma página de desafio em
 * JavaScript no lugar do CSV. O arquivo agora é baixado no navegador e
 * publicado em https://danguibes.github.io/tesourodireto/, que o Google lê
 * sem problema. Este script lê de lá o dados/ultimo_dia.csv e REESCREVE a aba
 * com os títulos do dia mais recente — uma linha por título, sem histórico.
 *
 * OBSERVAÇÕES IMPORTANTES
 *  - Os preços são os de ABERTURA do dia útil ("Manhã"), não intradiários.
 *  - O arquivo costuma ter 1 dia útil de defasagem, e o site só se atualiza
 *    quando o CSV é publicado (ver o LEIA-ME-PAGES.md do repositório).
 *  - "PU Venda" é o preço pelo qual o INVESTIDOR VENDE, ou seja, o valor
 *    de resgate antecipado. "PU Compra" é o preço de aplicação.
 *
 * COMO USAR
 *  1. Extensões > Apps Script, substitua o código antigo por este e salve.
 *  2. Rode "atualizarTesouro" (pede autorização da conta na primeira vez).
 *  3. Rode "criarGatilhoDiario" uma vez, para automatizar. Ele apaga o
 *     gatilho antigo antes de criar o novo.
 */

const URL_ULTIMO_DIA = 'https://danguibes.github.io/tesourodireto/dados/ultimo_dia.csv';
const CABECALHO_FONTE =
  'Data base;Titulo;Vencimento;Taxa de compra;Taxa de venda;PU de compra;PU de venda';

const NOME_ABA = 'Resgate';
const FUSO = 'America/Sao_Paulo';
const CABECALHO = [
  'Data base',
  'Título',
  'Vencimento',
  'Taxa de compra (% a.a.)',
  'Taxa de venda / resgate (% a.a.)',
  'PU de compra (R$)',
  'PU de venda / resgate (R$)',
  'Coletado em'
];


/** Função principal: troca o conteúdo da aba pelos títulos do último dia. */
function atualizarTesouro() {
  const linhas = baixarUltimoDia_();
  if (!linhas.length) {
    throw new Error('O arquivo do site veio sem nenhum título.');
  }

  const agora = new Date();
  const valores = linhas.map(function (l) {
    return [
      l.dataBase, l.titulo, l.vencimento,
      l.taxaCompra, l.taxaVenda,
      l.puCompra, l.puVenda,
      agora
    ];
  });

  const aba = obterAba_();
  // Limpa só o corpo da tabela, para não apagar o que houver ao lado dela.
  if (aba.getLastRow() > 1) {
    aba.getRange(2, 1, aba.getLastRow() - 1, CABECALHO.length).clearContent();
  }

  const n = valores.length;
  aba.getRange(2, 1, n, CABECALHO.length).setValues(valores);
  aba.getRange(2, 1, n, 1).setNumberFormat('dd/mm/yyyy');
  aba.getRange(2, 3, n, 1).setNumberFormat('dd/mm/yyyy');
  aba.getRange(2, 4, n, 2).setNumberFormat('#,##0.00');
  aba.getRange(2, 6, n, 2).setNumberFormat('#,##0.00');
  aba.getRange(2, 8, n, 1).setNumberFormat('dd/mm/yyyy hh:mm');

  Logger.log(n + ' títulos gravados, data base ' +
             Utilities.formatDate(linhas[0].dataBase, FUSO, 'dd/MM/yyyy') + '.');
}


/** Baixa o ultimo_dia.csv do site e devolve as linhas já convertidas. */
function baixarUltimoDia_() {
  const resposta = UrlFetchApp.fetch(URL_ULTIMO_DIA, { muteHttpExceptions: true });
  const codigo = resposta.getResponseCode();
  if (codigo !== 200) {
    throw new Error('O site respondeu com código HTTP ' + codigo + '.');
  }

  const linhas = resposta.getContentText('UTF-8').replace(/^﻿/, '')
    .split(/\r?\n/).filter(function (l) { return l.trim(); });

  // Falha de propósito se o formato mudar, em vez de gravar colunas trocadas.
  if (linhas[0].trim() !== CABECALHO_FONTE) {
    throw new Error('O cabeçalho do arquivo mudou: ' + linhas[0]);
  }

  return linhas.slice(1).map(function (linha) {
    const c = linha.split(';');
    return {
      dataBase: paraData_(c[0]),
      titulo: c[1].trim(),
      vencimento: paraData_(c[2]),
      taxaCompra: paraNumero_(c[3]),
      taxaVenda: paraNumero_(c[4]),
      puCompra: paraNumero_(c[5]),
      puVenda: paraNumero_(c[6])
    };
  });
}


/** "3486,38" ou "7,53" -> número. O site não usa separador de milhar. */
function paraNumero_(valor) {
  if (valor === undefined || valor === null) return '';
  const n = parseFloat(String(valor).trim().replace(',', '.'));
  return isNaN(n) ? '' : n;
}


/** "15/08/2040" -> objeto Date */
function paraData_(valor) {
  const p = String(valor).trim().split('/');
  if (p.length !== 3) throw new Error('Data inválida no arquivo: ' + valor);
  return new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]));
}


/** Devolve a aba de destino, criando-a com cabeçalho se ainda não existir. */
function obterAba_() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  let aba = planilha.getSheetByName(NOME_ABA);

  if (!aba) aba = planilha.insertSheet(NOME_ABA);

  if (aba.getLastRow() === 0) {
    aba.appendRow(CABECALHO);
    aba.getRange(1, 1, 1, CABECALHO.length)
       .setFontWeight('bold')
       .setBackground('#1f4e78')
       .setFontColor('#ffffff')
       .setWrap(true);
    aba.setFrozenRows(1);
    aba.setColumnWidth(2, 300);
  }
  return aba;
}


/** Agenda a execução automática, todo dia entre 20h e 21h. */
function criarGatilhoDiario() {
  ScriptApp.getProjectTriggers().forEach(function (g) {
    if (g.getHandlerFunction() === 'atualizarTesouro') ScriptApp.deleteTrigger(g);
  });

  ScriptApp.newTrigger('atualizarTesouro')
    .timeBased()
    .atHour(20)
    .everyDays(1)
    .inTimezone(FUSO)
    .create();

  Logger.log('Gatilho diário criado (20h, horário de Brasília).');
}
