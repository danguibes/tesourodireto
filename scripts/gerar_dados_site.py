"""
Gera os dados estáticos do site a partir do histórico do Tesouro Transparente.

Roda no GitHub Actions, nunca no navegador. A saída é um conjunto de JSONs
pequenos publicados junto com a página no GitHub Pages — o visitante nunca
toca o portal do governo.

Desde outubro de 2026 o portal responde a scripts com uma página de desafio
em JavaScript (HTTP 200, HTML no lugar do CSV), inclusive de IP residencial.
Por isso o CSV vem do navegador, sobe como anexo do release `fonte` e chega
aqui por --arquivo. O download direto ficou como alternativa, e falha na
conferência do cabeçalho enquanto o desafio existir.

Estrutura gerada em <destino>/dados/:
    meta.json       data base mais recente e carimbo de geração
    feriados.json   calendário ANBIMA, usado pelo JS para contar dias úteis
    papeis.json     índice de todos os papéis, com período coberto
    indices.json    séries de VNA de IPCA, Selic e IGP-M
    p/<id>.json     série diária de cada papel, em formato colunar

Uso:  python scripts/gerar_dados_site.py <destino> [--arquivo <csv>]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import requests

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

import tesouro_core as tc  # noqa: E402

URL_CSV = (
    "https://www.tesourotransparente.gov.br/ckan/dataset/"
    "df56aa42-484a-4a59-8184-7676580c81e3/resource/"
    "796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv"
)

COLUNAS = ["titulo", "vencimento", "data_base", "taxa_compra",
           "taxa_venda", "pu_compra", "pu_venda", "pu_base"]

CABECALHO_ESPERADO = [
    "Tipo Titulo", "Data Vencimento", "Data Base",
    "Taxa Compra Manha", "Taxa Venda Manha",
    "PU Compra Manha", "PU Venda Manha", "PU Base Manha",
]

TITULOS_CONHECIDOS = {
    "Tesouro Educa+", "Tesouro IGPM+ com Juros Semestrais", "Tesouro IPCA+",
    "Tesouro IPCA+ com Juros Semestrais", "Tesouro Prefixado",
    "Tesouro Prefixado com Juros Semestrais",
    "Tesouro Renda+ Aposentadoria Extra", "Tesouro Selic",
}

CABECALHOS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"),
    "Accept": "text/csv,text/plain,*/*",
    "Accept-Language": "pt-BR,pt;q=0.9",
}

TENTATIVAS, ESPERA_BASE = 5, 20
EPOCA = date(1970, 1, 1)


def num_dia(d) -> int:
    """Data -> dias desde 1970-01-01, o formato que o JavaScript consome."""
    return (pd.Timestamp(d).date() - EPOCA).days


def slug(texto: str) -> str:
    t = unicodedata.normalize("NFKD", str(texto))
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = t.lower().replace("+", "-mais").replace("&", "e")
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", t)).strip("-")


# ---------------------------------------------------------------------------

def baixar(destino: Path) -> None:
    ultimo = None
    for tentativa in range(1, TENTATIVAS + 1):
        try:
            resp = requests.get(URL_CSV, headers=CABECALHOS,
                                timeout=600, stream=True)
            if resp.status_code == 200:
                parcial = destino.with_suffix(".parcial")
                with open(parcial, "wb") as fh:
                    for bloco in resp.iter_content(chunk_size=1 << 20):
                        fh.write(bloco)
                parcial.replace(destino)
                print(f"Baixado: {destino.stat().st_size / 1e6:.1f} MB")
                return
            ultimo = f"HTTP {resp.status_code}"
        except requests.RequestException as exc:
            ultimo = str(exc)

        if tentativa < TENTATIVAS:
            espera = ESPERA_BASE * 2 ** (tentativa - 1)
            print(f"Tentativa {tentativa} falhou ({ultimo}); "
                  f"nova tentativa em {espera}s.", flush=True)
            time.sleep(espera)

    raise SystemExit(f"Falhei em {TENTATIVAS} tentativas. Último erro: {ultimo}")


def conferir_cabecalho(caminho: Path) -> None:
    with open(caminho, encoding="utf-8-sig") as fh:
        cab = [c.strip() for c in fh.readline().strip().split(";")]
    if cab != CABECALHO_ESPERADO:
        raise SystemExit("O layout do arquivo mudou.\n"
                         f"  esperado: {CABECALHO_ESPERADO}\n"
                         f"  recebido: {cab}")
    print("Cabeçalho confere com o layout esperado.")


def carregar(caminho: Path) -> pd.DataFrame:
    df = pd.read_csv(caminho, sep=";", encoding="utf-8-sig", decimal=",",
                     names=COLUNAS, header=0, dtype={"titulo": "string"})
    for col in ("vencimento", "data_base"):
        df[col] = pd.to_datetime(df[col], format="%d/%m/%Y", errors="coerce")

    antes = len(df)
    df = df.dropna(subset=["vencimento", "data_base", "pu_venda", "taxa_venda"])
    if antes != len(df):
        print(f"Descartadas {antes - len(df)} linhas incompletas.")

    df["titulo"] = df["titulo"].str.strip()
    novos = set(df["titulo"].unique()) - TITULOS_CONHECIDOS
    if novos:
        print(f"ATENCAO: títulos novos no arquivo: {sorted(novos)}")
    for n in df["titulo"].unique():
        tc.classificar(n)   # falha cedo se um nome novo não for reconhecido

    return df.sort_values(["titulo", "vencimento", "data_base"],
                          ignore_index=True)


def series_indices(df: pd.DataFrame) -> dict:
    """
    Reconstrói IPCA, Selic e IGP-M a partir dos próprios preços.

    O VNA de um título indexado é o valor nominal já corrigido pelo índice,
    e sai de VNA = PU / cotação. Nenhuma fonte externa é consultada.
    """
    saida = {}

    for chave, nome in (("ipca", "Tesouro IPCA+"), ("selic", "Tesouro Selic")):
        sub = df.loc[df["titulo"] == nome,
                     ["data_base", "vencimento", "taxa_venda", "pu_venda"]]
        if sub.empty:
            continue
        du = tc.dias_uteis_vetor(sub["data_base"].to_numpy(),
                                 sub["vencimento"].to_numpy())
        vna = sub["pu_venda"].to_numpy() * (
            1 + sub["taxa_venda"].to_numpy() / 100.0) ** (du / 252.0)
        # A mediana entre vencimentos absorve o arredondamento da taxa.
        saida[chave] = (pd.Series(vna, index=sub["data_base"].to_numpy())
                        .groupby(level=0).median())

    ntnc = df.loc[df["titulo"].map(tc.classificar) == tc.NTNC]
    if not ntnc.empty:
        pedacos = []
        for (nome, venc), g in ntnc.groupby(["titulo", "vencimento"]):
            cot = [tc.cotacao(nome, venc.date(), d.date(), t)
                   for d, t in zip(g["data_base"], g["taxa_venda"])]
            pedacos.append(pd.Series(g["pu_venda"].to_numpy() / cot,
                                     index=g["data_base"].to_numpy()))
        if pedacos:
            saida["igpm"] = pd.concat(pedacos).groupby(level=0).median()

    if not saida:
        return {"d": []}

    quadro = pd.DataFrame(saida).sort_index()
    out = {"d": [num_dia(x) for x in quadro.index]}
    for col in quadro.columns:
        out[col] = [None if pd.isna(v) else round(float(v), 6)
                    for v in quadro[col]]
    return out


def main() -> None:
    args = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    args.add_argument("destino", nargs="?", default="site")
    args.add_argument("--arquivo", type=Path,
                      help="CSV já baixado pelo navegador; sem ele, tenta o portal")
    args = args.parse_args()

    destino = Path(args.destino)
    dados = destino / "dados"
    papeis_dir = dados / "p"
    papeis_dir.mkdir(parents=True, exist_ok=True)

    if args.arquivo:
        csv = args.arquivo
        print(f"Lendo {csv} ({csv.stat().st_size / 1e6:.1f} MB)")
    else:
        csv = dados / "bruto.csv"
        baixar(csv)
    conferir_cabecalho(csv)
    df = carregar(csv)
    if not args.arquivo:
        csv.unlink(missing_ok=True)

    # CSV achatado com o último dia, para planilhas consumirem via IMPORTDATA.
    # O Google Sheets não consegue mais ler o portal do Tesouro direto, mas lê
    # o GitHub Pages sem problema.
    ultimo = df["data_base"].max()
    dia = df.loc[df["data_base"] == ultimo].sort_values(["titulo", "vencimento"])
    linhas_csv = ["Data base;Titulo;Vencimento;Taxa de compra;Taxa de venda;"
                  "PU de compra;PU de venda"]
    for r in dia.itertuples():
        linhas_csv.append(";".join([
            f"{r.data_base:%d/%m/%Y}", r.titulo, f"{r.vencimento:%d/%m/%Y}",
            f"{r.taxa_compra:.2f}".replace(".", ","),
            f"{r.taxa_venda:.2f}".replace(".", ","),
            f"{r.pu_compra:.2f}".replace(".", ","),
            f"{r.pu_venda:.2f}".replace(".", ","),
        ]))
    (dados / "ultimo_dia.csv").write_text(
        "\n".join(linhas_csv) + "\n", encoding="utf-8")
    print(f"ultimo_dia.csv: {len(dia)} títulos em {ultimo:%d/%m/%Y}")

    # Feriados ANBIMA, para o JS montar o mesmo calendário.
    feriados = sorted(d.isoformat() for d in tc._CAL.holidays)
    (dados / "feriados.json").write_text(json.dumps({
        "inicio": tc.INICIO_CAL.isoformat(),
        "fim": tc.FIM_CAL.isoformat(),
        "feriados": feriados,
    }, separators=(",", ":")), encoding="utf-8")
    print(f"feriados.json: {len(feriados)} datas")

    # Um arquivo por papel, em colunas.
    indice, total_bytes = [], 0
    for (titulo, venc), g in df.groupby(["titulo", "vencimento"], sort=True):
        g = g.sort_values("data_base")
        ident = f"{slug(titulo)}-{venc:%Y%m%d}"
        corpo = {
            "titulo": titulo,
            "vencimento": num_dia(venc),
            "familia": tc.classificar(titulo),
            "d": [num_dia(x) for x in g["data_base"]],
            "tc": [round(float(v), 4) for v in g["taxa_compra"].fillna(0)],
            "tv": [round(float(v), 4) for v in g["taxa_venda"]],
            "pc": [round(float(v), 6) for v in g["pu_compra"].fillna(0)],
            "pv": [round(float(v), 6) for v in g["pu_venda"]],
        }
        caminho = papeis_dir / f"{ident}.json"
        caminho.write_text(json.dumps(corpo, separators=(",", ":")),
                           encoding="utf-8")
        total_bytes += caminho.stat().st_size

        indice.append({
            "id": ident, "titulo": titulo, "vencimento": num_dia(venc),
            "familia": tc.classificar(titulo),
            "indexador": tc.INDEXADOR[tc.classificar(titulo)],
            "primeira": num_dia(g["data_base"].iloc[0]),
            "ultima": num_dia(g["data_base"].iloc[-1]),
            "n": len(g),
        })

    (dados / "papeis.json").write_text(
        json.dumps(indice, separators=(",", ":")), encoding="utf-8")
    print(f"papeis.json: {len(indice)} papéis "
          f"({total_bytes / 1e6:.1f} MB em p/, "
          f"maior {max(c.stat().st_size for c in papeis_dir.glob('*.json')) / 1e3:.0f} KB)")

    idx = series_indices(df)
    (dados / "indices.json").write_text(
        json.dumps(idx, separators=(",", ":")), encoding="utf-8")
    print(f"indices.json: {len(idx['d'])} datas, "
          f"séries {[k for k in idx if k != 'd']}")

    ultima = df["data_base"].max()
    (dados / "meta.json").write_text(json.dumps({
        "ultimaDataBase": num_dia(ultima),
        "ultimaDataBaseTexto": f"{ultima:%d/%m/%Y}",
        "observacoes": int(len(df)),
        "geradoEm": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fonte": "Tesouro Transparente (Tesouro Nacional), licença ODbL",
    }, separators=(",", ":")), encoding="utf-8")

    print(f"Data base mais recente: {ultima:%d/%m/%Y} "
          f"({len(df):,} observações)".replace(",", "."))
    with open("ultima_data.txt", "w", encoding="utf-8") as fh:
        fh.write(f"{ultima:%Y-%m-%d}")


if __name__ == "__main__":
    main()
