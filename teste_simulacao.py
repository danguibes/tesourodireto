"""Valida a simulação com linhas reais extraídas do arquivo do Tesouro."""
import numpy as np
import pandas as pd

import tesouro_core as tc
import tesouro_dados as td

# Linhas reais do precotaxatesourodireto.csv (várias datas base de 2025-2026).
AMOSTRA = """Tesouro IPCA+;15/08/2050;21/10/2025;7,06;7,18;848,20;824,82
Tesouro IPCA+;15/08/2050;09/10/2025;7,02;7,14;853,13;829,49
Tesouro IPCA+;15/08/2050;15/12/2025;6,86;6,98;899,28;874,53
Tesouro IPCA+;15/08/2050;29/12/2025;7,03;7,15;868,33;844,52
Tesouro IPCA+;15/08/2050;20/01/2026;7,12;7,24;856,15;832,74
Tesouro IPCA+;15/08/2050;04/02/2026;6,99;7,11;885,87;861,68
Tesouro IPCA+;15/08/2050;09/02/2026;7,01;7,13;883,03;858,92
Tesouro IPCA+ com Juros Semestrais;15/08/2030;21/10/2025;8,00;8,12;4274,00;4252,75
Tesouro IPCA+ com Juros Semestrais;15/08/2030;15/12/2025;7,70;7,82;4382,60;4361,22
Tesouro IPCA+ com Juros Semestrais;15/08/2030;29/12/2025;7,73;7,85;4395,99;4374,84
Tesouro IPCA+ com Juros Semestrais;15/08/2030;20/01/2026;7,94;8,06;4392,37;4371,51
Tesouro IPCA+ com Juros Semestrais;15/08/2030;04/02/2026;7,66;7,78;4458,31;4437,37
Tesouro IPCA+ com Juros Semestrais;15/08/2030;09/02/2026;7,63;7,75;4467,62;4445,73
Tesouro Renda+ Aposentadoria Extra;15/12/2049;21/10/2025;7,41;7,53;1808,39;1784,09
Tesouro Renda+ Aposentadoria Extra;15/12/2049;15/12/2025;7,04;7,16;1907,92;1882,19
Tesouro Renda+ Aposentadoria Extra;15/12/2049;29/12/2025;7,21;7,33;1880,18;1855,07
Tesouro Renda+ Aposentadoria Extra;15/12/2049;20/01/2026;7,46;7,58;1842,01;1817,70
Tesouro Renda+ Aposentadoria Extra;15/12/2049;04/02/2026;7,33;7,45;1876,66;1851,91
Tesouro Renda+ Aposentadoria Extra;15/12/2049;09/02/2026;7,33;7,45;1879,24;1854,48
Tesouro Educa+;15/12/2030;21/10/2025;8,27;8,39;3713,91;3702,20
Tesouro Educa+;15/12/2030;15/12/2025;7,97;8,09;3792,25;3780,65
Tesouro Educa+;15/12/2030;29/12/2025;7,98;8,10;3807,56;3796,17
Tesouro Educa+;15/12/2030;20/01/2026;8,14;8,26;3744,61;3733,45
Tesouro Educa+;15/12/2030;04/02/2026;7,82;7,94;3788,53;3777,45
Tesouro Educa+;15/12/2030;09/02/2026;7,81;7,93;3794,74;3783,69
Tesouro Prefixado com Juros Semestrais;01/01/2029;21/10/2025;13,31;13,43;952,75;949,56
Tesouro Prefixado com Juros Semestrais;01/01/2029;15/12/2025;13,05;13,17;976,55;973,44
Tesouro Prefixado com Juros Semestrais;01/01/2029;29/12/2025;13,33;13,45;974,78;971,71
Tesouro Prefixado com Juros Semestrais;01/01/2029;20/01/2026;13,29;13,41;933,79;930,78
Tesouro Prefixado com Juros Semestrais;01/01/2029;04/02/2026;12,79;12,91;949,48;946,46
Tesouro Prefixado com Juros Semestrais;01/01/2029;09/02/2026;12,78;12,90;951,05;948,04
Tesouro Prefixado;01/01/2029;21/10/2025;13,25;13,37;674,67;672,08
Tesouro Prefixado;01/01/2029;15/12/2025;13,01;13,13;691,85;689,31
Tesouro Prefixado;01/01/2029;29/12/2025;13,30;13,42;689,60;687,09
Tesouro Prefixado;01/01/2029;20/01/2026;13,26;13,38;695,46;692,97
Tesouro Prefixado;01/01/2029;04/02/2026;12,79;12,91;707,66;705,16
Tesouro Prefixado;01/01/2029;09/02/2026;12,78;12,90;708,87;706,38
Tesouro Selic;01/03/2029;21/10/2025;0,08;0,09;17566,83;17551,19
Tesouro Selic;01/03/2029;15/12/2025;0,07;0,08;17945,23;17929,53
Tesouro Selic;01/03/2029;29/12/2025;0,07;0,08;18037,42;18021,71
Tesouro Selic;01/03/2029;20/01/2026;0,06;0,07;18192,37;18176,63
Tesouro Selic;01/03/2029;04/02/2026;0,06;0,07;18301,86;18286,12
Tesouro Selic;01/03/2029;09/02/2026;0,06;0,07;18321,48;18305,72"""


def montar_df() -> pd.DataFrame:
    linhas = []
    for ln in AMOSTRA.strip().split("\n"):
        t, venc, base, tc_, tv, puc, puv = ln.split(";")
        linhas.append({
            "titulo": t,
            "vencimento": pd.to_datetime(venc.strip(), format="%d/%m/%Y"),
            "data_base": pd.to_datetime(base.strip(), format="%d/%m/%Y"),
            "taxa_compra": float(tc_.replace(",", ".")),
            "taxa_venda": float(tv.replace(",", ".")),
            "pu_compra": float(puc.replace(",", ".")),
            "pu_venda": float(puv.replace(",", ".")),
            "pu_base": float(puv.replace(",", ".")),
        })
    df = pd.DataFrame(linhas)
    fam = {n: tc.classificar(n) for n in df["titulo"].unique()}
    df["familia"] = df["titulo"].map(fam)
    df["indexador"] = df["familia"].map(tc.INDEXADOR)
    return df.sort_values(["titulo", "vencimento", "data_base"], ignore_index=True)


def main() -> None:
    df = montar_df()
    papeis = df[["titulo", "vencimento"]].drop_duplicates().values.tolist()

    for titulo, venc in papeis:
        pos, s = td.simular(df, titulo, venc,
                            data_compra=pd.Timestamp("2025-10-21"),
                            valor_aplicado=10_000.0)
        fim = s.iloc[-1]
        print(f"\n{titulo} — venc. {pd.Timestamp(venc):%d/%m/%Y}  [{pos.familia}]")
        print(f"  compra 21/10/2025 a {pos.taxa:.2f}% a.a., PU {pos.pu_compra:,.2f}"
              f"  ({pos.quantidade:.4f} títulos)")
        print(f"  em {fim['data']:%d/%m/%Y} ({int(fim['dias_uteis'])} du):")
        print(f"    VNA implícito ..... {fim['vna']:12,.2f}")
        print(f"    na curva (caixa) .. {fim['curva_caixa']:12,.2f}")
        print(f"    na curva (reinv.) . {fim['curva_reinvest']:12,.2f}")
        print(f"    a mercado ......... {fim['mercado_caixa']:12,.2f}")
        print(f"    ágio/deságio ...... {fim['agio']:12,.2f}  ({fim['agio_pct']:+.2f}%)")
        if fim["recebido_acum"] > 0:
            print(f"    recebido no caminho {fim['recebido_acum']:12,.2f}")

        # Sanidade: no dia da compra, curva e mercado devem bater com o aplicado
        ini = s.iloc[0]
        erro = abs(ini["curva_caixa"] - pos.aplicado) / pos.aplicado
        assert erro < 5e-3, f"curva no dia 0 destoa do aplicado: {erro:.2%}"
        assert abs(ini["curva_reinvest"] - pos.aplicado) < 0.01

    print("\nOK — no dia da compra o valor na curva reproduz o aplicado "
          "em todos os papéis.")


if __name__ == "__main__":
    main()
