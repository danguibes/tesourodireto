/**
 * Gráfico de linhas sobre uPlot, com tooltip próprio.
 *
 * O uPlot foi escolhido por desenhar milhares de pontos em canvas sem
 * engasgar — a série de um IPCA+ 2045 tem mais de cinco mil dias.
 */

import { brl, data as fmtData, num } from "./formato.js";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun",
               "jul", "ago", "set", "out", "nov", "dez"];

function corDe(nome) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--${nome}`).trim();
}

function eixoCor() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--tinta-fraca").trim();
}

function reguaCor() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--regua").trim();
}

/**
 * @param {HTMLElement} alvo
 * @param {number[]} x segundos (epoch)
 * @param {{rotulo:string, cor:string, valores:number[], unidade?:string}[]} series
 */
export function desenharLinhas(alvo, x, series, opcoes = {}) {
  alvo.innerHTML = "";
  if (!x.length) return null;

  const dica = document.createElement("div");
  dica.className = "dica esconde";
  alvo.style.position = "relative";
  alvo.appendChild(dica);

  const unidade = opcoes.unidade || "brl";
  const formatar = unidade === "pct"
    ? (v) => (Number.isFinite(v) ? `${num(v, 2)}%` : "—")
    : brl;

  const config = {
    width: alvo.clientWidth || 900,
    height: opcoes.altura || 380,
    padding: [12, 8, 0, 0],
    cursor: {
      y: false,
      points: { size: 6 },
      drag: { x: true, y: false },
    },
    legend: { show: false },
    scales: { x: { time: true }, y: { auto: true } },
    axes: [
      {
        stroke: eixoCor(), grid: { show: false },
        ticks: { stroke: reguaCor(), size: 4 },
        font: "12px Archivo, sans-serif",
        // O uPlot rotula datas em inglês por padrão.
        values: (u, divisoes) => {
          const anos = (u.scales.x.max - u.scales.x.min) / (365.25 * 86400);
          return divisoes.map((s) => {
            const d = new Date(s * 1000);
            const m = MESES[d.getUTCMonth()];
            return anos > 1
              ? `${m}/${String(d.getUTCFullYear()).slice(2)}`
              : `${String(d.getUTCDate()).padStart(2, "0")}/${m}`;
          });
        },
      },
      {
        stroke: eixoCor(),
        grid: { stroke: reguaCor(), width: 1 },
        ticks: { show: false },
        font: "12px Archivo, sans-serif",
        size: 68,
        values: (u, vs) => vs.map((v) => (unidade === "pct"
          ? `${num(v, 0)}%`
          : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }))),
      },
    ],
    series: [
      { value: (u, v) => (v == null ? "" : fmtData(Math.round(v / 86400))) },
      ...series.map((s) => ({
        label: s.rotulo,
        stroke: corDe(s.cor),
        width: 1.8,
        points: { show: false },
        spanGaps: true,
      })),
    ],
    hooks: {
      setCursor: [(u) => {
        const { idx, left, top } = u.cursor;
        if (idx == null || left < 0) { dica.classList.add("esconde"); return; }
        const linhas = series.map((s, i) => {
          const v = u.data[i + 1][idx];
          return v == null ? "" :
            `<em style="color:${corDe(s.cor)}">■</em> ${s.rotulo}: ${formatar(v)}`;
        }).filter(Boolean).join("<br>");
        dica.innerHTML =
          `<b>${fmtData(Math.round(u.data[0][idx] / 86400))}</b>${linhas}`;
        dica.classList.remove("esconde");
        const larg = dica.offsetWidth;
        const x0 = left + larg + 24 > u.over.clientWidth ? left - larg - 14 : left + 14;
        dica.style.left = `${Math.max(0, x0)}px`;
        dica.style.top = `${Math.max(0, top - 10)}px`;
      }],
    },
  };

  const dados = [x, ...series.map((s) => s.valores)];
  const u = new uPlot(config, dados, alvo);

  const redimensionar = () => u.setSize({
    width: alvo.clientWidth, height: opcoes.altura || 380,
  });
  const obs = new ResizeObserver(redimensionar);
  obs.observe(alvo);
  u._obs = obs;

  return u;
}

/** Legenda textual, fora do canvas, para ficar acessível e selecionável. */
export function desenharLegenda(alvo, series) {
  alvo.innerHTML = series.map((s) =>
    `<span style="color:var(--${s.cor})"><i></i><span style="color:var(--tinta)">${s.rotulo}</span></span>`
  ).join("");
}
