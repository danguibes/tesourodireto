# Site estático no GitHub Pages

Esta é a versão do simulador que roda inteiramente no navegador. O Python
continua no repositório — ele virou o gerador de dados e a referência de
teste —, mas o visitante não precisa de servidor nenhum.

## Por que mudou

O portal do Tesouro Transparente passou a limitar requisições (HTTP 429) e a
bloquear acesso automatizado. O Streamlit Cloud sai de IPs compartilhados com
centenas de outros apps, então levava 429 de forma intermitente.

O desenho original era o GitHub Actions baixar o arquivo uma vez por dia útil.
**Não funciona, e não é por IP**: medido em 26/10/2026, um script em IP
residencial recebe HTTP 200 com uma página de desafio em JavaScript (F5,
`/TSPD/`) no lugar do CSV. Só navegador passa. O dados.gov.br não espelha o
arquivo — o recurso lá aponta de volta para o mesmo portal —, e o JSON de
preços do dia do tesourodireto.com.br responde 410 Gone.

Então o download é de uma pessoa, e o resto é automático:

1. Abra no navegador o link que está no topo de `scripts/publicar_dados.ps1`.
   O arquivo cai em Downloads.
2. Rode o script. Ele pega o `precotaxatesourodireto*.csv` mais novo, confere
   o cabeçalho, substitui o anexo do release `fonte` e dispara o workflow:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\publicar_dados.ps1
   ```

3. O Actions baixa o anexo (do GitHub, não do portal), gera os JSONs e publica
   tudo junto com a página. O visitante nunca fala com o portal do governo.

O release `fonte` não é uma versão do software: é só o lugar onde o CSV bruto
fica, substituído a cada envio, para não entrar no histórico do Git.

## Como funciona

```
.github/workflows/publicar.yml   lê o CSV do release, roda o gerador e publica
scripts/publicar_dados.ps1       envia o CSV do navegador e dispara o workflow
scripts/gerar_dados_site.py      fatia o CSV por papel (--arquivo <csv>)
tesouro_core.py                  núcleo de cálculo em Python (referência)
site/                            a página, publicada como está
  index.html
  css/estilo.css
  js/tesouro.js                  núcleo de cálculo em JavaScript
  js/dados.js                    carga dos JSONs
  js/grafico.js                  gráfico sobre uPlot
  js/simulacao.js, js/carteira.js, js/app.js
  vendor/                        uPlot e fontes, embutidos
referencia/                      teste do port JS contra o Python
```

Os dados gerados ficam em `site/dados/` e **não** são versionados: o workflow
os cria do zero a cada execução e os envia direto no artefato do Pages. O
histórico do Git não cresce com o tempo.

## Teste do port

O JavaScript foi portado do Python linha a linha, e a garantia é que as duas
implementações devolvem o mesmo número:

```bash
pip install bizdays pandas numpy python-dateutil
python referencia/gerar_fixture.py
node referencia/testar_js.mjs
```

São cerca de 50 mil comparações — calendário, fluxos de caixa das sete
famílias, cotação e simulação completa. O maior erro relativo aceito é 1e-11;
o observado fica na casa de 1e-16, que é ruído de ponto flutuante.

Rode isso sempre que mexer em `site/js/tesouro.js`.

## Planilha do Google

O Apps Script que alimentava a planilha parou pelo mesmo motivo que o app: o
portal do Tesouro não entrega o arquivo aos servidores do Google. A planilha
passa a ler o próprio site, que o Google acessa sem problema. O site publica
dois arquivos para isso, ambos separados por ponto e vírgula e com vírgula
decimal:

```
dados/ultimo_dia.csv   os títulos do dia mais recente
dados/recentes.csv     os últimos 30 dias úteis
```

**Para histórico**, use o Apps Script de `planilha/tesouro_apps_script.gs`.
Ele lê o `recentes.csv` e grava na aba `Resgate` todas as datas base que ainda
faltam, então um dia sem rodar não vira buraco. Cole por cima do script antigo
e rode `criarGatilhoDiario` uma vez.

**Para a foto do dia** numa célula, sem script, o `IMPORTDATA` precisa saber o
separador e a localidade; sem isso ele corta os números na vírgula decimal:

```
=IMPORTDATA("https://danguibes.github.io/tesourodireto/dados/ultimo_dia.csv"; ";"; "pt_BR")
```

## Ligar o Pages

Uma vez só, em Settings → Pages do repositório, escolha **GitHub Actions**
como origem (não "Deploy from a branch"). Depois o workflow publica a cada
commit em `main` e a cada envio do `publicar_dados.ps1`. Não há agendamento:
sem CSV novo, não há o que publicar.

## Lembrete ao entrar no Windows

A tarefa agendada **Tesouro Direto - atualizar dados** roda
`scripts/atualizar_ao_logar.ps1` 5 minutos depois de entrar ou desbloquear o
Windows, e pergunta no máximo uma vez por dia. Com o "Sim", abre o link no
navegador padrão, espera o CSV em Downloads (até 5 minutos) e chama o
`publicar_dados.ps1`. Se o arquivo for igual ao último enviado, avisa e não
publica.

O script não baixa nada sozinho, de propósito: o portal só entrega o arquivo
para navegador, e quem abre o navegador é você.

Estado e registro ficam em `%LOCALAPPDATA%\tesourodireto\` (`log.txt`,
`ultima_pergunta.txt`, `ultimo_hash.txt`). Para perguntar de novo no mesmo dia:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\atualizar_ao_logar.ps1 -Forcar
```

A tarefa foi criada em 26/10/2026 nesta máquina e não está no repositório:
num computador novo, ela precisa ser registrada de novo (gatilhos de logon e
de desbloqueio, atraso de 5 minutos, liberada na bateria).

## Endereço

O site fica em <https://danguibes.github.io/tesourodireto/>, sem domínio
próprio — decisão de 26/10/2026.

## Rodar localmente

```bash
python scripts/gerar_dados_site.py site --arquivo "<caminho do CSV baixado>"
python -m http.server -d site 8777
```

Abra http://localhost:8777. Precisa de servidor porque a página usa módulos
ES; abrir o `index.html` direto do disco não funciona.

## O que não entra na conta

Imposto de renda, taxa de custódia da B3 e corretagem. Os valores são brutos.
Os preços são os de abertura de cada dia útil, com a defasagem de publicação do
próprio Tesouro.

Ferramenta de análise, não recomendação de investimento.

Fonte dos dados: Tesouro Transparente (Tesouro Nacional), conjunto "Taxas dos
Títulos Ofertados pelo Tesouro Direto", licença aberta ODbL.
