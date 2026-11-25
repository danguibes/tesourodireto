/**
 * Aviso de dados atrasados, com a causa quando dá para saber.
 *
 * O portal do Tesouro não aceita consulta de outros sites (CORS), então a
 * página não tem como perguntar a ele. A tarefa diária do notebook anota no
 * texto do release `fonte` a data do arquivo no portal e a hora da conferência
 * (scripts/atualizar_automatico.ps1), e a página lê de lá. A consulta só
 * acontece quando os dados estão atrasados.
 */

import * as D from "./dados.js";
import { diaDeTexto } from "./tesouro.js";

const RELEASE = "https://api.github.com/repos/danguibes/tesourodireto/releases/tags/fonte";

// Em dia normal o arquivo traz os preços do dia útil anterior: idade 1.
const IDADE_MAXIMA = 2;
// A tarefa confere duas vezes por dia; passado isto, a anotação não vale.
const VALIDADE_MS = 36 * 3600 * 1000;

const FUSO = "America/Sao_Paulo";

function hojeEmBrasilia(agora) {
  return diaDeTexto(new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(agora));
}

function quando(ms) {
  const d = new Date(ms);
  const dia = d.toLocaleDateString("pt-BR", { timeZone: FUSO });
  const hora = d.toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
  return `${dia}, ${hora}`;
}

/** Interpreta o release; null se não houver anotação legível. */
export function lerVerificacao(release) {
  const m = /^verificacao portal=(\S+) em=(\S+)\s*$/m.exec(release.body || "");
  if (!m) return null;
  const portal = Date.parse(m[1]);
  const em = Date.parse(m[2]);
  if (!Number.isFinite(portal) || !Number.isFinite(em)) return null;
  const envios = (release.assets || [])
    .filter((a) => /^precotaxatesourodireto.*\.csv$/.test(a.name))
    .map((a) => Date.parse(a.created_at));
  return { portal, em, envio: envios.length ? Math.max(...envios) : null };
}

/** Texto da causa, a partir da anotação (ou null) e da hora de geração. */
export function causa(v, geradoEm, agora) {
  if (!v) return "Não consegui verificar se o atraso é do Tesouro ou deste site.";
  if (agora - v.em > VALIDADE_MS) {
    return `A última conferência com o portal do Tesouro foi em ${quando(v.em)}, ` +
      "então não sei se há arquivo mais novo.";
  }
  if (v.envio == null || v.envio < v.portal || geradoEm < v.envio) {
    return `O Tesouro tem um arquivo de ${quando(v.portal)} que ainda não foi publicado aqui. ` +
      "O atraso é deste site.";
  }
  return `O Tesouro não atualiza o arquivo público desde ${quando(v.portal)}. ` +
    `O site está igual ao portal (conferido em ${quando(v.em)}).`;
}

export async function montarFrescor(caixa) {
  // Um index.html antigo em cache não tem a caixa; o resto do site segue.
  if (!caixa) return;
  const [cal, info] = await Promise.all([D.calendario(), D.meta()]);
  const agora = new Date();
  const hoje = hojeEmBrasilia(agora);
  if (hoje <= info.ultimaDataBase) return;
  const idade = cal.diasUteis(info.ultimaDataBase, hoje);
  if (idade <= IDADE_MAXIMA) return;

  let v = null;
  try {
    const r = await fetch(RELEASE);
    if (r.ok) v = lerVerificacao(await r.json());
  } catch { /* sem rede ou limite da API: fica o aviso sem a causa */ }

  caixa.innerHTML = `<p class="frescor"><b>Preços de ${info.ultimaDataBaseTexto}</b>,
    ${idade} dias úteis atrás. ${causa(v, Date.parse(info.geradoEm), agora.getTime())}</p>`;
}
