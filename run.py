import sys
import os
import ctypes
import traceback
import subprocess

# ── 1. THE PYINSTALLER WINDOWED CRASH FIX (SAFE VERSION) ───────────
if sys.platform == "win32":
    # We patch only the initialization, keeping Popen as a Class so asyncio doesn't break!
    _original_popen_init = subprocess.Popen.__init__
    
    def _patched_popen_init(self, *args, **kwargs):
        kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW | kwargs.get('creationflags', 0)
        _original_popen_init(self, *args, **kwargs)
        
    subprocess.Popen.__init__ = _patched_popen_init

# Prevents crash if something tries to print to the missing terminal
if sys.stdout is None: sys.stdout = open(os.devnull, "w")
if sys.stderr is None: sys.stderr = open(os.devnull, "w")
# ──────────────────────────────────────────────────────────────────

# ── 2. SINGLE INSTANCE CHECK ──────────────────────────────────────
hwnd = ctypes.windll.user32.FindWindowW(None, "Customer Management System")
if hwnd:
    ctypes.windll.user32.ShowWindow(hwnd, 9) 
    ctypes.windll.user32.SetForegroundWindow(hwnd)
    sys.exit(0)
# ──────────────────────────────────────────────────────────────────

# ── 3. Windows taskbar icon fix ───────────────────────────────────
try:
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(
        "CustomerManagementSystem.CMS"
    )
except Exception:
    pass

# ── 4. Path resolver ──────────────────────────────────────────────
def resource_path(relative):
    if getattr(sys, 'frozen', False):
        base = sys._MEIPASS
    else:
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
    # We cannot use print() or input() because there is no terminal!
    # Force Windows to pop up a native error box instead.
    error_details = traceback.format_exc()
    error_msg = f"A critical error occurred:\n\n{str(e)}\n\n{error_details}"
    
    # 0x10 creates a window with the red Error "X" icon
    ctypes.windll.user32.MessageBoxW(0, error_msg, "Startup Error", 0x10)
    sys.exit(1)