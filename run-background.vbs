Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Admin\Downloads\crex-live-cricket-scorer"

' 1. Start the server silently in the background
WshShell.Run "cmd.exe /c npm start", 0, False

' 2. Wait 4 seconds for the server on port 3000 to fully boot
WScript.Sleep 4000

' 3. Automatically open Chrome directly to your localhost dashboard
WshShell.Run "cmd.exe /c start chrome http://localhost:3000", 0, False
