# Simulador Tesouro Direto — valor na curva vs. valor a mercado

Simula a compra de um título público numa data passada e mostra, dia a dia,
quanto ele valeria pelo cálculo nominal contratado (o "valor na curva") e
quanto o mercado efetivamente pagava (a marcação a mercado).

No ar em <https://danguibes.github.io/tesourodireto/>, como site estático no
GitHub Pages: o cálculo roda no navegador. Como os dados chegam lá está em
[LEIA-ME-PAGES.md](LEIA-ME-PAGES.md).

Duas telas:

- **Simulação** — uma compra hipotética, com gráfico da curva contra o mercado,
  o ágio ao longo do tempo e os cupons ou amortizações recebidos no caminho.
- **Carteira** — importa uma planilha com várias compras e devolve o ágio ou
  deságio de cada posição, o consolidado e o histórico da carteira (curva,
  mercado e ágio em 30 dias, 90 dias, 1 ano ou desde a primeira compra). A
  última planilha fica lembrada no navegador, que não a envia a lugar nenhum.

No alto da barra lateral, A− e A+ mudam o tamanho do texto (de 90% a 200%,
gráficos inclusive) e o outro botão alterna entre tema claro e escuro. As duas
escolhas ficam guardadas no navegador; sem escolha, o tema segue o do sistema.

A versão anterior, em Streamlit, saiu em 26/10/2026; ela está no histórico do
Git até o commit `83204b5`.

## Planilha da carteira

Uma linha por operação: `data`, `operacao` (`compra` ou `venda`), `titulo` e
`quantidade`. Cada venda abate primeiro das compras mais antigas do mesmo
papel (PEPS), e a tela mostra o saldo por papel para conferir com o extrato,
mais as vendas realizadas. Sem a coluna `operacao`, tudo é compra, e as
planilhas antigas com `data_compra` continuam valendo. O nome do título
pode vir como aparece na corretora ("Tesouro IPCA+ 2035", "Tesouro Educa+
2028"); no RendA+ e no Educa+ o ano do nome é o de conversão, e o app converte
para o vencimento real. Duas colunas opcionais cobrem casos específicos:
`vencimento`, necessária quando o ano é ambíguo, e `pu`, o preço que você
realmente pagou ou recebeu. Numa compra, em vez de `quantidade` é possível
informar `valor_aplicado`. Aceita CSV separado por ponto e vírgula ou por vírgula.

## Python

O Python ficou como gerador de dados e como referência do cálculo: o
JavaScript de `site/js/tesouro.js` é testado contra `tesouro_core.py`.

```bash
pip install -r requirements.txt
python teste_simulacao.py
```

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
site/                   a página publicada (ver LEIA-ME-PAGES.md)
scripts/                gerador de dados e scripts de publicação
planilha/               Apps Script da planilha do Google (último dia)
referencia/             teste do port JavaScript contra o Python
tesouro_core.py         calendário, fluxos de caixa e precificação
tesouro_dados.py        montagem das séries (usado pelo teste)
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
