; Imgtrix Windows Installer — custom registry entries
; Runs with admin rights (requireAdministrator in package.json)

!macro customInstall

  ; ── "Open with Imgtrix" on any file ────────────────────────────────────────
  WriteRegStr HKCR "*\shell\Imgtrix"         ""      "Open with Imgtrix"
  WriteRegStr HKCR "*\shell\Imgtrix"         "Icon"  "$INSTDIR\Imgtrix.exe,0"
  WriteRegStr HKCR "*\shell\Imgtrix\command" ""      '"$INSTDIR\Imgtrix.exe" "%1"'

  ; ── "Open with Imgtrix" on folders ─────────────────────────────────────────
  WriteRegStr HKCR "Directory\shell\Imgtrix"         ""      "Open with Imgtrix"
  WriteRegStr HKCR "Directory\shell\Imgtrix"         "Icon"  "$INSTDIR\Imgtrix.exe,0"
  WriteRegStr HKCR "Directory\shell\Imgtrix\command" ""      '"$INSTDIR\Imgtrix.exe" "%1"'

  ; ── Right-click inside a folder (no file selected) ──────────────────────────
  ; Note: uses %V (folder path) instead of %1
  WriteRegStr HKCR "Directory\Background\shell\Imgtrix"         ""      "Open with Imgtrix"
  WriteRegStr HKCR "Directory\Background\shell\Imgtrix"         "Icon"  "$INSTDIR\Imgtrix.exe,0"
  WriteRegStr HKCR "Directory\Background\shell\Imgtrix\command" ""      '"$INSTDIR\Imgtrix.exe" "%V"'

  ; ── Register ProgID ──────────────────────────────────────────────────────────
  ; This is what Windows uses for the "Open with" list and file type display name
  WriteRegStr HKCR "ImgtrixFile"                    ""  "Imgtrix Image"
  WriteRegStr HKCR "ImgtrixFile\DefaultIcon"        ""  "$INSTDIR\Imgtrix.exe,0"
  WriteRegStr HKCR "ImgtrixFile\shell\open\command" ""  '"$INSTDIR\Imgtrix.exe" "%1"'

  ; ── Add Imgtrix to "Open with" list for common image formats ────────────────
  ; Does NOT claim ownership as default — user's existing defaults are untouched
  WriteRegStr HKCR ".png\OpenWithProgids"  "ImgtrixFile" ""
  WriteRegStr HKCR ".jpg\OpenWithProgids"  "ImgtrixFile" ""
  WriteRegStr HKCR ".jpeg\OpenWithProgids" "ImgtrixFile" ""
  WriteRegStr HKCR ".bmp\OpenWithProgids"  "ImgtrixFile" ""
  WriteRegStr HKCR ".webp\OpenWithProgids" "ImgtrixFile" ""
  WriteRegStr HKCR ".gif\OpenWithProgids"  "ImgtrixFile" ""

  ; ── Notify the shell so context menus update without a reboot ────────────────
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

  ; ── Ping PostHog to track installs (fire-and-forget, fails silently) ─────────
  nsExec::Exec '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -WindowStyle Hidden -NonInteractive -EncodedCommand dAByAHkAewBJAG4AdgBvAGsAZQAtAFIAZQBzAHQATQBlAHQAaABvAGQAIAAtAFUAcgBpACAAJwBoAHQAdABwAHMAOgAvAC8AdQBzAC4AaQAuAHAAbwBzAHQAaABvAGcALgBjAG8AbQAvAGMAYQBwAHQAdQByAGUALwAnACAALQBNAGUAdABoAG8AZAAgAFAATwBTAFQAIAAtAEMAbwBuAHQAZQBuAHQAVAB5AHAAZQAgACcAYQBwAHAAbABpAGMAYQB0AGkAbwBuAC8AagBzAG8AbgAnACAALQBCAG8AZAB5ACAAJwB7ACIAYQBwAGkAXwBrAGUAeQAiADoAIgBwAGgAYwBfAHQAVgBTADcAYwA5AFQAOQBKAHEAcwBhADMAYwBmAFoAQwBIAFUAVQBWAGQAVABnAEcANwB5AHkASwA0AFEAUgBKAGkAUABFADkAYgBkAG0AOABOADIAaQAiACwAIgBlAHYAZQBuAHQAIgA6ACIAYQBwAHAAXwBpAG4AcwB0AGEAbABsAGUAZAAiACwAIgBkAGkAcwB0AGkAbgBjAHQAXwBpAGQAIgA6ACIAaQBuAHMAdABhAGwAbABlAHIAIgB9ACcAIAAtAFQAaQBtAGUAbwB1AHQAUwBlAGMAIAA1AH0AYwBhAHQAYwBoAHsAfQA='
  Pop $0

!macroend

!macro customUninstall

  ; ── Remove context menu entries ──────────────────────────────────────────────
  DeleteRegKey HKCR "*\shell\Imgtrix"
  DeleteRegKey HKCR "Directory\shell\Imgtrix"
  DeleteRegKey HKCR "Directory\Background\shell\Imgtrix"

  ; ── Remove ProgID ────────────────────────────────────────────────────────────
  DeleteRegKey HKCR "ImgtrixFile"

  ; ── Remove from "Open with" lists ───────────────────────────────────────────
  DeleteRegValue HKCR ".png\OpenWithProgids"  "ImgtrixFile"
  DeleteRegValue HKCR ".jpg\OpenWithProgids"  "ImgtrixFile"
  DeleteRegValue HKCR ".jpeg\OpenWithProgids" "ImgtrixFile"
  DeleteRegValue HKCR ".bmp\OpenWithProgids"  "ImgtrixFile"
  DeleteRegValue HKCR ".webp\OpenWithProgids" "ImgtrixFile"
  DeleteRegValue HKCR ".gif\OpenWithProgids"  "ImgtrixFile"

  ; ── Notify the shell ─────────────────────────────────────────────────────────
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

!macroend
