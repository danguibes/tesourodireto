"""Página Simulação — uma compra hipotética, curva vs. mercado dia a dia."""

from __future__ import annotations

from datetime import date

import altair as alt
import pandas as pd
import streamlit as st

import tesouro_core as tc
import tesouro_dados as td
import ui_comum as ui

st.sidebar.title("Simulação")
ui.botao_atualizar()

df = ui.dados_ou_para()
cat = ui.catalogo(df, len(df))

st.sidebar.caption(
    f"{len(df):,.0f} observações · dados até "
    f"{df['data_base'].max():%d/%m/%Y}".replace(",", ".")
)

titulos = sorted(cat["titulo"].unique())
titulo = st.sidebar.selectbox(
    "Título", titulos,
    index=titulos.index("Tesouro IPCA+") if "Tesouro IPCA+" in titulos else 0,
)

opcoes = cat.loc[cat["titulo"] == titulo].sort_values("vencimento")
venc_labels = {
    f"{r.vencimento:%d/%m/%Y}  (preços de {r.primeira_data:%m/%Y} "
    f"a {r.ultima_data:%m/%Y})": r.vencimento
    for r in opcoes.itertuples()
}
venc_label = st.sidebar.selectbox("Vencimento", list(venc_labels))
vencimento = venc_labels[venc_label]

papel = td.historico_papel(df, titulo, vencimento)
d_min = papel["data_base"].min().date()
d_max = papel["data_base"].max().date()
padrao = max(d_min, min(d_max, date(d_max.year - 2, d_max.month, 1)))

data_compra = st.sidebar.date_input(
    "Data da compra", value=padrao,
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

try:
    pos, serie = td.simular(df, titulo, vencimento, data_compra,
                            valor_aplicado=valor)
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
    f"PU de {ui.brl(pos.pu_compra)} · {pos.quantidade:,.4f} títulos"
)

c1, c2, c3, c4 = st.columns(4)
c1.metric("Aplicado", ui.brl(pos.aplicado))
c2.metric("Na curva", ui.brl(fim["curva_caixa"]),
          f"{(fim['curva_caixa'] / pos.aplicado - 1) * 100:+.2f}%")
c3.metric("A mercado", ui.brl(fim["mercado_caixa"]),
          f"{(fim['mercado_caixa'] / pos.aplicado - 1) * 100:+.2f}%")
c4.metric("Ágio sobre a curva", ui.brl(fim["agio"]), f"{fim['agio_pct']:+.2f}%")

if fim["agio"] >= 0:
    st.success(
        f"Em {fim['data']:%d/%m/%Y} o mercado pagava "
        f"{ui.brl(abs(fim['agio']))} a mais que o valor teórico. Vender "
        f"antecipadamente nesse dia teria antecipado rendimento."
    )
else:
    st.info(
        f"Em {fim['data']:%d/%m/%Y} o mercado pagava "
        f"{ui.brl(abs(fim['agio']))} a menos que o valor teórico. Levar até o "
        f"vencimento devolve essa diferença, desde que o título seja mantido."
    )

# ---------------------------------------------------------------------------
# O contrato: o que ficou travado na compra vs. o que o mercado diz hoje
# ---------------------------------------------------------------------------

ini = serie.iloc[0]
q = pos.quantidade
du_restantes = tc.dias_uteis(fim["data"].date(), pos.vencimento)
du_totais = tc.dias_uteis(pos.data_compra, pos.vencimento)

cot_compra = pos.pu_compra / ini["vna"]
cot_hoje = (fim["pu_mercado"] / q) / fim["vna"]


def _linha(rotulo, na_compra, hoje, variacao, ajuda=""):
    return {"Item": rotulo, "Na compra": na_compra, "Hoje": hoje,
            "Variação": variacao, "_ajuda": ajuda}


linhas = [
    _linha("Taxa (% a.a.)",
           f"{pos.taxa:.2f} (contratada)",
           f"{fim['taxa_mercado']:.2f} (mercado)",
           f"{fim['taxa_mercado'] - pos.taxa:+.2f} p.p."),
    _linha("PU por título",
           ui.brl(pos.pu_compra),
           ui.brl(fim["pu_mercado"] / q),
           f"{(fim['pu_mercado'] / q / pos.pu_compra - 1) * 100:+.2f}%"),
    _linha("Cotação (% do VNA)",
           f"{cot_compra * 100:.2f}%",
           f"{cot_hoje * 100:.2f}%",
           f"{(cot_hoje - cot_compra) * 100:+.2f} p.p."),
    _linha("VNA",
           ui.brl(ini["vna"]),
           ui.brl(fim["vna"]),
           f"{(fim['vna'] / ini['vna'] - 1) * 100:+.2f}%"),
    _linha("Dias úteis até o vencimento",
           f"{du_totais:,}".replace(",", "."),
           f"{du_restantes:,}".replace(",", "."),
           f"{int(fim['dias_uteis']):,} decorridos".replace(",", ".")),
    _linha("Prazo restante",
           f"{du_totais / 252:.1f} anos",
           f"{du_restantes / 252:.1f} anos",
           f"{fim['anos']:.1f} anos decorridos"),
]

if paga_fluxo:
    linhas.append(_linha(
        "Caixa recebido (cupons)", "—",
        ui.brl(fim["recebido_acum"]),
        f"{fim['recebido_acum'] / fim['curva_caixa'] * 100:.1f}% do valor na curva"))

with st.expander("O contrato: na compra vs. hoje", expanded=True):
    st.dataframe(
        pd.DataFrame(linhas).drop(columns="_ajuda"),
        hide_index=True, use_container_width=True,
    )
    st.caption(
        f"A taxa da compra é a de aplicação e a de hoje é a de resgate — o "
        f"spread entre as duas é do próprio Tesouro, hoje em "
        f"{fim['taxa_mercado'] - float(papel.iloc[-1]['taxa_compra']):.2f} p.p. "
        f"A cotação é o PU dividido pelo VNA, e é a única medida da tabela que "
        f"independe de quando você comprou. O VNA carrega apenas o indexador; "
        f"nos prefixados ele é fixo em R$ 1.000."
    )

cols = ["curva_caixa", "mercado_caixa"]
rotulos = {"curva_caixa": "Valor na curva", "mercado_caixa": "Valor a mercado"}
cores = [ui.COR_CURVA, ui.COR_MERCADO]

if mostrar_reinvest and paga_fluxo:
    cols.append("curva_reinvest")
    rotulos["curva_reinvest"] = "Na curva, reinvestindo"
    cores.append(ui.COR_REINVEST)

longo = serie.melt(id_vars="data", value_vars=cols,
                   var_name="serie", value_name="valor")
longo["serie"] = longo["serie"].map(rotulos)

st.altair_chart(
    alt.Chart(longo).mark_line(strokeWidth=2).encode(
        x=alt.X("data:T", title=None),
        y=alt.Y("valor:Q", title="R$", scale=alt.Scale(zero=False)),
        color=alt.Color("serie:N", title=None,
                        scale=alt.Scale(domain=list(rotulos.values()),
                                        range=cores),
                        legend=alt.Legend(orient="top")),
        tooltip=[alt.Tooltip("data:T", title="Data", format="%d/%m/%Y"),
                 alt.Tooltip("serie:N", title=""),
                 alt.Tooltip("valor:Q", title="R$", format=",.2f")],
    ).properties(height=380),
    use_container_width=True,
)

with st.expander("Ágio/deságio ao longo do tempo", expanded=False):
    st.altair_chart(
        alt.Chart(serie).mark_area(opacity=0.75).encode(
            x=alt.X("data:T", title=None),
            y=alt.Y("agio_pct:Q", title="% sobre o valor na curva"),
            color=alt.condition(alt.datum.agio_pct >= 0,
                                alt.value(ui.COR_POSITIVO),
                                alt.value(ui.COR_MERCADO)),
            tooltip=[alt.Tooltip("data:T", title="Data", format="%d/%m/%Y"),
                     alt.Tooltip("agio_pct:Q", title="Ágio %", format="+.2f"),
                     alt.Tooltip("taxa_mercado:Q", title="Taxa de venda",
                                 format=".2f")],
        ).properties(height=240),
        use_container_width=True,
    )
    st.caption(
        "Acima de zero, o mercado paga mais que o valor teórico — em geral "
        "porque as taxas caíram desde a compra. Abaixo de zero, o contrário."
    )

if paga_fluxo:
    fluxos = td.fluxos_do_papel(pos, serie)
    with st.expander(
        f"Pagamentos recebidos até aqui — {len(fluxos)} evento(s), "
        f"{ui.brl(fim['recebido_acum'])} no total", expanded=False
    ):
        tabela = fluxos.copy()
        tabela["data"] = pd.to_datetime(tabela["data"]).dt.strftime("%d/%m/%Y")
        st.dataframe(
            tabela.rename(columns={"data": "Data", "tipo": "Tipo",
                                   "por_titulo": "Por título (R$)",
                                   "total": "Total (R$)"}),
            hide_index=True, use_container_width=True,
        )
        st.caption(
            "A linha “Valor na curva” considera esse dinheiro parado em caixa. "
            "A linha “reinvestindo” supõe reaplicação à mesma taxa contratada. "
            "O valor a mercado recebe o mesmo tratamento, para a comparação "
            "ficar entre iguais."
        )

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
