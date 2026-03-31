# backend/error_handler.py
import os
import traceback
import datetime

# Log file sits in the project root, next to run.py
import sys as _sys

def _get_log_path():
    if getattr(_sys, 'frozen', False):
        # Running as .exe — write log next to the .exe file
        return os.path.join(os.path.dirname(_sys.executable), "app_errors.log")
    else:
        # Running as python — write in project root
        return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app_errors.log")

_LOG_PATH = _get_log_path()

# ── Known business error keywords → friendly messages ────────────────────────
# These are things that CAN happen in normal use and should guide the admin.
_FRIENDLY_MESSAGES = [
    # Auth / session
    ("not authenticated",           "Please log in and try again."),
    ("session_expired",             "Your session has expired. Please log in again."),
    ("jwt expired",                 "Your session has expired. Please log in again."),
    ("invalid or expired otp",      "The OTP is invalid or expired. Please request a new one."),
    ("invalid email or password",   "Incorrect email or password."),
    ("email already registered",    "This email is already registered."),

    # Customer / subscription not found
    ("customer not found",          "Customer not found. Please refresh the page."),
    ("subscription not found",      "This plan was not found. Please refresh the page."),
    ("plan not found",              "Plan not found. Please refresh the page."),
    ("this plan has been removed",  "This plan has already been removed. Please refresh the page."),

    # Payment / financial
    ("no advance balance",          "No advance balance available to transfer."),
    ("no pending debt",             "No pending debt available to transfer."),
    ("payment amount must be",      "Payment amount must be greater than zero."),
    ("cheque number is required",   "Please enter the cheque number."),

    # WhatsApp bot
    ("no valid phone numbers",      "No valid phone number found for this customer."),
    ("not registered on whatsapp",  "This customer's number is not registered on WhatsApp."),
    ("whatsapp bot could not open", "Could not open a browser for WhatsApp. Please install Chrome, Edge, or Firefox."),

    # Connectivity
    ("connection refused",          "Could not connect to the server. Please check your internet connection."),
    ("connection error",            "Connection error. Please check your internet and try again."),
    ("timeout",                     "The request timed out. Please try again."),

    # Data issues
    ("missing user id",             "Missing information. Please refresh and try again."),
    ("missing source or target",    "Missing plan information. Please refresh and try again."),
    ("invalid action",              "Invalid action. Please refresh and try again."),
]


def friendly(e: Exception) -> str:
    """
    Given an exception, return a human-friendly error message.

    - If the error matches a known business condition → return the friendly string.
    - Otherwise → log the full traceback to app_errors.log and return a generic message.
    """
    raw = str(e).lower()

    # Check known business errors first (no logging needed — these are expected)
    for keyword, message in _FRIENDLY_MESSAGES:
        if keyword in raw:
            return message

    # Unknown / unexpected error → log it, show generic message
    _log_error(e)
    return "Something went wrong. Please try again. If this keeps happening, check the error log."


def _log_error(e: Exception):
    """Write full traceback to app_errors.log with timestamp."""
    try:
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        tb = traceback.format_exc()
        line = f"\n{'='*60}\n[{timestamp}]\n{tb}\n"
        with open(_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line)
        print(f"[ERROR LOGGED] {_LOG_PATH}")
    except Exception:
        pass  # Never let logging itself crash the app

def log_error(e: Exception, context: str = ""):
    """
    Public wrapper for direct error logging without showing a friendly message.
    Use this for background thread errors (e.g. evaluate_js failures).
    """
    _log_error(e)
    if context:
        print(f"[ERROR] {context}: {e}")
    else:
        print(f"[BACKGROUND ERROR]: {e}")