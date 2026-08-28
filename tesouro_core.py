"""
Núcleo de cálculo para títulos públicos do Tesouro Direto.

Convenções (padrão ANBIMA / Tesouro Nacional):
  - Desconto exponencial em dias úteis / 252, calendário ANBIMA.
  - PU = VNA_projetado x Cotação, onde Cotação é o valor presente dos fluxos
    futuros por unidade de valor nominal, descontados à taxa contratada.
  - Cupom NTN-B / NTN-C: (1,06)^0,5 - 1 = 2,956301% do VNA, semestral.
  - Cupom NTN-F:         (1,10)^0,5 - 1 = 4,880885% sobre VN de R$ 1.000.
  - NTN-B1 (RendA+ / Educa+): n amortizações mensais iguais (240 / 60), da
    data de conversão até o vencimento, cada uma valendo VNA/n.

O calendário é pré-computado em vetores para que a contagem de dias úteis
entre duas datas vire uma subtração, e não uma varredura.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
from bizdays import Calendar
from dateutil.relativedelta import relativedelta

# ---------------------------------------------------------------------------
# Calendário vetorizado
# ---------------------------------------------------------------------------

_CAL = Calendar.load("ANBIMA")
INICIO_CAL = date(2000, 1, 3)
FIM_CAL = date(2099, 12, 25)

_dias = [INICIO_CAL + timedelta(days=k) for k in range((FIM_CAL - INICIO_CAL).days + 1)]
_eh_util = np.array([_CAL.isbizday(d) for d in _dias], dtype=bool)

# _acum[i] = quantidade de dias úteis estritamente antes de _dias[i]
_acum = np.concatenate([[0], np.cumsum(_eh_util)[:-1]]).astype(np.int32)

# _prox[i] = índice do primeiro dia útil a partir de _dias[i]
_prox = np.empty(len(_dias), dtype=np.int32)
_ultimo = len(_dias) - 1
for _i in range(len(_dias) - 1, -1, -1):
    if _eh_util[_i]:
        _ultimo = _i
    _prox[_i] = _ultimo

_ORDINAL_BASE = INICIO_CAL.toordinal()


def _idx(d: date) -> int:
    i = d.toordinal() - _ORDINAL_BASE
    if i < 0 or i >= len(_dias):
        raise ValueError(f"Data fora do calendário ANBIMA carregado: {d}")
    return i


def dias_uteis(inicio: date, fim: date) -> int:
    """Dias úteis no intervalo [inicio, fim), convenção do Tesouro."""
    return int(_acum[_idx(fim)] - _acum[_idx(inicio)])


def dias_uteis_vetor(inicio, fim) -> np.ndarray:
    """
    Versão vetorizada de `dias_uteis`, para colunas inteiras de um DataFrame.

    Aceita arrays de datetime64 ou de objetos date.
    """
    def _ordinais(x) -> np.ndarray:
        arr = np.asarray(x)
        if np.issubdtype(arr.dtype, np.datetime64):
            return arr.astype("datetime64[D]").astype(np.int64) + 719163
        return np.array([d.toordinal() for d in arr.ravel()], dtype=np.int64)

    i = _ordinais(inicio) - _ORDINAL_BASE
    f = _ordinais(fim) - _ORDINAL_BASE
    return (_acum[f] - _acum[i]).astype(np.int64)


def ajusta(d: date) -> date:
    """Leva a data ao próximo dia útil, se cair em feriado ou fim de semana."""
    return _dias[int(_prox[_idx(d)])]


def eh_dia_util(d: date) -> bool:
    return bool(_eh_util[_idx(d)])


# ---------------------------------------------------------------------------
# Famílias de título
# ---------------------------------------------------------------------------

CUPOM_NTNB = 1.06 ** 0.5 - 1.0      # 0,02956301
CUPOM_NTNF = 1.10 ** 0.5 - 1.0      # 0,04880885

LTN = "LTN"                     # Tesouro Prefixado
NTNF = "NTN-F"                  # Tesouro Prefixado com Juros Semestrais
LFT = "LFT"                     # Tesouro Selic
NTNB_P = "NTN-B Principal"      # Tesouro IPCA+
NTNB = "NTN-B"                  # Tesouro IPCA+ com Juros Semestrais
NTNC = "NTN-C"                  # Tesouro IGPM+ com Juros Semestrais
NTNB1 = "NTN-B1"                # Tesouro RendA+ / Educa+

INDEXADOR = {
    LTN: "prefixado", NTNF: "prefixado", LFT: "selic",
    NTNB_P: "ipca", NTNB: "ipca", NTNB1: "ipca", NTNC: "igpm",
}

ROTULO_FAMILIA = {
    LTN: "Prefixado (LTN)",
    NTNF: "Prefixado com juros semestrais (NTN-F)",
    LFT: "Selic (LFT)",
    NTNB_P: "IPCA+ (NTN-B Principal)",
    NTNB: "IPCA+ com juros semestrais (NTN-B)",
    NTNC: "IGP-M com juros semestrais (NTN-C)",
    NTNB1: "Amortização mensal (NTN-B1)",
}


def classificar(nome: str) -> str:
    n = nome.strip().lower()
    if "renda+" in n or "renda +" in n or "educa+" in n or "educa +" in n:
        return NTNB1
    if "igpm" in n or "igp-m" in n:
        return NTNC
    if "ipca" in n:
        return NTNB if "semestrais" in n else NTNB_P
    if "selic" in n or "reserva" in n:
        return LFT
    if "prefixado" in n:
        return NTNF if "semestrais" in n else LTN
    raise ValueError(f"Título não reconhecido: {nome!r}")


def n_parcelas(nome: str) -> int:
    """Número de amortizações mensais de um NTN-B1."""
    n = nome.strip().lower()
    return 60 if ("educa+" in n or "educa +" in n) else 240


# ---------------------------------------------------------------------------
# Fluxos de caixa, por unidade de valor nominal (VNA = 1)
# ---------------------------------------------------------------------------

_cache_fluxos: dict[tuple[str, date], list[tuple[date, float]]] = {}


def fluxos(nome: str, vencimento: date) -> list[tuple[date, float]]:
    """[(data_pagamento, valor_por_unidade_de_VNA), ...] em ordem crescente."""
    fam = classificar(nome)
    chave = (fam if fam != NTNB1 else f"{fam}-{n_parcelas(nome)}", vencimento)
    if chave in _cache_fluxos:
        return _cache_fluxos[chave]

    if fam in (LTN, LFT, NTNB_P):
        saida = [(ajusta(vencimento), 1.0)]

    elif fam == NTNB1:
        n = n_parcelas(nome)
        datas = [vencimento - relativedelta(months=k) for k in range(n - 1, -1, -1)]
        saida = [(ajusta(d), 1.0 / n) for d in datas]

    else:
        cupom = CUPOM_NTNF if fam == NTNF else CUPOM_NTNB
        datas, d = [], vencimento
        while d >= INICIO_CAL:
            datas.append(d)
            d -= relativedelta(months=6)
        datas.sort()
        saida = [(ajusta(x), cupom) for x in datas]
        saida[-1] = (saida[-1][0], cupom + 1.0)

    _cache_fluxos[chave] = saida
    return saida


def fluxos_futuros(nome: str, vencimento: date, ref: date):
    return [(d, v) for d, v in fluxos(nome, vencimento) if d > ref]


# ---------------------------------------------------------------------------
# Precificação
# ---------------------------------------------------------------------------

def cotacao(nome: str, vencimento: date, ref: date, taxa: float) -> float:
    """Valor presente dos fluxos futuros por unidade de VNA, à taxa dada (% a.a.)."""
    i = 1.0 + taxa / 100.0
    ref_i = _acum[_idx(ref)]
    total = 0.0
    for d, v in fluxos(nome, vencimento):
        if d <= ref:
            continue
        du = int(_acum[_idx(d)] - ref_i)
        total += v / i ** (du / 252.0)
    return total


def cotacao_serie(nome: str, vencimento: date,
                  refs: np.ndarray, taxas: np.ndarray) -> np.ndarray:
    """
    Versão vetorizada de `cotacao` para muitas datas de uma vez.

    `refs` são datas (numpy datetime64 ou objetos date) e `taxas` as taxas
    anuais correspondentes, em % a.a. Devolve um vetor de cotações.
    """
    fl = fluxos(nome, vencimento)
    f_ord = np.array([d.toordinal() for d, _ in fl])
    f_val = np.array([v for _, v in fl])
    f_acum = _acum[f_ord - _ORDINAL_BASE].astype(np.float64)

    r_ord = np.array([_para_date(x).toordinal() for x in refs])
    r_acum = _acum[r_ord - _ORDINAL_BASE].astype(np.float64)

    du = f_acum[None, :] - r_acum[:, None]          # (n_datas, n_fluxos)
    vivo = f_ord[None, :] > r_ord[:, None]          # fluxo ainda não pago
    base = (1.0 + np.asarray(taxas, dtype=float) / 100.0)[:, None]

    desc = np.where(vivo, base ** (-du / 252.0), 0.0)
    return (desc * f_val[None, :]).sum(axis=1)


def _para_date(x) -> date:
    if isinstance(x, date):
        return x
    return np.datetime64(x, "D").astype(date)


def vna_implicito(nome: str, vencimento: date, ref: date,
                  taxa: float, pu: float) -> float:
    """
    Extrai o VNA do preço observado: VNA = PU / Cotação.

    É o que permite o app rodar sem baixar séries de IPCA, IGP-M ou Selic —
    o próprio arquivo de preços do Tesouro carrega essa informação embutida.
    """
    c = cotacao(nome, vencimento, ref, taxa)
    return pu / c if c > 0 else float("nan")


# ---------------------------------------------------------------------------
# Posição simulada
# ---------------------------------------------------------------------------

@dataclass
class Posicao:
    """Uma compra hipotética, com tudo que ficou travado no ato."""
    nome: str
    vencimento: date
    data_compra: date
    taxa: float           # % a.a. contratada
    pu_compra: float      # R$ por título
    quantidade: float = 1.0
    familia: str = field(init=False)

    def __post_init__(self):
        self.familia = classificar(self.nome)

    @property
    def indexador(self) -> str:
        return INDEXADOR[self.familia]

    @property
    def aplicado(self) -> float:
        return self.pu_compra * self.quantidade


def avaliar(pos: Posicao, ref: date, vna_ref: float, vna_compra: float,
            pu_mercado: float | None = None) -> dict:
    """
    Compara o valor teórico (na curva) com o valor de mercado numa data.

    Duas leituras do valor na curva, porque títulos com cupom ou amortização
    devolvem dinheiro pelo caminho:
      - 'curva_caixa': PU na curva + pagamentos recebidos, guardados sem render.
      - 'curva_reinvest': tudo reaplicado à mesma taxa contratada. Equivale a
        PU0 x (1+r)^(du/252) x correção do indexador.
    O valor de mercado recebe o mesmo tratamento de caixa, para a comparação
    ficar entre iguais.
    """
    fator = (vna_ref / vna_compra) if vna_compra else 1.0
    du = dias_uteis(pos.data_compra, ref)
    q = pos.quantidade

    pu_curva = cotacao(pos.nome, pos.vencimento, ref, pos.taxa) * vna_ref

    # Pagamentos ocorridos entre a compra e a data de referência. O VNA da data
    # de cada pagamento é interpolado exponencialmente entre compra e referência.
    recebido = 0.0
    for d, v in fluxos(pos.nome, pos.vencimento):
        if not (pos.data_compra < d <= ref):
            continue
        peso = (dias_uteis(pos.data_compra, d) / du) if du else 1.0
        recebido += v * vna_compra * fator ** peso

    reinvest = pos.pu_compra * (1 + pos.taxa / 100.0) ** (du / 252.0) * fator

    r = {
        "data": ref,
        "dias_uteis": du,
        "anos": du / 252.0,
        "pu_curva": pu_curva * q,
        "recebido": recebido * q,
        "curva_caixa": (pu_curva + recebido) * q,
        "curva_reinvest": reinvest * q,
        "vna": vna_ref,
    }

    if pu_mercado is not None:
        r["pu_mercado"] = pu_mercado * q
        r["mercado_caixa"] = (pu_mercado + recebido) * q
        r["agio"] = r["mercado_caixa"] - r["curva_caixa"]
        r["agio_pct"] = ((r["mercado_caixa"] / r["curva_caixa"] - 1) * 100
                         if r["curva_caixa"] else float("nan"))

    return r
