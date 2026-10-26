# Publica no site o CSV do Tesouro Transparente baixado pelo navegador.
#
# Desde outubro de 2026 o portal responde a scripts com um desafio em
# JavaScript, entao o download e feito por uma pessoa: abra o link abaixo no
# navegador, deixe o arquivo cair em Downloads e rode este script.
#
#   https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv
#
# O script pega o precotaxatesourodireto*.csv mais novo de Downloads, confere
# o cabecalho, substitui o anexo do release `fonte` e dispara o workflow
# "Publicar site", que gera os dados no Actions e publica no Pages.
#
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\publicar_dados.ps1 [-Arquivo <csv>]

param(
    [string]$Arquivo
)

$ErrorActionPreference = "Stop"
$Repo = "danguibes/tesourodireto"
$Cabecalho = "Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha"

if (-not $Arquivo) {
    $downloads = Join-Path $env:USERPROFILE "Downloads"
    $maisNovo = Get-ChildItem -Path $downloads -Filter "precotaxatesourodireto*.csv" |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $maisNovo) { throw "Nenhum precotaxatesourodireto*.csv em $downloads." }
    $Arquivo = $maisNovo.FullName
}

$info = Get-Item $Arquivo
Write-Host ("Arquivo: {0}  ({1:N1} MB, salvo em {2:dd/MM/yyyy HH:mm})" -f $info.Name, ($info.Length / 1MB), $info.LastWriteTime)

# A pagina de desafio tem uns 6 KB e comeca com <!DOCTYPE html>; o CSV tem mais de 10 MB.
$primeira = (Get-Content -Path $Arquivo -TotalCount 1 -Encoding UTF8).TrimStart([char]0xFEFF).Trim()
if ($primeira -ne $Cabecalho) {
    throw "Cabecalho inesperado. Recebido: $primeira"
}
if ($info.Length -lt 5MB) { throw "Arquivo pequeno demais para ser o historico completo." }
Write-Host "Cabecalho confere."

# O anexo precisa ter sempre o mesmo nome, que e o que o workflow procura.
$copia = Join-Path $env:TEMP "precotaxatesourodireto.csv"
Copy-Item -Path $Arquivo -Destination $copia -Force

gh release view fonte --repo $Repo *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Criando o release fonte."
    gh release create fonte --repo $Repo --target main --title "Fonte dos dados" `
        --notes "CSV do Tesouro Transparente baixado pelo navegador. Substituido a cada publicacao; nao e uma versao do software." `
        --latest=false
    if ($LASTEXITCODE -ne 0) { throw "Falhou ao criar o release." }
}

gh release upload fonte $copia --repo $Repo --clobber
if ($LASTEXITCODE -ne 0) { throw "Falhou ao enviar o CSV." }
Remove-Item $copia

gh workflow run "Publicar site" --repo $Repo --ref main
if ($LASTEXITCODE -ne 0) { throw "Falhou ao disparar o workflow." }

Write-Host "Enviado. Acompanhe em https://github.com/$Repo/actions"
