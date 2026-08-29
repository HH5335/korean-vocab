' 查网址.vbs - 双击即可查看网站固定公网网址，并自动复制到剪贴板
' 网址固定不变（樱花FRP），无需再解析隧道日志
Option Explicit
Dim sh, url

Set sh = CreateObject("WScript.Shell")
url = "https://www.h09b78cba.nyat.app:64800"

' 复制到剪贴板
sh.Run "cmd /c echo " & url & "| clip", 0, True

MsgBox "网站固定公网网址（已复制到剪贴板）：" & vbCrLf & vbCrLf & url & vbCrLf & vbCrLf & "直接 Ctrl+V 粘贴发给朋友即可。" & vbCrLf & vbCrLf & "打不开时：先双击 启动网站-natfrp.vbs" & vbCrLf & "本机访问：http://localhost:3001", 64, "BluePink 网址查询"
