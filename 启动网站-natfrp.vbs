' BluePink han-geul - one-click start: website + SakuraFrp tunnel (both hidden, detached)
' Public URL (fixed): https://www.h09b78cba.nyat.app:64800
' The SakuraFrpService auto-connects tunnel 28921564 (K_learn) per its config.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

' 1. start production website (hidden)
sh.Run """" & dir & "\start-production.vbs""", 0, False
WScript.Sleep 3000

' 2. start SakuraFrp core service (hidden, --daemon), skip if already running
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set procs = wmi.ExecQuery("SELECT * FROM Win32_Process WHERE Name = 'SakuraFrpService.exe'")
If procs.Count = 0 Then
    sh.Run """C:\Program Files\SakuraFrpLauncher\SakuraFrpService.exe"" --daemon", 0, False
End If
