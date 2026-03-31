import sys
import os
import ctypes
import traceback

# ── 1. SINGLE INSTANCE CHECK (Add this here) ───────────────────────
# This looks for an already open window with your exact title
hwnd = ctypes.windll.user32.FindWindowW(None, "Customer Management System")
if hwnd:
    # If found, bring the existing window to the front
    ctypes.windll.user32.ShowWindow(hwnd, 9) 
    ctypes.windll.user32.SetForegroundWindow(hwnd)
    # Exit this new process so only one window stays open
    sys.exit(0)
# ──────────────────────────────────────────────────────────────────

# ── Windows taskbar icon fix ───────────────────────────────────────
try:
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(
        "CustomerManagementSystem.CMS"
    )
except Exception:
    pass

# ── Path resolver — works both in Python and compiled .exe ────────
def resource_path(relative):
    """Get absolute path to resource. Works for dev and PyInstaller."""
    if getattr(sys, 'frozen', False):
        # Running as compiled .exe — files are in sys._MEIPASS
        base = sys._MEIPASS
    else:
        # Running as python run.py — files are next to run.py
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, relative)
# ──────────────────────────────────────────────────────────────────

try:
    import webview
    from pathlib import Path
    from backend.main import Api

    def main():
        api = Api()

        html_path = resource_path(os.path.join("frontend", "html", "login.html"))
        icon_path  = resource_path("CMS.ico")

        webview.create_window(
            title="Customer Management System",
            url=Path(html_path).as_uri(),
            width=1100,
            height=750,
            resizable=True,
            js_api=api
        )

        webview.start(
            debug=False,
            icon=icon_path if os.path.exists(icon_path) else None
        )

    if __name__ == "__main__":
        main()

except Exception as e:
    print("STARTUP ERROR:", e)
    traceback.print_exc()
    input("Press Enter to close...")