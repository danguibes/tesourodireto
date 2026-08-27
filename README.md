# Simulador Tesouro Direto — valor na curva vs. valor a mercado

Simula a compra de um título público numa data passada e mostra, dia a dia,
quanto ele valeria pelo cálculo nominal contratado (o "valor na curva") e
quanto o mercado efetivamente pagava (a marcação a mercado).

Duas páginas:

- **Simulação** — uma compra hipotética, com gráfico da curva contra o mercado,
  o ágio ao longo do tempo e os cupons ou amortizações recebidos no caminho.
- **Carteira** — importa uma planilha com várias compras e devolve o ágio ou
  deságio de cada posição, mais o consolidado.

## Planilha da carteira

Três colunas bastam: `data_compra`, `titulo` e `quantidade`. O nome do título
pode vir como aparece na corretora ("Tesouro IPCA+ 2035", "Tesouro Educa+
2028"); no RendA+ e no Educa+ o ano do nome é o de conversão, e o app converte
para o vencimento real. Duas colunas opcionais cobrem casos específicos:
`vencimento`, necessária quando o ano é ambíguo, e `pu_compra`, o preço que
você realmente pagou. Em vez de `quantidade` é possível informar
`valor_aplicado`. Aceita CSV e Excel.

## Instalação

```bash
pip install -r requirements.txt
```

## Uso

```bash
streamlit run app.py
```

O navegador abre em `http://localhost:8501`. No Windows, o atalho
`abrir_simulador.bat` faz o mesmo com dois cliques.

Na primeira execução o app baixa o histórico completo do Tesouro Transparente
(~14 MB) e o converte para Parquet na pasta `dados/`. As execuções seguintes
carregam em menos de um segundo. O cache expira em 20 horas, então basta abrir
no dia seguinte para ter os dados novos; o botão "Atualizar histórico" força
um download imediato.

## Publicar no Streamlit Community Cloud

O app roda sem alterações: o cache cai para a pasta temporária quando o disco
da aplicação é somente-leitura, e o Parquet é reconstruído automaticamente
depois de cada hibernação do contêiner.

## Títulos cobertos

| Família | Fluxo de caixa |
|---|---|
| Tesouro Prefixado (LTN) | principal no vencimento |
| Tesouro Prefixado com Juros Semestrais (NTN-F) | cupom de R$ 48,81 semestral |
| Tesouro Selic (LFT) | principal no vencimento |
| Tesouro IPCA+ (NTN-B Principal) | principal no vencimento |
| Tesouro IPCA+ com Juros Semestrais (NTN-B) | cupom de 2,9563% do VNA, semestral |
| Tesouro IGPM+ com Juros Semestrais (NTN-C) | cupom de 2,9563% do VNA, semestral |
| Tesouro RendA+ / Educa+ (NTN-B1) | 240 / 60 amortizações mensais |

## Estrutura

```
app.py                  roteador das páginas
paginas/simulacao.py    simulação de uma compra
paginas/carteira.py     importação de planilha e consolidado
tesouro_core.py         calendário, fluxos de caixa e precificação
tesouro_dados.py        download, cache e montagem das séries
ui_comum.py             carga compartilhada e resolução de nomes de título
teste_simulacao.py      testes com dados reais embutidos, roda sem rede
```

## Metodologia

Desconto exponencial em dias úteis sobre 252, calendário ANBIMA. O preço é
`VNA × cotação`, onde a cotação é o valor presente dos fluxos futuros à taxa
contratada.

O VNA de cada data é extraído do próprio preço publicado pelo Tesouro
(`VNA = PU ÷ cotação`), o que dispensa baixar séries separadas de IPCA,
IGP-M ou Selic — a informação já está embutida no arquivo de preços.

Títulos com cupom ou amortização devolvem dinheiro pelo caminho, então o app
mostra duas leituras do valor na curva: com os pagamentos guardados em caixa
sem render, e com reinvestimento à mesma taxa contratada. O valor a mercado
recebe o mesmo tratamento de caixa, para a comparação ficar entre iguais.

## Limitações

Os valores são brutos: não entram imposto de renda, taxa de custódia da B3
nem taxa de corretora. Os preços do arquivo são os de abertura ("Manhã") de
cada dia útil, com defasagem típica de um dia útil.

Ferramenta de análise, não recomendação de investimento.

## Fonte

Tesouro Transparente (Tesouro Nacional), conjunto de dados "Taxas dos Títulos
Ofertados pelo Tesouro Direto", licença aberta ODbL.
