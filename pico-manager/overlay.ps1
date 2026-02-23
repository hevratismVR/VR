param(
    [int]$Number,
    [int]$X,
    [int]$Y,
    [int]$WinWidth = 480,
    [int]$W = 70,
    [int]$H = 70
)

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$window = New-Object System.Windows.Window
$window.WindowStyle = "None"
$window.AllowsTransparency = $true
$window.Background = [System.Windows.Media.Brushes]::Transparent
$window.Topmost = $true
$window.Left = $X + $WinWidth - $W - 10
$window.Top = $Y + 10
$window.Width = $W
$window.Height = $H
$window.ShowInTaskbar = $false
$window.ResizeMode = "NoResize"

$border = New-Object System.Windows.Controls.Border
$border.CornerRadius = New-Object System.Windows.CornerRadius(12)
$border.Background = New-Object System.Windows.Media.SolidColorBrush(
    [System.Windows.Media.Color]::FromArgb(210, 30, 30, 30)
)
$border.BorderBrush = New-Object System.Windows.Media.SolidColorBrush(
    [System.Windows.Media.Color]::FromArgb(255, 100, 200, 255)
)
$border.BorderThickness = New-Object System.Windows.Thickness(2)
$border.Padding = New-Object System.Windows.Thickness(5)

$label = New-Object System.Windows.Controls.TextBlock
$label.Text = "#$Number"
$label.FontSize = 32
$label.FontWeight = [System.Windows.FontWeights]::Bold
$label.Foreground = [System.Windows.Media.Brushes]::White
$label.HorizontalAlignment = "Center"
$label.VerticalAlignment = "Center"
$label.TextAlignment = "Center"

$border.Child = $label
$window.Content = $border

# Allow dragging the overlay
$window.Add_MouseLeftButtonDown({ $window.DragMove() })

# Keep window always on top with a timer (prevents losing topmost)
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(10)
$timer.Add_Tick({
    $window.Topmost = $false
    $window.Topmost = $true
})
$timer.Start()

# Run with a proper WPF Application to keep the message loop alive
$app = New-Object System.Windows.Application
$app.ShutdownMode = "OnMainWindowClose"
$app.Run($window) | Out-Null
