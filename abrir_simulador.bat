@echo off
REM Abre o simulador do Tesouro Direto.
REM Basta dar dois cliques neste arquivo. Deixe-o na mesma pasta do app.py.
REM Para encerrar o servidor, feche esta janela ou pressione Ctrl+C.

cd /d "%~dp0"

title Simulador Tesouro Direto

echo.
echo  Iniciando o simulador...
echo  A primeira execucao baixa o historico do Tesouro (14 MB) e pode
echo  levar alguns minutos. As seguintes sao instantaneas.
echo.
echo  Nao feche esta janela enquanto estiver usando o app.
echo.

python -m streamlit run app.py

REM Se o Python nao estiver no PATH, a linha acima falha e caimos aqui.
if errorlevel 1 (
    echo.
    echo  Nao consegui iniciar. Verifique se o Python esta instalado
    echo  e acessivel pelo comando "python".
    echo.
    pause
)
