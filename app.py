"""
Simulador Tesouro Direto — valor na curva vs. valor a mercado.

Rodar com:  streamlit run app.py
"""

from __future__ import annotations

from datetime import date

import altair as alt
import pandas as pd
import streamlit as st

import tesouro_core as tc
import tesouro_dados as td

st.set_page_config(page_title="Tesouro Direto — curva vs. mercado",
                   page_icon="📈", layout="wide")

COR_CURVA = "#1f4e78"
COR_MERCADO = "#c0392b"
COR_REINVEST = "#7f8fa6"


# ---------------------------------------------------------------------------
# Carga de dados
# ---------------------------------------------------------------------------

@st.cache_data(ttl=60 * 60 * 6, show_spinner=False)
def _carregar(forcar: bool) -> pd.DataFrame:
    return td.carregar(forcar_download=forcar)


@st.cache_data
def _catalogo(_df: pd.DataFrame, versao: int) -> pd.DataFrame:
    return td.catalogo(_df)


def brl(v: float) -> str:
    s = f"{v:,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
    return f"R$ {s}"


# ---------------------------------------------------------------------------
# Barra lateral
# ---------------------------------------------------------------------------

st.sidebar.title("Simulação")

if st.sidebar.button("Atualizar histórico", use_container_width=True):
    _carregar.clear()
    st.session_state["forcar_download"] = True
    st.rerun()

forcar = st.session_state.pop("forcar_download", False)

try:
    with st.spinner(
        "Baixando o histórico do Tesouro Transparente (14 MB). "
        "Na primeira abertura isso leva de um a dois minutos; "
        "depois fica em cache."
    ):
        df = _carregar(forcar)
except Exception as exc:  # noqa: BLE001
    st.error(f"Não consegui carregar os dados do Tesouro Transparente: {exc}")
    st.button("Tentar de novo", on_click=_carregar.clear)
    st.stop()

cat = _catalogo(df, len(df))

st.sidebar.caption(
    f"{len(df):,.0f} observações · dados até "
    f"{df['data_base'].max():%d/%m/%Y}".replace(",", ".")
)

titulos = sorted(cat["titulo"].unique())
titulo = st.sidebar.selectbox("Título", titulos,
                              index=titulos.index("Tesouro IPCA+")
                              if "Tesouro IPCA+" in titulos else 0)

opcoes = cat.loc[cat["titulo"] == titulo].sort_values("vencimento")
venc_labels = {
    f"{r.vencimento:%d/%m/%Y}  (preços de {r.primeira_data:%m/%Y} a {r.ultima_data:%m/%Y})":
    r.vencimento for r in opcoes.itertuples()
}
venc_label = st.sidebar.selectbox("Vencimento", list(venc_labels))
vencimento = venc_labels[venc_label]

papel = td.historico_papel(df, titulo, vencimento)
d_min = papel["data_base"].min().date()
d_max = papel["data_base"].max().date()

data_compra = st.sidebar.date_input(
    "Data da compra", value=max(d_min, min(d_max, date(d_max.year - 2, d_max.month, 1))),
    min_value=d_min, max_value=d_max, format="DD/MM/YYYY",
)

valor = st.sidebar.number_input("Valor aplicado (R$)", min_value=30.0,
                                value=10_000.0, step=500.0)

st.sidebar.divider()
mostrar_reinvest = st.sidebar.checkbox(
    "Mostrar também a curva com reinvestimento", value=True,
    help="Só muda o resultado em títulos que pagam cupom ou amortização.",
)

# ---------------------------------------------------------------------------
# Simulação
# ---------------------------------------------------------------------------

try:
    pos, serie = td.simular(df, titulo, vencimento, data_compra, valor_aplicado=valor)
except ValueError as exc:
    st.warning(str(exc))
    st.stop()

fim = serie.iloc[-1]
paga_fluxo = float(serie["recebido_acum"].iloc[-1]) > 0

st.title("Valor teórico vs. valor a mercado")
st.markdown(
    f"**{pos.nome}**, vencimento {pos.vencimento:%d/%m/%Y} · "
    f"{tc.ROTULO_FAMILIA[pos.familia]}  \n"
    f"Compra em **{pos.data_compra:%d/%m/%Y}** a **{pos.taxa:.2f}% a.a.**, "
    f"PU de {brl(pos.pu_compra)} · {pos.quantidade:,.4f} títulos"
)

c1, c2, c3, c4 = st.columns(4)
c1.metric("Aplicado", brl(pos.aplicado))
c2.metric("Na curva", brl(fim["curva_caixa"]),
          f"{(fim['curva_caixa'] / pos.aplicado - 1) * 100:+.2f}%")
c3.metric("A mercado", brl(fim["mercado_caixa"]),
          f"{(fim['mercado_caixa'] / pos.aplicado - 1) * 100:+.2f}%")
c4.metric("Ágio sobre a curva", brl(fim["agio"]), f"{fim['agio_pct']:+.2f}%",
          delta_color="normal")

if fim["agio"] >= 0:
    st.success(
        f"Em {fim['data']:%d/%m/%Y} o mercado pagava {brl(abs(fim['agio']))} "
        f"a mais que o valor teórico. Vender antecipadamente nesse dia teria "
        f"antecipado rendimento."
    )
else:
    st.info(
        f"Em {fim['data']:%d/%m/%Y} o mercado pagava {brl(abs(fim['agio']))} "
        f"a menos que o valor teórico. Levar até o vencimento devolve essa "
        f"diferença, desde que o título seja mantido."
    )

# ---------------------------------------------------------------------------
# Gráfico principal
# ---------------------------------------------------------------------------

cols = ["curva_caixa", "mercado_caixa"]
rotulos = {"curva_caixa": "Valor na curva", "mercado_caixa": "Valor a mercado"}
cores = [COR_CURVA, COR_MERCADO]

if mostrar_reinvest and paga_fluxo:
    cols.append("curva_reinvest")
    rotulos["curva_reinvest"] = "Na curva, reinvestindo"
    cores.append(COR_REINVEST)

longo = serie.melt(id_vars="data", value_vars=cols,
                   var_name="serie", value_name="valor")
longo["serie"] = longo["serie"].map(rotulos)

linha = (
    alt.Chart(longo)
    .mark_line(strokeWidth=2)
    .encode(
        x=alt.X("data:T", title=None),
        y=alt.Y("valor:Q", title="R$", scale=alt.Scale(zero=False)),
        color=alt.Color("serie:N", title=None,
                        scale=alt.Scale(domain=list(rotulos.values()), range=cores),
                        legend=alt.Legend(orient="top")),
        tooltip=[alt.Tooltip("data:T", title="Data", format="%d/%m/%Y"),
                 alt.Tooltip("serie:N", title=""),
                 alt.Tooltip("valor:Q", title="R$", format=",.2f")],
    )
    .properties(height=380)
)
st.altair_chart(linha, use_container_width=True)

# ---------------------------------------------------------------------------
# Ágio ao longo do tempo
# ---------------------------------------------------------------------------

with st.expander("Ágio/deságio ao longo do tempo", expanded=False):
    area = (
        alt.Chart(serie)
        .mark_area(opacity=0.75)
        .encode(
            x=alt.X("data:T", title=None),
            y=alt.Y("agio_pct:Q", title="% sobre o valor na curva"),
            color=alt.condition(alt.datum.agio_pct >= 0,
                                alt.value("#2e7d32"), alt.value(COR_MERCADO)),
            tooltip=[alt.Tooltip("data:T", title="Data", format="%d/%m/%Y"),
                     alt.Tooltip("agio_pct:Q", title="Ágio %", format="+.2f"),
                     alt.Tooltip("taxa_mercado:Q", title="Taxa de venda", format=".2f")],
        )
        .properties(height=240)
    )
    st.altair_chart(area, use_container_width=True)
    st.caption(
        "Acima de zero, o mercado paga mais que o valor teórico — em geral "
        "porque as taxas caíram desde a compra. Abaixo de zero, o contrário."
    )

# ---------------------------------------------------------------------------
# Fluxos recebidos
# ---------------------------------------------------------------------------

if paga_fluxo:
    fluxos = td.fluxos_do_papel(pos, serie)
    with st.expander(
        f"Pagamentos recebidos até aqui — {len(fluxos)} evento(s), "
        f"{brl(fim['recebido_acum'])} no total", expanded=False
    ):
        tabela = fluxos.copy()
        tabela["data"] = pd.to_datetime(tabela["data"]).dt.strftime("%d/%m/%Y")
        tabela = tabela.rename(columns={"data": "Data", "tipo": "Tipo",
                                        "por_titulo": "Por título (R$)",
                                        "total": "Total (R$)"})
        st.dataframe(tabela, hide_index=True, use_container_width=True)
        st.caption(
            "A linha “Valor na curva” considera esse dinheiro parado em caixa. "
            "A linha “reinvestindo” supõe reaplicação à mesma taxa contratada. "
            "O valor a mercado recebe o mesmo tratamento de caixa, para a "
            "comparação ficar entre iguais."
        )

# ---------------------------------------------------------------------------
# Detalhes e exportação
# ---------------------------------------------------------------------------

with st.expander("Série completa e metodologia", expanded=False):
    st.dataframe(
        serie[["data", "dias_uteis", "taxa_mercado", "vna", "pu_curva",
               "pu_mercado", "recebido_acum", "curva_caixa", "mercado_caixa",
               "agio", "agio_pct"]],
        hide_index=True, use_container_width=True, height=300,
    )
    st.download_button(
        "Baixar série em CSV",
        serie.to_csv(index=False, sep=";", decimal=",").encode("utf-8-sig"),
        file_name=f"simulacao_{titulo.replace(' ', '_')}_{pos.vencimento}.csv",
        mime="text/csv",
    )
    st.markdown(
        """
**Como o valor na curva é calculado**

Toma-se o mesmo fluxo de caixa contratual do título e desconta-se à taxa que
ficou travada no dia da compra, em dias úteis sobre 252, calendário ANBIMA.
Para os títulos indexados, o VNA de cada data é extraído do próprio preço
publicado pelo Tesouro (VNA = PU ÷ cotação), o que dispensa baixar séries
separadas de IPCA, IGP-M ou Selic.

**O que ainda não entra na conta**

Imposto de renda, taxa de custódia da B3 e taxa da corretora. Os valores são
brutos. Também não há garantia de que o preço de venda publicado estivesse
efetivamente disponível em cada dia.

Fonte: Tesouro Transparente, conjunto “Taxas dos Títulos Ofertados pelo
Tesouro Direto”, licença aberta ODbL.
        """
    )
