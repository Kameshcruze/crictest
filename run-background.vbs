' ============================================================================
' Crex Live Scorer - 24/7 Background Runner
' Launches the watchdog server silently in the background with zero visible windows.
' Automatically reboots the server if it ever crashes.
' ============================================================================

Set FSO = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

' Dynamically detect the folder where this script lives
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = ScriptDir

HasNodeModules = FSO.FolderExists(ScriptDir & "\node_modules")

' 1. Start the watchdog server silently in the background (0 = completely hidden window)
WshShell.Run "cmd.exe /c """ & ScriptDir & "\watchdog.bat""", 0, False

' 2. Wait for the server to initialize (if installing node_modules, wait 20s; otherwise 4s)
If HasNodeModules Then
    WScript.Sleep 4000
Else
    WScript.Sleep 20000
End If

' 3. Open the dashboard in your default browser
WshShell.Run "cmd.exe /c start http://localhost:3000", 0, False
