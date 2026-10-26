# Pergunta uma vez por dia se é hora de atualizar os dados do site.
#
# Roda pela tarefa agendada "Tesouro Direto - atualizar dados", 5 minutos depois
# de entrar ou desbloquear o Windows. O portal do Tesouro só entrega o CSV para
# navegador, então o script não baixa nada sozinho: pergunta, e com o seu "Sim"
# abre o link no navegador padrão, espera o arquivo cair em Downloads e chama o
# publicar_dados.ps1.
#
# Estado em %LOCALAPPDATA%\tesourodireto: a data da última pergunta (para não
# perguntar de novo no mesmo dia) e o hash do último CSV publicado (para não
# publicar o mesmo arquivo duas vezes). Registro de cada execução em log.txt.
#
# Uso manual:  powershell -ExecutionPolicy Bypass -File scripts\atualizar_ao_logar.ps1 [-Forcar]

param(
    [switch]$Forcar
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

$Url = "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv"
$Publicar = Join-Path $PSScriptRoot "publicar_dados.ps1"
$Pasta = Join-Path $env:LOCALAPPDATA "tesourodireto"
$ArqData = Join-Path $Pasta "ultima_pergunta.txt"
$ArqHash = Join-Path $Pasta "ultimo_hash.txt"
$Log = Join-Path $Pasta "log.txt"
$Downloads = Join-Path $env:USERPROFILE "Downloads"
$Hoje = Get-Date -Format "yyyy-MM-dd"

New-Item -ItemType Directory -Force -Path $Pasta | Out-Null

function Registrar([string]$texto) {
    Add-Content -Path $Log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $texto) -Encoding UTF8
}

# MessageBox sem dono aparece atrás das outras janelas; um formulário
# TopMost invisível a traz para a frente.
function Perguntar([string]$texto, [string]$botoes = "YesNo", [string]$icone = "Question") {
    $dono = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
    try {
        return [System.Windows.Forms.MessageBox]::Show($dono, $texto, "Tesouro Direto", $botoes, $icone)
    } finally {
        $dono.Dispose()
    }
}

if (-not $Forcar -and (Test-Path $ArqData) -and ((Get-Content $ArqData -Raw).Trim() -eq $Hoje)) {
    exit 0
}
Set-Content -Path $ArqData -Value $Hoje -Encoding ASCII

$resposta = Perguntar "Baixar o arquivo do Tesouro Transparente e atualizar o site agora?`n`nO navegador vai abrir e baixar o CSV (uns 15 MB). O resto é automático."
if ($resposta -ne "Yes") {
    Registrar "Pergunta recusada."
    exit 0
}

$inicio = Get-Date
Start-Process $Url
Registrar "Navegador aberto; esperando o CSV em Downloads."

# Espera um precotaxatesourodireto*.csv mais novo que o início, com tamanho
# estável em duas leituras seguidas (o Chrome escreve em .crdownload e só
# renomeia no fim, mas outros navegadores escrevem direto no nome final).
$arquivo = $null
$tamanhoAnterior = -1
$limite = $inicio.AddMinutes(5)
while ((Get-Date) -lt $limite) {
    Start-Sleep -Seconds 3
    $novo = Get-ChildItem -Path $Downloads -Filter "precotaxatesourodireto*.csv" -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -ge $inicio.AddSeconds(-2) } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $novo) { continue }
    if ($novo.Length -gt 0 -and $novo.Length -eq $tamanhoAnterior) { $arquivo = $novo; break }
    $tamanhoAnterior = $novo.Length
}

if (-not $arquivo) {
    Registrar "O CSV não chegou em 5 minutos."
    Perguntar "O arquivo não apareceu em Downloads em 5 minutos.`n`nSe ele chegou depois, rode o publicar_dados.ps1 à mão." "OK" "Warning" | Out-Null
    exit 1
}

$hash = (Get-FileHash -Path $arquivo.FullName -Algorithm SHA256).Hash
if ((Test-Path $ArqHash) -and ((Get-Content $ArqHash -Raw).Trim() -eq $hash)) {
    Registrar "Arquivo igual ao último publicado ($($arquivo.Name)); nada a fazer."
    Perguntar "O Tesouro ainda não publicou dados novos: o arquivo é igual ao último enviado." "OK" "Information" | Out-Null
    exit 0
}

try {
    # Processo filho com saídas em arquivo: no PowerShell 5.1, redirecionar o
    # stderr do gh dentro desta sessão viraria erro fatal mesmo com sucesso.
    $saida = Join-Path $Pasta "publicar.out.txt"
    $erros = Join-Path $Pasta "publicar.err.txt"
    $p = Start-Process -FilePath "powershell.exe" -Wait -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $saida -RedirectStandardError $erros `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$Publicar`"", "-Arquivo", "`"$($arquivo.FullName)`""
    Get-Content $saida, $erros -Encoding UTF8 | Where-Object { $_.Trim() } | ForEach-Object { Registrar "  $_" }
    if ($p.ExitCode -ne 0) { throw "publicar_dados.ps1 saiu com código $($p.ExitCode)." }
    Set-Content -Path $ArqHash -Value $hash -Encoding ASCII
    Registrar "Publicado: $($arquivo.Name)"
    Perguntar "Arquivo enviado. O site se atualiza em uns 2 minutos.`n`nhttps://danguibes.github.io/tesourodireto/" "OK" "Information" | Out-Null
} catch {
    Registrar "Falhou: $($_.Exception.Message)"
    Perguntar "A publicação falhou:`n`n$($_.Exception.Message)`n`nDetalhes em $Log" "OK" "Error" | Out-Null
    exit 1
}
