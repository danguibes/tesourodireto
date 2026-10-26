/**
 * Carga dos dados estáticos publicados junto com a página.
 *
 * Tudo vem de arquivos gerados uma vez por dia útil pelo GitHub Actions.
 * O navegador nunca fala com o portal do Tesouro, que limita requisições.
 */

import { Calendario, classificar } from "./tesouro.js";

const RAIZ = new URL("../dados/", import.meta.url);

const cache = new Map();

async function buscar(nome) {
  if (cache.has(nome)) return cache.get(nome);
  const p = fetch(new URL(nome, RAIZ)).then((r) => {
    if (!r.ok) throw new Error(`Não consegui carregar ${nome} (HTTP ${r.status}).`);
    return r.json();
  });
  cache.set(nome, p);
  return p;
}

let _cal = null;

export async function calendario() {
  if (_cal) return _cal;
  const f = await buscar("feriados.json");
  _cal = new Calendario(f.feriados, f.inicio, f.fim);
  return _cal;
}

export async function meta() {
  return buscar("meta.json");
}

export async function papeis() {
  return buscar("papeis.json");
}

export async function papel(id) {
  return buscar(`p/${id}.json`);
}

export async function indices() {
  return buscar("indices.json");
}

/** Agrupa o índice de papéis por título, com os vencimentos ordenados. */
export function porTitulo(lista) {
  const mapa = new Map();
  for (const p of lista) {
    if (!mapa.has(p.titulo)) mapa.set(p.titulo, []);
    mapa.get(p.titulo).push(p);
  }
  for (const v of mapa.values()) v.sort((a, b) => a.vencimento - b.vencimento);
  return mapa;
}

/**
 * Encontra o papel correspondente a um texto livre, como vem da corretora.
 *
 * Aceita "Tesouro IPCA+ 2035", "Tesouro Educa+ 2028" e afins. No RendA+ e no
 * Educa+ o ano do nome comercial é o da conversão, não o do vencimento, e a
 * defasagem é de 19 e 4 anos respectivamente.
 */
const DEFASAGEM = { renda: 19, educa: 4 };

export function resolverTitulo(lista, texto, vencimento = null) {
  const bruto = String(texto || "").trim();
  if (!bruto) return { erro: "título vazio" };

  let familia;
  try {
    familia = classificar(bruto);
  } catch {
    return { erro: `não reconheci o tipo de título em “${bruto}”` };
  }

  const cand = lista.filter((p) => p.familia === familia);
  if (!cand.length) return { erro: `nenhum papel da família ${familia}` };

  if (vencimento != null) {
    const exato = cand.find((p) => p.vencimento === vencimento);
    if (exato) return { papel: exato };
    const anoAlvo = new Date(vencimento * 86400000).getUTCFullYear();
    const mesmoAno = cand.filter(
      (p) => new Date(p.vencimento * 86400000).getUTCFullYear() === anoAlvo);
    if (mesmoAno.length === 1) return { papel: mesmoAno[0] };
    return { erro: `não achei ${bruto} com esse vencimento` };
  }

  const anos = [...bruto.matchAll(/\b(19|20|21)(\d{2})\b/g)];
  if (!anos.length) {
    if (cand.length === 1) return { papel: cand[0] };
    return {
      erro: `“${bruto}” não traz o ano; informe a coluna vencimento ` +
            `ou escreva algo como “Tesouro IPCA+ 2035”`,
    };
  }

  const ultimo = anos[anos.length - 1];
  let ano = Number(ultimo[1] + ultimo[2]);

  if (familia === "NTN-B1") {
    const n = bruto.toLowerCase();
    ano += (n.includes("educa+") || n.includes("educa +"))
      ? DEFASAGEM.educa : DEFASAGEM.renda;
  }

  const achados = cand.filter(
    (p) => new Date(p.vencimento * 86400000).getUTCFullYear() === ano);

  if (!achados.length) return { erro: `não achei ${bruto} vencendo em ${ano}` };
  if (achados.length > 1) {
    return {
      erro: `“${bruto}” é ambíguo em ${ano}; informe a coluna vencimento`,
      opcoes: achados,
    };
  }
  return { papel: achados[0] };
}
