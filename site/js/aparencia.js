/**
 * Tamanho do texto e tema claro/escuro, lembrados por navegador.
 *
 * A primeira aplicação acontece num script no <head> do index.html, antes do
 * CSS, para a página não piscar no tamanho ou na cor errados. Este módulo só
 * liga os botões e grava as escolhas.
 */

const CHAVE = "tesourodireto.aparencia.v1";
const ESCALAS = [0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
const raiz = document.documentElement;
const escuroNoSistema = matchMedia("(prefers-color-scheme: dark)");

function ler() {
  try { return JSON.parse(localStorage.getItem(CHAVE)) || {}; } catch { return {}; }
}

function gravar(a) {
  try { localStorage.setItem(CHAVE, JSON.stringify(a)); } catch { /* só não lembra */ }
}

const escolha = ler();

function escalaAtual() {
  return ESCALAS.includes(escolha.escala) ? escolha.escala : 1;
}

function temaAtual() {
  return escolha.tema || (escuroNoSistema.matches ? "escuro" : "claro");
}

function aplicar() {
  const e = escalaAtual();
  raiz.style.setProperty("--escala", e);
  if (escolha.tema) raiz.dataset.tema = escolha.tema;
  else delete raiz.dataset.tema;
  pintarBotoes();
  document.dispatchEvent(new Event("aparencia"));
}

let menos, atual, mais, tema;

function pintarBotoes() {
  if (!menos) return;
  const i = ESCALAS.indexOf(escalaAtual());
  menos.disabled = i === 0;
  mais.disabled = i === ESCALAS.length - 1;
  atual.textContent = `${Math.round(escalaAtual() * 100)}%`;
  const escuro = temaAtual() === "escuro";
  tema.textContent = escuro ? "☀ Claro" : "☾ Escuro";
  tema.setAttribute("aria-label", escuro ? "Usar tema claro" : "Usar tema escuro");
}

function zoom(passo) {
  const i = ESCALAS.indexOf(escalaAtual());
  const novo = passo === 0 ? 1 : ESCALAS[Math.min(ESCALAS.length - 1, Math.max(0, i + passo))];
  if (novo === 1) delete escolha.escala; else escolha.escala = novo;
  gravar(escolha);
  aplicar();
}

export function montarAparencia(caixa) {
  // Um index.html antigo em cache não tem a caixa; o resto do site segue.
  if (!caixa) return;
  caixa.innerHTML = `
    <button type="button" data-passo="-1" aria-label="Diminuir o texto">A−</button>
    <button type="button" data-passo="0" aria-label="Voltar o texto ao tamanho normal" title="Voltar ao tamanho normal"></button>
    <button type="button" data-passo="1" aria-label="Aumentar o texto">A+</button>
    <button type="button" class="tema"></button>`;
  [menos, atual, mais, tema] = caixa.querySelectorAll("button");

  caixa.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b === tema) {
      escolha.tema = temaAtual() === "escuro" ? "claro" : "escuro";
      gravar(escolha);
      aplicar();
    } else {
      zoom(Number(b.dataset.passo));
    }
  });

  // Sem escolha gravada, a página segue o sistema, inclusive se ele mudar.
  escuroNoSistema.addEventListener("change", () => { if (!escolha.tema) aplicar(); });

  pintarBotoes();
}
