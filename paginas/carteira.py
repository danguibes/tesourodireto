"""Página Carteira — importa várias compras de uma planilha e consolida."""

from __future__ import annotations

import io
from datetime import date

import altair as alt
import numpy as np
import pandas as pd
import streamlit as st

import tesouro_core as tc
import tesouro_dados as td
import ui_comum as ui

st.title("Carteira")
st.caption(
    "Suba uma planilha com as suas compras e veja o ágio ou deságio de cada "
    "posição na data mais recente disponível."
)

ui.botao_atualizar()
df = ui.dados_ou_para()
cat = ui.catalogo(df, len(df))
ultima = df["data_base"].max()

st.sidebar.caption(
    f"{len(df):,.0f} observações · dados até {ultima:%d/%m/%Y}".replace(",", ".")
)

# ---------------------------------------------------------------------------
# Modelo de planilha
# ---------------------------------------------------------------------------

MODELO = pd.DataFrame({
    "data_compra": ["30/01/2023", "15/06/2024", "02/09/2025"],
    "titulo": ["Tesouro IPCA+ 2035",
               "Tesouro Prefixado 2029",
               "Tesouro Renda+ Aposentadoria Extra 2030"],
    "quantidade": [1.5, 10, 4.2],
    "vencimento": ["", "", ""],
    "pu_compra": ["", "", ""],
})

with st.expander("Como montar a planilha", expanded=False):
    st.markdown(
        """
Três colunas bastam: **data_compra**, **titulo** e **quantidade**.

O nome do título pode vir como você vê na corretora — "Tesouro IPCA+ 2035",
"Tesouro Prefixado com Juros Semestrais 2033", "Tesouro Educa+ 2028". O ano no
nome do RendA+ e do Educa+ é o de conversão, e o app já faz a conversão para o
vencimento real.

Duas colunas opcionais resolvem casos específicos:

- **vencimento** — obrigatória quando o ano sozinho é ambíguo, como no
  Tesouro IPCA+ 2026, que tem vencimento em maio e em agosto.
- **pu_compra** — o preço que você realmente pagou. Sem ela, o app usa o preço
  de abertura publicado naquele dia, que pode diferir alguns centavos do seu.

Em vez de **quantidade** você pode informar **valor_aplicado** em reais, e o
app calcula a quantidade. Aceita CSV (separado por `;` ou `,`) e Excel.
        """
    )
    st.dataframe(MODELO, hide_index=True, use_container_width=True)
    st.download_button(
        "Baixar modelo em CSV",
        MODELO.to_csv(index=False, sep=";").encode("utf-8-sig"),
        file_name="modelo_carteira.csv", mime="text/csv",
    )

arquivo = st.file_uploader("Planilha de compras", type=["csv", "xlsx", "xls"])

if arquivo is None:
    st.info("Envie uma planilha para começar.")
    st.stop()


# ---------------------------------------------------------------------------
# Leitura da planilha
# ---------------------------------------------------------------------------

def ler_planilha(arq) -> pd.DataFrame:
    if arq.name.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(arq)
    bruto = arq.getvalue().decode("utf-8-sig", errors="replace")
    return pd.read_csv(io.StringIO(bruto), sep=None, engine="python")


def num_br(v):
    """Aceita 1.234,56 e 1234.56."""
    if pd.isna(v) or v == "":
        return np.nan
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("R$", "").replace(" ", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return np.nan


try:
    entrada = ler_planilha(arquivo)
except Exception as exc:  # noqa: BLE001
    st.error(f"Não consegui ler a planilha: {exc}")
    st.stop()

entrada.columns = [str(c).strip().lower().replace(" ", "_")
                   for c in entrada.columns]

faltando = [c for c in ("data_compra", "titulo") if c not in entrada.columns]
if faltando:
    st.error(f"A planilha precisa das colunas: {', '.join(faltando)}.")
    st.stop()

if "quantidade" not in entrada.columns and "valor_aplicado" not in entrada.columns:
    st.error("Informe uma coluna quantidade ou valor_aplicado.")
    st.stop()

# ---------------------------------------------------------------------------
# Processamento linha a linha
# ---------------------------------------------------------------------------

resultados, problemas, series = [], [], {}

with st.spinner("Reprecificando as posições..."):
    for i, linha in entrada.iterrows():
        rotulo = f"linha {i + 2}"
        try:
            d_compra = pd.to_datetime(linha["data_compra"], dayfirst=True)
        except Exception:  # noqa: BLE001
            problemas.append(f"{rotulo}: data de compra inválida "
                             f"(“{linha['data_compra']}”)")
            continue

        venc_informado = linha.get("vencimento")
        if isinstance(venc_informado, str) and not venc_informado.strip():
            venc_informado = None
        if venc_informado is not None and not pd.isna(venc_informado):
            try:
                venc_informado = pd.to_datetime(venc_informado, dayfirst=True)
            except Exception:  # noqa: BLE001
                venc_informado = None

        papel, erro = ui.resolver_titulo(cat, linha["titulo"], venc_informado)
        if papel is None:
            problemas.append(f"{rotulo}: {erro}")
            continue

        qtd = num_br(linha.get("quantidade"))
        val = num_br(linha.get("valor_aplicado"))
        if not np.isfinite(qtd) and not np.isfinite(val):
            problemas.append(f"{rotulo}: sem quantidade nem valor aplicado")
            continue

        try:
            pos, serie = td.simular(
                df, papel["titulo"], papel["vencimento"], d_compra,
                valor_aplicado=None if np.isfinite(qtd) else val,
                quantidade=qtd if np.isfinite(qtd) else None,
            )
        except ValueError as exc:
            problemas.append(f"{rotulo}: {exc}")
            continue

        # Preço realmente pago, quando informado.
        pu_informado = num_br(linha.get("pu_compra"))
        aplicado = (pu_informado * pos.quantidade
                    if np.isfinite(pu_informado) else pos.aplicado)

        fim = serie.iloc[-1]
        chave = f"{papel['titulo']} {papel['vencimento']:%Y} ({d_compra:%d/%m/%y})"
        series[chave] = serie[["data", "curva_caixa", "mercado_caixa"]]

        resultados.append({
            "Título": papel["titulo"],
            "Vencimento": papel["vencimento"].date(),
            "Compra": pos.data_compra,
            "Taxa (% a.a.)": pos.taxa,
            "Qtd.": pos.quantidade,
            "Aplicado": aplicado,
            "Na curva": fim["curva_caixa"],
            "A mercado": fim["mercado_caixa"],
            "Ágio (R$)": fim["agio"],
            "Ágio (%)": fim["agio_pct"],
            "Retorno a mercado (%)": (fim["mercado_caixa"] / aplicado - 1) * 100,
        })

if problemas:
    with st.expander(f"{len(problemas)} linha(s) com problema", expanded=True):
        for p in problemas:
            st.warning(p, icon="⚠️")

if not resultados:
    st.error("Nenhuma linha pôde ser processada.")
    st.stop()

res = pd.DataFrame(resultados)

# ---------------------------------------------------------------------------
# Consolidado
# ---------------------------------------------------------------------------

tot_aplicado = res["Aplicado"].sum()
tot_curva = res["Na curva"].sum()
tot_mercado = res["A mercado"].sum()
tot_agio = tot_mercado - tot_curva

st.subheader(f"Consolidado em {ultima:%d/%m/%Y}")

c1, c2, c3, c4 = st.columns(4)
c1.metric("Aplicado", ui.brl(tot_aplicado))
c2.metric("Na curva", ui.brl(tot_curva),
          f"{(tot_curva / tot_aplicado - 1) * 100:+.2f}%")
c3.metric("A mercado", ui.brl(tot_mercado),
          f"{(tot_mercado / tot_aplicado - 1) * 100:+.2f}%")
c4.metric("Ágio sobre a curva", ui.brl(tot_agio),
          f"{(tot_mercado / tot_curva - 1) * 100:+.2f}%")

st.dataframe(
    res, hide_index=True, use_container_width=True,
    column_config={
        "Vencimento": st.column_config.DateColumn(format="DD/MM/YYYY"),
        "Compra": st.column_config.DateColumn(format="DD/MM/YYYY"),
        "Taxa (% a.a.)": st.column_config.NumberColumn(format="%.2f"),
        "Qtd.": st.column_config.NumberColumn(format="%.4f"),
        "Aplicado": st.column_config.NumberColumn(format="R$ %.2f"),
        "Na curva": st.column_config.NumberColumn(format="R$ %.2f"),
        "A mercado": st.column_config.NumberColumn(format="R$ %.2f"),
        "Ágio (R$)": st.column_config.NumberColumn(format="R$ %.2f"),
        "Ágio (%)": st.column_config.NumberColumn(format="%+.2f%%"),
        "Retorno a mercado (%)": st.column_config.NumberColumn(format="%+.2f%%"),
    },
)

st.download_button(
    "Baixar resultado em CSV",
    res.to_csv(index=False, sep=";", decimal=",").encode("utf-8-sig"),
    file_name="carteira_agio.csv", mime="text/csv",
)

# ---------------------------------------------------------------------------
# Gráficos
# ---------------------------------------------------------------------------

st.subheader("Ágio por posição")

barras = res.copy()
barras["rotulo"] = (barras["Título"].str.replace("Tesouro ", "", regex=False)
                    + " " + barras["Vencimento"].map(lambda d: str(d.year))
                    + " · " + barras["Compra"].map(lambda d: f"{d:%m/%y}"))

gr = (
    alt.Chart(barras)
    .mark_bar()
    .encode(
        y=alt.Y("rotulo:N", title=None, sort="-x"),
        x=alt.X("Ágio (%):Q", title="% sobre o valor na curva"),
        color=alt.condition(alt.datum["Ágio (%)"] >= 0,
                            alt.value(ui.COR_POSITIVO), alt.value(ui.COR_MERCADO)),
        tooltip=["Título", alt.Tooltip("Ágio (R$):Q", format=",.2f"),
                 alt.Tooltip("Ágio (%):Q", format="+.2f")],
    )
    .properties(height=max(140, 34 * len(barras)))
)
st.altair_chart(gr, use_container_width=True)

with st.expander("Evolução consolidada da carteira", expanded=False):
    quadro = None
    for chave, s in series.items():
        s = s.set_index("data")[["curva_caixa", "mercado_caixa"]]
        quadro = s if quadro is None else quadro.add(
            s.reindex(quadro.index.union(s.index)).ffill().fillna(0.0),
            fill_value=0.0,
        )
    quadro = quadro.reset_index().melt(
        id_vars="data", var_name="serie", value_name="valor")
    quadro["serie"] = quadro["serie"].map(
        {"curva_caixa": "Valor na curva", "mercado_caixa": "Valor a mercado"})

    linha = (
        alt.Chart(quadro)
        .mark_line(strokeWidth=2)
        .encode(
            x=alt.X("data:T", title=None),
            y=alt.Y("valor:Q", title="R$", scale=alt.Scale(zero=False)),
            color=alt.Color(
                "serie:N", title=None,
                scale=alt.Scale(domain=["Valor na curva", "Valor a mercado"],
                                range=[ui.COR_CURVA, ui.COR_MERCADO]),
                legend=alt.Legend(orient="top")),
            tooltip=[alt.Tooltip("data:T", title="Data", format="%d/%m/%Y"),
                     alt.Tooltip("serie:N", title=""),
                     alt.Tooltip("valor:Q", title="R$", format=",.2f")],
        )
        .properties(height=340)
    )
    st.altair_chart(linha, use_container_width=True)
    st.caption(
        "Cada posição entra na soma a partir da sua data de compra, então os "
        "degraus na linha são aportes novos, não valorização."
    )
