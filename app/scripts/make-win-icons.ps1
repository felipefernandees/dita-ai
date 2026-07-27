# Gera resources/win/tray.ico e build/icon.ico a partir do app-icon colorido do
# branding. O .icns do macOS não serve no Windows, e resources/trayTemplate.png
# é um template monocromático preto — some numa barra de tarefas escura.
#
# Por que montamos o container .ico na mão em vez de usar Bitmap.GetHicon() +
# Icon.Save(): o GetHicon passa pelo pipeline de HICON do GDI, que rebaixa a
# imagem para uma DIB de 4bpp (16 cores). Medimos: em 256px o payload sai com
# 41KB/bpp=4 no lugar dos ~310KB de 32bpp, e as cores viram lixo (o roxo escuro
# #2B2541 do ícone vira #000080). Em 32px o estrago é o mesmo. Escrevendo o
# container nós controlamos o formato de cada entrada.
#
# System.Drawing só é usado para redimensionar/codificar — nada de dependência
# npm nova.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here '..\..\branding\app-icon-1024.png'
if (-not (Test-Path $src)) { throw "não achei $src" }

# Redimensiona preservando alpha (o destino nasce 32bpp e transparente).
function Resize-Bitmap($original, [int]$size) {
    $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = 'HighQualityBicubic'
    $graphics.PixelOffsetMode = 'HighQuality'
    $graphics.SmoothingMode = 'HighQuality'
    $graphics.DrawImage($original, 0, 0, $size, $size)
    $graphics.Dispose()
    return $bitmap
}

# Entrada em DIB 32bpp (BITMAPINFOHEADER + BGRA de baixo p/ cima + máscara AND).
# É o formato que o Windows espera em tamanhos < 256; a máscara vai zerada
# porque o canal alfa já resolve a transparência no Vista+.
function ConvertTo-IcoDib($bitmap) {
    $size = $bitmap.Width
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $data = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                             [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $data.Stride
    $raw = New-Object byte[] ($stride * $size)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $raw, 0, $raw.Length)
    $bitmap.UnlockBits($data)

    # máscara AND: 1bpp, cada linha alinhada em 4 bytes
    $maskStride = [int][Math]::Ceiling($size / 32.0) * 4
    $out = New-Object System.IO.MemoryStream
    $w = New-Object System.IO.BinaryWriter($out)
    $w.Write([uint32]40)                       # biSize
    $w.Write([int32]$size)                     # biWidth
    $w.Write([int32]($size * 2))               # biHeight = XOR + AND
    $w.Write([uint16]1)                        # biPlanes
    $w.Write([uint16]32)                       # biBitCount
    $w.Write([uint32]0)                        # biCompression = BI_RGB
    $w.Write([uint32](($size * $size * 4) + ($maskStride * $size)))
    $w.Write([int32]0); $w.Write([int32]0)     # resolução (irrelevante)
    $w.Write([uint32]0); $w.Write([uint32]0)   # paleta

    # DIB é bottom-up: escrevemos as linhas na ordem inversa
    for ($y = $size - 1; $y -ge 0; $y--) {
        $w.Write($raw, $y * $stride, $size * 4)
    }
    $w.Write((New-Object byte[] ($maskStride * $size)))
    $w.Flush()
    # a vírgula impede o PowerShell de desenrolar o byte[] em Object[] na saída
    # da função — sem ela o BinaryWriter lá na frente escreve 1 byte só
    return , $out.ToArray()
}

# Em 256px a DIB crua passaria de 300KB por entrada; PNG dentro do .ico é o que
# o próprio Windows usa desde o Vista e derruba isso para ~18KB.
function ConvertTo-IcoPng($bitmap) {
    $ms = New-Object System.IO.MemoryStream
    $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    return , $ms.ToArray()   # idem: vírgula para não desenrolar o byte[]
}

function New-Ico([string]$source, [string]$destination, [int[]]$sizes) {
    $dir = Split-Path -Parent $destination
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }

    $original = [System.Drawing.Image]::FromFile($source)
    $payloads = @()
    foreach ($size in $sizes) {
        $bitmap = Resize-Bitmap $original $size
        [byte[]]$bytes = if ($size -ge 256) { ConvertTo-IcoPng $bitmap } else { ConvertTo-IcoDib $bitmap }
        $payloads += , @{ Size = $size; Bytes = $bytes }
        $bitmap.Dispose()
    }
    $original.Dispose()

    $out = New-Object System.IO.MemoryStream
    $w = New-Object System.IO.BinaryWriter($out)
    $w.Write([uint16]0)                  # reservado
    $w.Write([uint16]1)                  # tipo: 1 = ícone
    $w.Write([uint16]$payloads.Count)

    # o offset do primeiro payload fica logo depois do diretório
    $offset = 6 + (16 * $payloads.Count)
    foreach ($p in $payloads) {
        # 256 é gravado como 0: o campo tem 1 byte só
        $dim = if ($p.Size -ge 256) { 0 } else { $p.Size }
        $w.Write([byte]$dim); $w.Write([byte]$dim)
        $w.Write([byte]0); $w.Write([byte]0)          # paleta / reservado
        $w.Write([uint16]1); $w.Write([uint16]32)     # planes / bpp
        $w.Write([uint32]$p.Bytes.Length)
        $w.Write([uint32]$offset)
        $offset += $p.Bytes.Length
    }
    foreach ($p in $payloads) { $w.Write([byte[]]$p.Bytes, 0, $p.Bytes.Length) }
    $w.Flush()
    [System.IO.File]::WriteAllBytes($destination, $out.ToArray())
    $w.Dispose()

    # Relê o que acabou de sair: um .ico truncado ainda abre em alguns leitores,
    # então conferimos o tamanho byte a byte antes de confiar no arquivo.
    $escrito = (Get-Item $destination).Length
    $esperado = 6 + (16 * $payloads.Count) + ($payloads | ForEach-Object { $_.Bytes.Length } | Measure-Object -Sum).Sum
    if ($escrito -ne $esperado) { throw "$destination saiu com $escrito bytes, esperado $esperado" }

    # O decodificador do GDI+ escolhe a maior entrada — é ele que prova que a
    # entrada PNG de 256 é legível. (System.Drawing.Icon não serve de conferência
    # aqui: o seletor dele é legado e ignora entradas PNG na hora de escolher
    # tamanho, devolvendo 128 quando se pede 256. Isso é limitação do .NET
    # Framework, não do arquivo: Windows Vista+, Chromium/Electron e o
    # electron-builder leem PNG dentro de .ico sem problema.)
    $check = [System.Drawing.Image]::FromFile($destination)
    $maior = ($sizes | Measure-Object -Maximum).Maximum
    if ($check.Width -ne $maior) { throw "${destination}: GDI+ leu $($check.Width)px, esperado $maior" }
    $check.Dispose()

    Write-Host "gerado: $destination ($($payloads.Count) entradas: $($sizes -join ', ')px | maior lida=$maior | $escrito bytes)"
}

# Bandeja: 16px é o que o Windows pede a 100% de DPI, 24/32 cobrem 150%/200%.
New-Ico $src (Join-Path $here '..\resources\win\tray.ico') @(16, 24, 32)
# Instalador/janela: o electron-builder exige pelo menos 256; os tamanhos
# menores evitam que o Explorer reduza o 256 na marra na visão de lista.
New-Ico $src (Join-Path $here '..\build\icon.ico') @(16, 24, 32, 48, 64, 128, 256)
