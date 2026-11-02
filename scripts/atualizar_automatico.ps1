# Baixa o CSV do Tesouro direto do portal e publica o site, sem perguntar nada.
#
# Roda pela tarefa agendada "Tesouro Direto - atualizacao automatica", as 08:30
# e as 13:30, que acorda o notebook da espera (so na tomada). O portal atualiza
# o arquivo por volta das 07:20 de Brasilia; a segunda rodada cobre os dias em
# que ele atrasa, e nao publica nada se o arquivo nao mudou.
#
# Em outubro de 2026 o portal respondia a qualquer script com um desafio em
# JavaScript; em 02/11/2026 voltou a entregar o CSV para um download simples.
# Se o desafio voltar, este script NAO tenta passar por ele: registra no log e
# deixa o dia sem marcar, para a pergunta do atualizar_ao_logar.ps1 aparecer no
# proximo desbloqueio.
#
# Divide o estado com o atualizar_ao_logar.ps1, em %LOCALAPPDATA%\tesourodireto:
# o hash do ultimo CSV publicado e a data da ultima pergunta. Quando este script
# resolve o dia (publicou, ou o arquivo nao mudou), marca a data, e a pergunta
# de logon nao aparece.
#
# Atencao ao testar de dentro do app Claude: ele roda como pacote do Windows e
# enxerga uma copia virtualizada de %LOCALAPPDATA%. Para ver o estado real,
# rode pela tarefa (Start-ScheduledTask) e leia o log por fora do pacote.
#
# Uso manual:  powershell -ExecutionPolicy Bypass -File scripts\atualizar_automatico.ps1

$ErrorActionPreference = "Stop"

$Url = "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv"
$Cabecalho = "Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha"
$Publicar = Join-Path $PSScriptRoot "publicar_dados.ps1"
$Pasta = Join-Path $env:LOCALAPPDATA "tesourodireto"
$ArqData = Join-Path $Pasta "ultima_pergunta.txt"
$ArqHash = Join-Path $Pasta "ultimo_hash.txt"
$Log = Join-Path $Pasta "log.txt"
$Csv = Join-Path $Pasta "precotaxatesourodireto.csv"
$Hoje = Get-Date -Format "yyyy-MM-dd"

New-Item -ItemType Directory -Force -Path $Pasta | Out-Null

function Registrar([string]$texto) {
    Add-Content -Path $Log -Value ("{0:yyyy-MM-dd HH:mm:ss}  [auto] {1}" -f (Get-Date), $texto) -Encoding UTF8
}

# A tarefa acorda o notebook, mas sem este pedido ele volta a dormir em uns
# 2 minutos, no meio do download. Vale enquanto o processo estiver vivo.
Add-Type -Namespace Tesouro -Name Energia -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
"@
[Tesouro.Energia]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED

# Logo depois de acordar, o Wi-Fi pode levar alguns segundos para voltar.
$baixou = $false
for ($tentativa = 1; $tentativa -le 4 -and -not $baixou; $tentativa++) {
    if ($tentativa -gt 1) { Start-Sleep -Seconds 30 }
    if (Test-Path $Csv) { Remove-Item $Csv }
    # curl.exe do Windows, sem cabecalho nenhum alem do padrao: um download
    # simples. -R guarda no arquivo a data de atualizacao informada pelo portal.
    # Com Stop, o PowerShell 5.1 trataria o stderr do curl como erro fatal.
    $ErrorActionPreference = "Continue"
    & curl.exe -sS -f -R --max-time 300 -o $Csv $Url 2>$null
    $codigo = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    $baixou = ($codigo -eq 0) -and (Test-Path $Csv)
    if (-not $baixou) { Registrar "Tentativa $tentativa sem sucesso (curl saiu com $codigo)." }
}
if (-not $baixou) {
    Registrar "Sem conexao com o portal; fica para a pergunta no proximo desbloqueio."
    exit 1
}

$info = Get-Item $Csv
$primeira = (Get-Content -Path $Csv -TotalCount 1 -Encoding UTF8).TrimStart([char]0xFEFF).Trim()
if ($primeira -ne $Cabecalho -or $info.Length -lt 5MB) {
    # Provavelmente a pagina de desafio do portal. Nao insistir.
    Registrar ("O portal nao entregou o CSV ({0:N0} bytes, comeca com '{1}'); fica para a pergunta no proximo desbloqueio." -f $info.Length, $primeira.Substring(0, [Math]::Min(40, $primeira.Length)))
    Remove-Item $Csv
    exit 0
}

$hash = (Get-FileHash -Path $Csv -Algorithm SHA256).Hash
if ((Test-Path $ArqHash) -and ((Get-Content $ArqHash -Raw).Trim() -eq $hash)) {
    Registrar "Arquivo igual ao ultimo publicado; nada a fazer."
    Set-Content -Path $ArqData -Value $Hoje -Encoding ASCII
    exit 0
}

# Processo filho com saidas em arquivo: no PowerShell 5.1, redirecionar o
# stderr do gh dentro desta sessao viraria erro fatal mesmo com sucesso.
$saida = Join-Path $Pasta "publicar.out.txt"
$erros = Join-Path $Pasta "publicar.err.txt"
$p = Start-Process -FilePath "powershell.exe" -Wait -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $saida -RedirectStandardError $erros `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$Publicar`"", "-Arquivo", "`"$Csv`""
Get-Content $saida, $erros -Encoding UTF8 | Where-Object { $_.Trim() } | ForEach-Object { Registrar "  $_" }
if ($p.ExitCode -ne 0) {
    Registrar "Falhou: publicar_dados.ps1 saiu com codigo $($p.ExitCode); fica para a pergunta no proximo desbloqueio."
    exit 1
}
Set-Content -Path $ArqHash -Value $hash -Encoding ASCII
Set-Content -Path $ArqData -Value $Hoje -Encoding ASCII
Registrar ("Publicado ({0:N1} MB, atualizado no portal em {1})." -f ($info.Length / 1MB), $info.LastWriteTime)
