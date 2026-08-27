"""
Simulador Tesouro Direto — valor na curva vs. valor a mercado.

Rodar com:  streamlit run app.py
"""

import streamlit as st

st.set_page_config(page_title="Tesouro Direto — curva vs. mercado",
                   page_icon="📈", layout="wide")

paginas = st.navigation([
    st.Page("paginas/simulacao.py", title="Simulação", icon="📈", default=True),
    st.Page("paginas/carteira.py", title="Carteira", icon="📋"),
])

paginas.run()
