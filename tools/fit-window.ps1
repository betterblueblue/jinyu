param(
  [double]$Aspect = 0.5625,
  [int]$TopMargin = 0
)

# Match the app-mode window by its page title (直播取名台) without putting CJK in this file,
# so the script stays pure ASCII and never breaks on encoding.
$needle = -join ([char]0x76F4, [char]0x64AD, [char]0x53D6, [char]0x540D, [char]0x53F0)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace W -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
'@

function Get-LiveWindow {
  $procs = Get-Process msedge, chrome -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$needle*" }
  return ($procs | Select-Object -First 1)
}

# The browser takes a moment to create the window
$proc = $null
for ($i = 0; $i -lt 20; $i++) {
  $proc = Get-LiveWindow
  if ($proc) { break }
  Start-Sleep -Milliseconds 400
}
if (-not $proc) {
  Write-Host "Window not found (page still loading?). Open it manually, then run this script again."
  exit 1
}

$h = $proc.MainWindowHandle
$wr = New-Object W.U+RECT
$cr = New-Object W.U+RECT
[void][W.U]::GetWindowRect($h, [ref]$wr)
[void][W.U]::GetClientRect($h, [ref]$cr)

# Difference between outer frame and visible client area (title bar + resize border)
$frameW = ($wr.Right - $wr.Left) - ($cr.Right - $cr.Left)
$frameH = ($wr.Bottom - $wr.Top) - ($cr.Bottom - $cr.Top)

# Target: tallest 9:16 client area that still fits the screen work area
$work = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$clientH = [int]($work.Height - $frameH - $TopMargin)
$clientW = [int][math]::Round($clientH * $Aspect)
if ($clientW -gt $work.Width) {
  $clientW = $work.Width
  $clientH = [int][math]::Round($clientW / $Aspect)
}

$winW = $clientW + $frameW
$winH = $clientH + $frameH
[void][W.U]::SetWindowPos($h, [IntPtr]::Zero, $wr.Left, $wr.Top, $winW, $winH, 0x0004)

Start-Sleep -Milliseconds 250
[void][W.U]::GetClientRect($h, [ref]$cr)
$cw = $cr.Right - $cr.Left
$ch = $cr.Bottom - $cr.Top
$ratio = if ($ch -gt 0) { [math]::Round($cw / $ch, 4) } else { 0 }
Write-Host ("Client area: {0} x {1}  ratio {2} (target {3})" -f $cw, $ch, $ratio, $Aspect)
