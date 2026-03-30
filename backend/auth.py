# backend/auth.py
import re
import time
import threading
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from . import database as db_module
from .error_handler import friendly


def normalize_email(email: str) -> str:
    return email.strip().lower()


def get_user_by_email(email: str):
    email = normalize_email(email)
    return db_module.supabase.table("users").select("*").eq("email", email).limit(1).execute().data


# -------------------------
# Register
# -------------------------
def register_user(name, email, password):
    """
    Register via Supabase Auth.
    Supabase UUID becomes our user_id.
    Supabase sends verification OTP email automatically.
    """
    email = normalize_email(email)

    # ✅ SECURITY FIX: Password Strength Validator (Length, Lower, Upper, Number, Special)
    if len(password) < 8 or not re.search(r"[a-z]", password) or not re.search(r"[A-Z]", password) or not re.search(r"\d", password) or not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        return {
            "ok": False, 
            "error": "Password must be at least 8 characters long, contain an uppercase letter, a lowercase letter, a number, and a special character."
        }

    try:
        res = db_module.supabase.auth.sign_up({
            "email": email,
            "password": password
        })

        if not res.user:
            return {"ok": False, "error": "Registration failed"}

        supabase_user_id = res.user.id

        # Insert profile into our users table using Supabase UUID as id
        existing = db_module.supabase.table("users").select("id").eq("id", supabase_user_id).execute().data
        if not existing:
            db_module.supabase.table("users").insert({
                "id": supabase_user_id,
                "email": email,
                "name": name,
                "password_hash": None,
                "google_id": None,
                "is_verified": False,
            }).execute()

        return {"ok": True}

    except Exception as e:
        error_msg = str(e).lower()
        if "already registered" in error_msg or "already been registered" in error_msg or "duplicate" in error_msg:
            return {"ok": False, "error": "Email already registered"}
        return {"ok": False, "error": friendly(e)}


# -------------------------
# Login
# -------------------------
def login_user(email, password):
    """
    Step 1 of login: Validate password via Supabase Auth.
    Returns access_token to be used after OTP verification.
    """
    email = normalize_email(email)

    try:
        res = db_module.supabase.auth.sign_in_with_password({
            "email": email,
            "password": password
        })

        if not res.user or not res.session:
            return {"ok": False, "error": "Invalid email or password"}

        user_id = res.user.id
        access_token = res.session.access_token

        # Ensure profile exists in our users table
        user_data = db_module.supabase.table("users").select("*").eq("email", email).limit(1).execute().data
        if not user_data:
            db_module.supabase.table("users").insert({
                "id": user_id,
                "email": email,
                "name": email.split("@")[0],
                "password_hash": None,
                "google_id": None,
                "is_verified": True,
            }).execute()

        return {
            "ok": True,
            "access_token": access_token,
            "user_id": user_id
        }

    except Exception as e:
        error_msg = str(e).lower()
        if "invalid" in error_msg or "credentials" in error_msg:
            return {"ok": False, "error": "Invalid email or password"}
        return {"ok": False, "error": friendly(e)}


def send_login_otp(email):
    email = normalize_email(email)
    try:
        db_module.supabase.auth.sign_in_with_otp({
            "email": email,
            "options": {
                "should_create_user": False,
                "email_redirect_to": None
            }
        })
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": friendly(e)}


# -------------------------
# OTP Verification
# -------------------------
def verify_supabase_otp(email, code, otp_type):
    """
    Verify OTP via Supabase Auth.
    otp_type: 'email' (login), 'signup' (register), 'recovery' (password reset)
    Returns session access_token, refresh_token and user_id on success.
    """
    email = normalize_email(email)
    try:
        res = db_module.supabase.auth.verify_otp({
            "email": email,
            "token": str(code).strip(),
            "type": otp_type
        })

        if not res.user or not res.session:
            return {"ok": False, "error": "Invalid or expired OTP"}

        return {
            "ok": True,
            "access_token": res.session.access_token,
            "refresh_token": res.session.refresh_token,  # ✅ Added for auto-refresh
            "user_id": res.user.id
        }

    except Exception as e:
        return {"ok": False, "error": "Invalid or expired OTP"}


# -------------------------
# Password Reset
# -------------------------
def send_password_reset(email):
    email = normalize_email(email)
    try:
        # Let Supabase handle the stealth check
        db_module.supabase.auth.reset_password_for_email(email)
        
        # ✅ Return True so the JS moves to the OTP page
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": friendly(e)}


def reset_password_with_token(new_password):
    """Reset password for currently authenticated user."""
    try:
        db_module.supabase.auth.update_user({"password": new_password})
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": friendly(e)}


# -------------------------
# Google OAuth
# -------------------------
# ✅ Thread-safe Google OAuth state using Lock
# Stores access_token AND refresh_token for auto-refresh support
_google_auth_lock = threading.Lock()
_google_auth_state = {
    "finished": False,
    "user_id": None,
    "access_token": None,
    "refresh_token": None   # ✅ Added for auto-refresh
}


def check_google_login_status():
    with _google_auth_lock:
        return _google_auth_state["finished"]


def get_google_user_id():
    with _google_auth_lock:
        return _google_auth_state["user_id"]


def get_google_access_token():
    with _google_auth_lock:
        return _google_auth_state["access_token"]


def get_google_refresh_token():
    with _google_auth_lock:
        return _google_auth_state["refresh_token"]


class OAuthCallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urlparse(self.path)

        if parsed_path.path != "/auth/callback":
            self.send_response(404)
            self.end_headers()
            return

        query_params = parse_qs(parsed_path.query)
        code = query_params.get("code", [None])[0]

        if code:
            try:
                res = db_module.supabase.auth.exchange_code_for_session({"auth_code": code})
                user = res.user
                session = res.session

                real_db_id = sync_google_user(
                    user.email,
                    user.user_metadata.get("full_name"),
                    user.id
                )

                # ✅ Save both tokens atomically under lock
                with _google_auth_lock:
                    _google_auth_state["user_id"] = real_db_id
                    _google_auth_state["access_token"] = session.access_token if session else None
                    _google_auth_state["refresh_token"] = session.refresh_token if session else None
                    _google_auth_state["finished"] = True

                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"<h1>Login Successful!</h1><p>You can close this window and return to the app.</p>")
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(f"Error: {str(e)}".encode())
        else:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"No auth code found.")

    def log_message(self, format, *args):
        pass  # Suppress HTTP server logs


def start_server():
    time.sleep(0.5)  # ✅ Let OS release port from any previous attempt
    server = None
    try:
        HTTPServer.allow_reuse_address = True  # ✅ Must be set BEFORE bind
        server = HTTPServer(('localhost', 54321), OAuthCallbackHandler)
        server.timeout = 180
        server.handle_request()
    except OSError as e:
        print(f"OAuth port error — port 54321 still in use: {e}")
    except Exception as e:
        print(f"OAuth server error: {e}")
    finally:
        if server:
            try:
                server.server_close()
            except Exception:
                pass


def start_google_oauth_flow():
    # ✅ Reset all state atomically under lock
    with _google_auth_lock:
        _google_auth_state["finished"] = False
        _google_auth_state["user_id"] = None
        _google_auth_state["access_token"] = None
        _google_auth_state["refresh_token"] = None

    data = db_module.supabase.auth.sign_in_with_oauth({
        "provider": "google",
        "options": {
            "redirect_to": "http://localhost:54321/auth/callback",
            "flow_type": "pkce"
        }
    })

    auth_url = data.url
    threading.Thread(target=start_server, daemon=True).start()
    webbrowser.open(auth_url)


def sync_google_user(email, name, supabase_auth_id):
    """
    Sync Google user to our users table.
    For new users: create with Supabase UUID as id.
    For existing users: update google_id.
    Returns user_id to use.
    """
    email = normalize_email(email)

    users = db_module.supabase.table("users").select("*").eq("email", email).limit(1).execute().data

    if users:
        existing = users[0]
        # Update google_id
        db_module.supabase.table("users").update({
            "google_id": supabase_auth_id,
            "is_verified": True
        }).eq("id", existing['id']).execute()
        return existing['id']
    else:
        # New Google user — use Supabase UUID as id
        db_module.supabase.table("users").insert({
            "id": supabase_auth_id,
            "email": email,
            "name": name or "Google User",
            "google_id": supabase_auth_id,
            "password_hash": None,
            "is_verified": True,
        }).execute()
        return supabase_auth_id