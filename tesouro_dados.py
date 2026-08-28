"""
Carga do histórico de preços do Tesouro Direto e montagem da série
"valor na curva vs. valor a mercado" para uma posição simulada.

Fonte: Tesouro Transparente (Tesouro Nacional), conjunto de dados
"Taxas dos Títulos Ofertados pelo Tesouro Direto", licença aberta ODbL.
"""

from __future__ import annotations

import tempfile
import time
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

import tesouro_core as tc

URL_CSV = (
    "https://www.tesourotransparente.gov.br/ckan/dataset/"
    "df56aa42-484a-4a59-8184-7676580c81e3/resource/"
    "796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv"
)

def _pasta_cache() -> Path:
    """
    Pasta de cache gravável.

    Em execução local é a subpasta `dados/`. Em ambientes de nuvem com disco
    somente-leitura, cai para a pasta temporária do sistema.
    """
    candidata = Path(__file__).parent / "dados"
    try:
        candidata.mkdir(exist_ok=True)
        teste = candidata / ".escrita"
        teste.touch()
        teste.unlink()
        return candidata
    except OSError:
        alt = Path(tempfile.gettempdir()) / "tesouro_direto_cache"
        alt.mkdir(exist_ok=True)
        return alt


PASTA = _pasta_cache()
CSV_BRUTO = PASTA / "precotaxatesourodireto.csv"
PARQUET = PASTA / "historico.parquet"

COLUNAS = [
    "titulo", "vencimento", "data_base",
    "taxa_compra", "taxa_venda", "pu_compra", "pu_venda", "pu_base",
]

MAX_IDADE_HORAS = 20.0   # a fonte publica uma vez por dia útil


# ---------------------------------------------------------------------------
# Download e cache
# ---------------------------------------------------------------------------

def _idade_horas(caminho: Path) -> float:
    return (time.time() - caminho.stat().st_mtime) / 3600


def baixar() -> Path:
    """Baixa o CSV oficial para a pasta de cache."""
    import requests

    resp = requests.get(URL_CSV, timeout=300, stream=True)
    resp.raise_for_status()
    parcial = CSV_BRUTO.with_suffix(".parcial")
    with open(parcial, "wb") as fh:
        for bloco in resp.iter_content(chunk_size=1 << 20):
            fh.write(bloco)
    parcial.replace(CSV_BRUTO)   # só substitui se o download completou
    return CSV_BRUTO


def carregar(forcar_download: bool = False) -> pd.DataFrame:
    """
    Devolve o histórico inteiro já tipado e enriquecido.

    O Parquet é a fonte de verdade do cache: se existir e estiver fresco, o
    CSV nem chega a ser tocado. Isso evita rebaixar 14 MB a cada reinício do
    contêiner na nuvem, onde o disco não sobrevive à hibernação.
    """
    if not forcar_download and PARQUET.exists() \
            and _idade_horas(PARQUET) < MAX_IDADE_HORAS:
        return pd.read_parquet(PARQUET)

    caminho = baixar()

    df = pd.read_csv(
        caminho, sep=";", encoding="utf-8-sig", decimal=",",
        names=COLUNAS, header=0, dtype={"titulo": "string"},
    )
    for col in ("vencimento", "data_base"):
        df[col] = pd.to_datetime(df[col], format="%d/%m/%Y", errors="coerce")

    df = df.dropna(subset=["vencimento", "data_base", "pu_venda"])
    df["titulo"] = df["titulo"].str.strip()

    familias = {n: tc.classificar(n) for n in df["titulo"].unique()}
    df["familia"] = df["titulo"].map(familias).astype("category")
    df["indexador"] = df["familia"].map(tc.INDEXADOR).astype("category")

    df = df.sort_values(["titulo", "vencimento", "data_base"], ignore_index=True)

    df.to_parquet(PARQUET, index=False)
    # O CSV já cumpriu seu papel; o Parquet ocupa menos de um terço do espaço.
    try:
        caminho.unlink()
    except OSError:
        pass
    return df


# ---------------------------------------------------------------------------
# Catálogo de títulos disponíveis
# ---------------------------------------------------------------------------

def catalogo(df: pd.DataFrame) -> pd.DataFrame:
    """Um registro por papel (título + vencimento), com o período coberto."""
    g = df.groupby(["titulo", "vencimento"], observed=True)
    cat = g.agg(
        primeira_data=("data_base", "min"),
        ultima_data=("data_base", "max"),
        observacoes=("data_base", "size"),
        familia=("familia", "first"),
    ).reset_index()
    cat["rotulo"] = (
        cat["titulo"] + " — venc. " + cat["vencimento"].dt.strftime("%d/%m/%Y")
    )
    return cat.sort_values(["titulo", "vencimento"], ignore_index=True)


def historico_papel(df: pd.DataFrame, titulo: str, vencimento) -> pd.DataFrame:
    """Série diária de um papel específico."""
    venc = pd.Timestamp(vencimento)
    m = (df["titulo"] == titulo) & (df["vencimento"] == venc)
    return df.loc[m].sort_values("data_base", ignore_index=True)


# ---------------------------------------------------------------------------
# Simulação
# ---------------------------------------------------------------------------

def simular(df: pd.DataFrame, titulo: str, vencimento,
            data_compra, valor_aplicado: float | None = None,
            quantidade: float | None = None) -> tuple[tc.Posicao, pd.DataFrame]:
    """
    Simula uma compra no passado e devolve (posição, série diária).

    A série traz, para cada data com preço publicado depois da compra:
      pu_curva        — PU teórico, reprecificando o mesmo fluxo à taxa travada
      pu_mercado      — PU de venda efetivamente publicado naquele dia
      recebido_acum   — cupons ou amortizações já pagos, em reais nominais
      curva_caixa     — pu_curva + recebido_acum
      curva_reinvest  — tudo reaplicado à taxa contratada
      mercado_caixa   — pu_mercado + recebido_acum
      agio            — mercado_caixa menos curva_caixa, em reais
    """
    h = historico_papel(df, titulo, vencimento)
    if h.empty:
        raise ValueError("Não há histórico para esse papel.")

    d_compra = pd.Timestamp(data_compra)
    linha = h.loc[h["data_base"] == d_compra]
    if linha.empty:
        anteriores = h.loc[h["data_base"] <= d_compra]
        if anteriores.empty:
            raise ValueError(
                f"Esse papel só tem preço a partir de "
                f"{h['data_base'].min():%d/%m/%Y}."
            )
        linha = anteriores.tail(1)   # dia sem pregão: usa o último preço anterior
    linha = linha.iloc[0]

    pu0 = float(linha["pu_compra"])
    taxa0 = float(linha["taxa_compra"])
    if not np.isfinite(pu0) or pu0 <= 0:
        raise ValueError("Nesse dia o papel não estava disponível para compra.")

    if quantidade is None:
        quantidade = (valor_aplicado / pu0) if valor_aplicado else 1.0

    pos = tc.Posicao(
        nome=titulo,
        vencimento=linha["vencimento"].date(),
        data_compra=linha["data_base"].date(),
        taxa=taxa0,
        pu_compra=pu0,
        quantidade=float(quantidade),
    )

    fut = h.loc[h["data_base"] >= linha["data_base"]].reset_index(drop=True)
    refs = fut["data_base"].dt.date.to_numpy()

    # VNA de cada data, extraído do próprio preço de venda publicado.
    cot_mercado = tc.cotacao_serie(pos.nome, pos.vencimento, refs,
                                   fut["taxa_venda"].to_numpy())
    vna = fut["pu_venda"].to_numpy() / cot_mercado

    # Mesmo fluxo, descontado à taxa que ficou travada na compra.
    cot_curva = tc.cotacao_serie(pos.nome, pos.vencimento, refs,
                                 np.full(len(refs), taxa0))
    pu_curva = cot_curva * vna

    # Pagamentos (cupons ou amortizações) ocorridos após a compra.
    pagos = [(d, v) for d, v in tc.fluxos(pos.nome, pos.vencimento)
             if d > pos.data_compra]
    recebido = np.zeros(len(refs))
    for d_pag, v in pagos:
        idx = int(np.searchsorted(refs, d_pag, side="left"))
        if idx >= len(refs):
            continue
        # Valor do pagamento pelo VNA vigente na data em que ocorreu.
        vna_pag = float(vna[idx])
        recebido[idx:] += v * vna_pag

    du = np.array([tc.dias_uteis(pos.data_compra, r) for r in refs], dtype=float)
    vna0 = float(vna[0])
    fator = vna / vna0
    reinvest = pu0 * (1 + taxa0 / 100.0) ** (du / 252.0) * fator

    q = pos.quantidade
    out = pd.DataFrame({
        "data": fut["data_base"],
        "dias_uteis": du.astype(int),
        "anos": du / 252.0,
        "taxa_mercado": fut["taxa_venda"].to_numpy(),
        "vna": vna,
        "pu_curva": pu_curva * q,
        "pu_mercado": fut["pu_venda"].to_numpy() * q,
        "recebido_acum": recebido * q,
    })
    out["curva_caixa"] = out["pu_curva"] + out["recebido_acum"]
    out["curva_reinvest"] = reinvest * q
    out["mercado_caixa"] = out["pu_mercado"] + out["recebido_acum"]
    out["agio"] = out["mercado_caixa"] - out["curva_caixa"]
    out["agio_pct"] = out["agio"] / out["curva_caixa"] * 100.0

    return pos, out


def series_indices(df: pd.DataFrame) -> pd.DataFrame:
    """
    Reconstrói a evolução dos indexadores a partir dos preços publicados.

    Nenhuma fonte externa é consultada: o VNA de um título indexado é, por
    definição, o valor nominal já corrigido pelo seu índice, e sai de
    `VNA = PU ÷ cotação`. A razão entre dois VNAs é a variação acumulada do
    indexador entre as duas datas.

    Devolve um DataFrame indexado por data_base com as colunas disponíveis
    entre `ipca`, `selic` e `igpm`, em nível (não em variação).

    Ressalva: o VNA embute a projeção de inflação usada pelo mercado para o
    mês corrente, então a série anda um pouco à frente do IPCA divulgado.
    É o índice que o título de fato paga, não o número do IBGE.
    """
    saida: dict[str, pd.Series] = {}

    # Títulos zero-cupom: VNA = PU x (1 + taxa)^(du/252), direto e vetorizado.
    for coluna, nome in (("ipca", "Tesouro IPCA+"), ("selic", "Tesouro Selic")):
        sub = df.loc[df["titulo"] == nome,
                     ["data_base", "vencimento", "taxa_venda", "pu_venda"]]
        sub = sub.dropna()
        if sub.empty:
            continue
        du = tc.dias_uteis_vetor(sub["data_base"].to_numpy(),
                                 sub["vencimento"].to_numpy())
        vna = sub["pu_venda"].to_numpy() * (
            1 + sub["taxa_venda"].to_numpy() / 100.0) ** (du / 252.0)
        # A mediana entre os vencimentos do dia absorve o arredondamento das
        # taxas em duas casas decimais.
        saida[coluna] = (pd.Series(vna, index=sub["data_base"].to_numpy())
                         .groupby(level=0).median())

    # IGP-M só existe em título com cupom (NTN-C), então precisa da cotação.
    ntnc = df.loc[df["familia"] == tc.NTNC]
    if not ntnc.empty:
        pedacos = []
        for (nome, venc), g in ntnc.groupby(["titulo", "vencimento"],
                                            observed=True):
            g = g.dropna(subset=["taxa_venda", "pu_venda"])
            if g.empty:
                continue
            cot = tc.cotacao_serie(nome, venc.date(),
                                   g["data_base"].dt.date.to_numpy(),
                                   g["taxa_venda"].to_numpy())
            pedacos.append(pd.Series(g["pu_venda"].to_numpy() / cot,
                                     index=g["data_base"].to_numpy()))
        if pedacos:
            saida["igpm"] = pd.concat(pedacos).groupby(level=0).median()

    if not saida:
        return pd.DataFrame()

    idx = pd.DataFrame(saida).sort_index()
    idx.index.name = "data"
    return idx


def fluxos_do_papel(pos: tc.Posicao, serie: pd.DataFrame) -> pd.DataFrame:
    """Tabela dos pagamentos (cupom ou amortização) já ocorridos após a compra."""
    linhas = []
    datas = serie["data"].dt.date.to_numpy()
    for d_pag, v in tc.fluxos(pos.nome, pos.vencimento):
        if d_pag <= pos.data_compra or d_pag > datas[-1]:
            continue
        i = int(np.searchsorted(datas, d_pag, side="left"))
        if i >= len(datas):
            continue
        linhas.append({
            "data": d_pag,
            "tipo": "Amortização" if pos.familia == tc.NTNB1 else "Cupom",
            "por_titulo": v * float(serie["vna"].iloc[i]),
            "total": v * float(serie["vna"].iloc[i]) * pos.quantidade,
        })
    return pd.DataFrame(linhas)
