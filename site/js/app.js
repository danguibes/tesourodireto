/** Roteador entre as duas telas. */

import * as simulacao from "./simulacao.js";
import * as carteira from "./carteira.js";
import { montarAparencia } from "./aparencia.js";

montarAparencia(document.getElementById("aparencia"));

const telas = { simulacao, carteira };

const trilho = document.getElementById("controles");
const palco = document.getElementById("palco");
const abas = document.getElementById("abas");

async function abrir(nome) {
  for (const b of abas.querySelectorAll("button")) {
    b.setAttribute("aria-selected", String(b.dataset.tela === nome));
  }
  history.replaceState(null, "", `#${nome}`);
  trilho.innerHTML = "";
  palco.innerHTML = `<div class="carregando">Carregando…</div>`;
  try {
    await telas[nome].montar(trilho, palco);
  } catch (e) {
    palco.innerHTML = `<div class="aviso">${e.message}</div>`;
    console.error(e);
  }
}

abas.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) abrir(b.dataset.tela);
});

const inicial = location.hash.replace("#", "");
abrir(inicial in telas ? inicial : "simulacao");
