/**
 * Tesouro Direto — coleta diária de preços e taxas, a partir do site.
 *
 * FONTE: Tesouro Transparente (Tesouro Nacional), conjunto de dados
 * "Taxas dos Títulos Ofertados pelo Tesouro Direto", licença aberta ODbL.
 *
 * POR QUE NÃO LÊ MAIS O PORTAL
 * Desde outubro de 2026 o portal do Tesouro Transparente responde aos
 * servidores do Google (e a qualquer script) com uma página de desafio em
 * JavaScript no lugar do CSV. O arquivo agora é baixado no navegador e
 * publicado em https://danguibes.github.io/tesourodireto/, que o Google lê
 * sem problema. Este script lê de lá:
 *
 *   dados/recentes.csv   os últimos 30 dias úteis, todos os títulos
 *
 * Por isso ele PREENCHE OS BURACOS: se ficou dias sem rodar (ou se o site
 * ficou dias sem atualizar), grava todas as datas base que faltam, até 30
 * dias úteis para trás. Não grava a mesma data base duas vezes.
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
 *  2. Rode "testarConexao" — confirma acesso e mostra a data mais recente.
 *  3. Rode "atualizarTesouro" (pede autorização da conta na primeira vez).
 *  4. Rode "criarGatilhoDiario" uma vez, para automatizar. Ele apaga o
 *     gatilho antigo antes de criar o novo.
 */

const URL_RECENTES = 'https://danguibes.github.io/tesourodireto/dados/recentes.csv';
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


/** Função principal: grava na aba todas as datas base que ainda faltam. */
function atualizarTesouro() {
  const linhas = baixarRecentes_();
  if (!linhas.length) {
    throw new Error('O arquivo do site veio sem nenhum título.');
  }

  const aba = obterAba_();
  const jaTem = datasRegistradas_(aba);
  const novas = linhas.filter(function (l) { return !jaTem[chave_(l.dataBase)]; });

  if (!novas.length) {
    Logger.log('Nenhuma data base nova. A mais recente no site é ' +
               texto_(linhas[linhas.length - 1].dataBase) + '.');
    return;
  }

  const agora = new Date();
  const valores = novas.map(function (l) {
    return [
      l.dataBase, l.titulo, l.vencimento,
      l.taxaCompra, l.taxaVenda,
      l.puCompra, l.puVenda,
      agora
    ];
  });

  const inicio = aba.getLastRow() + 1;
  aba.getRange(inicio, 1, valores.length, CABECALHO.length).setValues(valores);
  aba.getRange(inicio, 1, valores.length, 1).setNumberFormat('dd/mm/yyyy');
  aba.getRange(inicio, 3, valores.length, 1).setNumberFormat('dd/mm/yyyy');
  aba.getRange(inicio, 4, valores.length, 2).setNumberFormat('#,##0.0000');
  aba.getRange(inicio, 6, valores.length, 2).setNumberFormat('#,##0.00');
  aba.getRange(inicio, 8, valores.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');

  const datas = {};
  novas.forEach(function (l) { datas[texto_(l.dataBase)] = true; });
  Logger.log(valores.length + ' linhas gravadas, ' + Object.keys(datas).length +
             ' data(s) base: ' + Object.keys(datas).join(', ') + '.');
}


/** Baixa o recentes.csv do site e devolve as linhas já convertidas. */
function baixarRecentes_() {
  const resposta = UrlFetchApp.fetch(URL_RECENTES, { muteHttpExceptions: true });
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


/** "1234,56" ou "7,53" -> número. O site não usa separador de milhar. */
function paraNumero_(valor) {
  if (valor === undefined || valor === null) return '';
  const n = parseFloat(String(valor).trim().replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? '' : n;
}


/** "15/08/2040" -> objeto Date */
function paraData_(valor) {
  const p = String(valor).trim().split('/');
  if (p.length !== 3) throw new Error('Data inválida no arquivo: ' + valor);
  return new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]));
}


function texto_(data) {
  return Utilities.formatDate(data, FUSO, 'dd/MM/yyyy');
}


/** Chave de comparação de datas: aceita Date ou texto dd/mm/aaaa da planilha. */
function chave_(v) {
  return (v instanceof Date) ? texto_(v) : String(v).trim();
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


/** Conjunto das datas base já gravadas na aba (coluna A). */
function datasRegistradas_(aba) {
  const ultima = aba.getLastRow();
  const vistas = {};
  if (ultima < 2) return vistas;
  aba.getRange(2, 1, ultima - 1, 1).getValues().forEach(function (linha) {
    if (linha[0]) vistas[chave_(linha[0])] = true;
  });
  return vistas;
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


/** Diagnóstico: testa o acesso sem escrever nada na planilha. */
function testarConexao() {
  const linhas = baixarRecentes_();
  const datas = {};
  linhas.forEach(function (l) { datas[texto_(l.dataBase)] = true; });
  const lista = Object.keys(datas);
  Logger.log(linhas.length + ' linhas, ' + lista.length + ' dias úteis, de ' +
             lista[0] + ' a ' + lista[lista.length - 1] + '.');
}
