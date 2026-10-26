"""
Gera feriados.json e um fixture com os resultados do Python, para o port
JavaScript ser testado contra a implementação já validada.
"""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np

# tesouro_core.py vive na raiz do repositório, junto do app Streamlit.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import tesouro_core as tc  # noqa: E402

SAIDA = Path(__file__).parent / "fixture"
SAIDA.mkdir(exist_ok=True)

PAPEIS = [
    ("Tesouro Prefixado", date(2029, 1, 1), 12.0, 1000.0),
    ("Tesouro Prefixado com Juros Semestrais", date(2033, 1, 1), 12.5, 1000.0),
    ("Tesouro Selic", date(2031, 3, 1), 0.05, 17000.0),
    ("Tesouro IPCA+", date(2050, 8, 15), 7.0, 4500.0),
    ("Tesouro IPCA+ com Juros Semestrais", date(2045, 5, 15), 6.8, 4500.0),
    ("Tesouro IGPM+ com Juros Semestrais", date(2031, 1, 1), 8.0, 8000.0),
    ("Tesouro Renda+ Aposentadoria Extra", date(2049, 12, 15), 7.2, 4500.0),
    ("Tesouro Educa+", date(2030, 12, 15), 7.6, 4500.0),
]


def iso(d: date) -> str:
    return d.isoformat()


def dia(d: date) -> int:
    return (d - date(1970, 1, 1)).days


def serie_sintetica(nome, venc, inicio, fim, taxa, vna0, cresc=0.0002):
    datas = []
    d = inicio
    while d <= fim:
        if tc.eh_dia_util(d):
            datas.append(d)
        d += timedelta(days=1)

    linhas = []
    for i, dt in enumerate(datas):
        vna = vna0 * (1 + cresc) ** i
        linhas.append({
            "dia": dia(dt),
            "tc": round(taxa - 0.12, 4),
            "tv": round(taxa, 4),
            "pc": tc.cotacao(nome, venc, dt, taxa - 0.12) * vna,
            "pv": tc.cotacao(nome, venc, dt, taxa) * vna,
        })
    return linhas


def simular_py(nome, venc, serie, dia_compra, valor_aplicado):
    """Reproduz tesouro_dados.simular sobre a série sintética."""
    dias = [l["dia"] for l in serie]
    i0 = max(i for i, x in enumerate(dias) if x <= dia_compra)

    pu0 = serie[i0]["pc"]
    taxa0 = serie[i0]["tc"]
    q = valor_aplicado / pu0
    d_compra = date(1970, 1, 1) + timedelta(days=dias[i0])

    sub = serie[i0:]
    n = len(sub)
    vna, pu_curva, pu_merc, datas = [], [], [], []
    for l in sub:
        dt = date(1970, 1, 1) + timedelta(days=l["dia"])
        datas.append(dt)
        v = l["pv"] / tc.cotacao(nome, venc, dt, l["tv"])
        vna.append(v)
        pu_curva.append(tc.cotacao(nome, venc, dt, taxa0) * v)
        pu_merc.append(l["pv"])

    recebido = np.zeros(n)
    for d_pag, val in tc.fluxos(nome, venc):
        if d_pag <= d_compra:
            continue
        idx = next((k for k, x in enumerate(datas) if x >= d_pag), None)
        if idx is None:
            continue
        recebido[idx:] += val * vna[idx]

    out = []
    for k in range(n):
        du = tc.dias_uteis(d_compra, datas[k])
        rec = recebido[k] * q
        curva = pu_curva[k] * q + rec
        merc = pu_merc[k] * q + rec
        reinv = pu0 * (1 + taxa0 / 100) ** (du / 252) * (vna[k] / vna[0]) * q
        out.append({
            "dia": dias[i0 + k], "du": du, "vna": vna[k],
            "puCurva": pu_curva[k] * q, "puMercado": pu_merc[k] * q,
            "recebido": rec, "curvaCaixa": curva, "curvaReinvest": reinv,
            "mercadoCaixa": merc, "agio": merc - curva,
        })
    return {"pu0": pu0, "taxa0": taxa0, "quantidade": q, "linhas": out}


def main() -> None:
    # Feriados ANBIMA, consumidos pelo site e pelo teste.
    feriados = sorted(iso(d) for d in tc._CAL.holidays)
    (SAIDA / "feriados.json").write_text(
        json.dumps({"inicio": "2000-01-03", "fim": "2099-12-25",
                    "feriados": feriados}), encoding="utf-8")
    print(f"feriados.json: {len(feriados)} datas")

    casos = {"calendario": [], "ajusta": [], "fluxos": [],
             "cotacao": [], "simulacao": []}

    # Calendário: pares variados, incluindo fins de semana e feriados.
    rng = np.random.default_rng(42)
    for _ in range(400):
        a = date(2000, 1, 3) + timedelta(days=int(rng.integers(0, 24000)))
        b = a + timedelta(days=int(rng.integers(1, 12000)))
        casos["calendario"].append(
            {"a": dia(a), "b": dia(b), "du": tc.dias_uteis(a, b)})

    for _ in range(300):
        d = date(2000, 1, 3) + timedelta(days=int(rng.integers(0, 24000)))
        casos["ajusta"].append({"d": dia(d), "ajustado": dia(tc.ajusta(d)),
                                "util": tc.eh_dia_util(d)})

    # Fluxos: a lista inteira de cada família.
    for nome, venc, _, _ in PAPEIS:
        fl = tc.fluxos(nome, venc)
        casos["fluxos"].append({
            "nome": nome, "venc": dia(venc), "familia": tc.classificar(nome),
            "n": len(fl),
            "fluxos": [[dia(d), v] for d, v in fl],
        })

    # Cotação em datas e taxas variadas.
    for nome, venc, taxa, _ in PAPEIS:
        for ano in (2015, 2020, 2024, 2026):
            ref = date(ano, 6, 16)
            if ref >= venc:
                continue
            for t in (taxa, taxa + 2.5, max(0.01, taxa - 2.5)):
                casos["cotacao"].append({
                    "nome": nome, "venc": dia(venc), "ref": dia(ref),
                    "taxa": t,
                    "cotacao": tc.cotacao(nome, venc, ref, t),
                })

    # Simulação completa sobre série sintética.
    for nome, venc, taxa, vna0 in PAPEIS:
        inicio, fim = date(2024, 1, 3), date(2026, 8, 26)
        serie = serie_sintetica(nome, venc, inicio, fim, taxa, vna0)
        res = simular_py(nome, venc, serie, dia(date(2024, 1, 3)), 10_000.0)
        casos["simulacao"].append({
            "nome": nome, "venc": dia(venc),
            "serie": serie, "diaCompra": dia(date(2024, 1, 3)),
            "valorAplicado": 10_000.0,
            "esperado": res,
        })

    (SAIDA / "casos.json").write_text(json.dumps(casos), encoding="utf-8")
    print(f"casos.json: {sum(len(v) for v in casos.values())} casos "
          f"({(SAIDA / 'casos.json').stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
