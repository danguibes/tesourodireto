"""Funções compartilhadas entre as páginas do app."""

from __future__ import annotations

import re
import unicodedata
from datetime import date

import pandas as pd
import streamlit as st

import tesouro_core as tc
import tesouro_dados as td

COR_CURVA = "#1f4e78"
COR_MERCADO = "#c0392b"
COR_REINVEST = "#7f8fa6"
COR_POSITIVO = "#2e7d32"


# ---------------------------------------------------------------------------
# Dados
# ---------------------------------------------------------------------------

@st.cache_data(ttl=60 * 60 * 6, show_spinner=False)
def carregar(forcar: bool) -> pd.DataFrame:
    return td.carregar(forcar_download=forcar)


@st.cache_data(show_spinner=False)
def catalogo(_df: pd.DataFrame, versao: int) -> pd.DataFrame:
    return td.catalogo(_df)


def dados_ou_para() -> pd.DataFrame:
    """Carrega o histórico, mostrando erro amigável e interrompendo se falhar."""
    forcar = st.session_state.pop("forcar_download", False)
    try:
        with st.spinner(
            "Baixando o histórico do Tesouro Transparente (14 MB). "
            "Na primeira abertura isso leva de um a dois minutos; "
            "depois fica em cache."
        ):
            return carregar(forcar)
    except Exception as exc:  # noqa: BLE001
        st.error(f"Não consegui carregar os dados do Tesouro Transparente: {exc}")
        st.button("Tentar de novo", on_click=carregar.clear)
        st.stop()


def botao_atualizar() -> None:
    if st.sidebar.button("Atualizar histórico", use_container_width=True):
        carregar.clear()
        st.session_state["forcar_download"] = True
        st.rerun()


# ---------------------------------------------------------------------------
# Formatação
# ---------------------------------------------------------------------------

def brl(v: float) -> str:
    if pd.isna(v):
        return "—"
    s = f"{v:,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
    return f"R$ {s}"


# ---------------------------------------------------------------------------
# Resolução de títulos a partir de texto livre
# ---------------------------------------------------------------------------

def _normalizar(texto: str) -> str:
    t = unicodedata.normalize("NFKD", str(texto))
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = t.lower().replace("+", " mais ").replace("-", " ")
    return re.sub(r"\s+", " ", t).strip()


# Quantos anos separam o ano do nome comercial do ano de vencimento.
# RendA+ 2030 vence em 2049 (240 parcelas mensais); Educa+ 2026 vence em 2030.
_DEFASAGEM_NTNB1 = {"renda": 19, "educa": 4}


def resolver_titulo(cat: pd.DataFrame, texto: str,
                    vencimento=None) -> tuple[pd.Series | None, str]:
    """
    Encontra o papel correspondente a um texto livre.

    Aceita "Tesouro IPCA+ 2050", "Tesouro Prefixado 2029",
    "Tesouro Renda+ Aposentadoria Extra 2030" e afins. Se `vencimento` vier
    preenchido, ele manda. Devolve (linha_do_catalogo, mensagem_de_erro).
    """
    alvo = _normalizar(texto)
    if not alvo:
        return None, "título vazio"

    try:
        familia = tc.classificar(texto)
    except ValueError:
        return None, f"não reconheci o tipo de título em “{texto}”"

    cand = cat.loc[cat["familia"] == familia].copy()
    if cand.empty:
        return None, f"nenhum papel da família {familia} no histórico"

    # Caminho 1: vencimento informado explicitamente.
    if vencimento is not None and not pd.isna(vencimento):
        alvo_venc = pd.Timestamp(vencimento).normalize()
        exato = cand.loc[cand["vencimento"] == alvo_venc]
        if not exato.empty:
            return exato.iloc[0], ""
        mesmo_ano = cand.loc[cand["vencimento"].dt.year == alvo_venc.year]
        if len(mesmo_ano) == 1:
            return mesmo_ano.iloc[0], ""
        return None, (f"não achei {texto} vencendo em "
                      f"{alvo_venc:%d/%m/%Y}")

    # Caminho 2: ano embutido no nome comercial.
    anos = re.findall(r"\b(19|20|21)(\d{2})\b", texto)
    if not anos:
        if len(cand) == 1:
            return cand.iloc[0], ""
        return None, (f"“{texto}” não traz o ano; informe a coluna vencimento "
                      f"ou escreva algo como “Tesouro IPCA+ 2035”")

    ano = int(anos[-1][0] + anos[-1][1])

    if familia == tc.NTNB1:
        chave = "educa" if "educa" in alvo else "renda"
        ano += _DEFASAGEM_NTNB1[chave]

    achados = cand.loc[cand["vencimento"].dt.year == ano]
    if achados.empty:
        return None, f"não achei {texto} com vencimento em {ano}"
    if len(achados) > 1:
        # Dois papéis da mesma família vencendo no mesmo ano (ex.: IPCA+ 2026
        # em maio e agosto). Nesse caso o ano não basta.
        opcoes = ", ".join(f"{d:%d/%m/%Y}" for d in achados["vencimento"])
        return None, (f"“{texto}” é ambíguo em {ano}; informe a coluna "
                      f"vencimento ({opcoes})")
    return achados.iloc[0], ""
