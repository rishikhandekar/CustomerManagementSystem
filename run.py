import webview
from pathlib import Path
from backend.main import Api

def main():
    api = Api()

    html_path = Path("frontend/html/login.html").resolve()

    webview.create_window(
        title="CMS",
        url=html_path.as_uri(),
        width=1100,
        height=750,
        resizable=True,
        js_api=api
    )

    webview.start(debug=False)

if __name__ == "__main__":
    main()
