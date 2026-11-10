param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Headers,
    [switch]$SendTest,
    [switch]$CheckMail,
    [switch]$ShowPlan,
    [ValidateSet('morning','afternoon','evening')]
    [string]$Edition = 'morning'
)

function Invoke-MimiDaily([string]$Url, [string]$Authorization) {
    $request = [System.Net.WebRequest]::CreateHttp($Url)
    $request.Method = 'POST'
    $request.AllowAutoRedirect = $false
    $request.Timeout = 60000
    $request.ReadWriteTimeout = 60000
    $request.ContentLength = 0
    $request.Headers['Authorization'] = $Authorization

    try {
        $response = $request.GetResponse()
    } catch {
        $failure = $_.Exception
        while ($failure -and $failure -isnot [System.Net.WebException]) {
            $failure = $failure.InnerException
        }
        if (-not $failure -or -not $failure.Response) {
            $reason = if ($failure) { $failure.Status } else { $_.Exception.GetType().Name }
            throw "No HTTP response: $reason"
        }
        $response = $failure.Response
    }
    try {
        $reader = [System.IO.StreamReader]::new($response.GetResponseStream())
        try { $raw = $reader.ReadToEnd() } finally { $reader.Dispose() }
        try { $body = ConvertFrom-Json -InputObject $raw -ErrorAction Stop } catch { $body = $null }
        [pscustomobject]@{ Status = [int]$response.StatusCode; Body = $body }
    } finally {
        $response.Close()
    }
}

function Show-MimiDiagnostics($Body) {
    foreach ($name in 'code', 'stage', 'dbCode', 'upstreamStatus', 'missing', 'reason') {
        if ($null -ne $Body.$name) { Write-Output ("{0}={1}" -f $name, ($Body.$name -join ',')) }
    }
}

$authorization = [string]$Headers['Authorization']
if ($authorization -notmatch '^Bearer [^\s]+$') {
    Write-Output 'Missing Authorization header. Use the original PowerShell window.'
    return
}
$url = 'https://jzadkfjpuzozkodbijgh.supabase.co/functions/v1/daily'
if ($CheckMail) {
    # preview=1 also protects against an older daily that does not recognise mailcheck.
    try { $check = Invoke-MimiDaily ($url + '?preview=1&mailcheck=1') $authorization }
    catch { Write-Output $_.Exception.Message; return }
    Write-Output "Mail check HTTP $($check.Status)"
    if ($check.Status -eq 200 -and $check.Body.status -eq 'ready') { Write-Output 'Mail setup OK' }
    elseif ($check.Body.preview) { Write-Output 'code=redeploy_daily' }
    else { Show-MimiDiagnostics $check.Body }
    return
}
try { $preview = Invoke-MimiDaily ($url + '?preview=1&edition=' + $Edition) $authorization }
catch { Write-Output $_.Exception.Message; return }

Write-Output "HTTP $($preview.Status)"
if ($preview.Status -ne 200 -or $preview.Body.sent -ne $false -or $preview.Body.preview -isnot [string]) {
    Show-MimiDiagnostics $preview.Body
    return
}
Write-Output 'Preview OK'
if ($Edition -ne 'morning' -and $preview.Body.edition -ne $Edition) {
    Write-Output 'Deploy the updated daily function before using this edition.'
    return
}
if ($ShowPlan) {
    foreach ($line in [regex]::Matches($preview.Body.preview, '(?s)<(h2|p)\b[^>]*>(.*?)</\1>')) {
        if ($line.Groups[1].Value -eq 'h2') { Write-Output '' }
        $text = $line.Groups[2].Value -replace '<[^>]*>', ''
        Write-Output ([System.Net.WebUtility]::HtmlDecode($text))
    }
    return
}
if (-not $SendTest) { return }

try { $delivery = Invoke-MimiDaily ($url + '?edition=' + $Edition) $authorization }
catch {
    Write-Output $_.Exception.Message
    Write-Output 'Delivery unconfirmed. Check email_delivery_logs and your inbox before retrying.'
    return
}
Write-Output "Delivery HTTP $($delivery.Status)"
if ($delivery.Body.status -in @('sent', 'failed', 'uncertain')) {
    Write-Output "status=$($delivery.Body.status)"
} elseif ($delivery.Body.sent -eq $false) {
    Write-Output 'sent=false'
} else {
    Write-Output 'Delivery unconfirmed. Check email_delivery_logs before retrying.'
}
Show-MimiDiagnostics $delivery.Body
