# backend/database.py
from dotenv import load_dotenv
from pathlib import Path
import os
from supabase import create_client, Client

# Load .env from project root
env_path = Path(__file__).resolve().parents[1] / ".env"
if env_path.exists():
    load_dotenv(env_path)

SUPABASE_URL = "https://pwgjvxkpagchmnlsxbmv.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3Z2p2eGtwYWdjaG1ubHN4Ym12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwNDI0MTEsImV4cCI6MjA3ODYxODQxMX0.dMF8YINsu9BI6xbvtyJL572mAzBkWEI189pzHFbxtag"

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Set SUPABASE_URL and SUPABASE_KEY in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def set_auth_session(access_token: str, refresh_token: str = None):
    """
    Set the Supabase Auth session on the global client.

    When refresh_token is provided:
    - supabase.auth.set_session() is called with both tokens
    - Supabase internally hooks postgrest to use refreshed token automatically
    - Token auto-refreshes before 1 hour expiry — no re-login needed

    IMPORTANT: Never call postgrest.auth(token) manually after set_session()
    — that hardcodes the old token into postgrest and breaks auto-refresh.
    """
    try:
        if refresh_token:
            # Full session with auto-refresh capability
            supabase.auth.set_session(access_token, refresh_token)
        else:
            # Fallback — no auto-refresh but works
            supabase.postgrest.auth(access_token)
        print("Auth session set ✅")
    except Exception as e:
        print(f"Error setting auth session: {e}")
        try:
            supabase.postgrest.auth(access_token)
        except Exception:
            pass