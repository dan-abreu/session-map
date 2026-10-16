' Runs the session-map skill sync without any window, from the Windows scheduled task
' "session-map skills sync". One line: the node executable and the sync script.
CreateObject("WScript.Shell").Run """C:\Program Files\nodejs\node.exe"" ""C:\dev\session-map\scripts\dsh-skills-sync.mjs""", 0, False
