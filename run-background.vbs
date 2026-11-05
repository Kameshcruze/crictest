Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Admin\Downloads\crex-live-cricket-scorer"
WshShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\Admin\Downloads\crex-live-cricket-scorer\watchdog.ps1""", 0, False
