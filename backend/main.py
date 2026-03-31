# backend/main.py
import webview
from .error_handler import friendly, log_error
from . import database as db_module
from .database import set_auth_session
from .auth import (
    register_user,
    login_user,
    send_login_otp,
    verify_supabase_otp,
    send_password_reset,
    reset_password_with_token,
    start_google_oauth_flow,
    check_google_login_status,
    get_google_user_id,
    get_google_access_token,
    get_google_refresh_token
)
import datetime
import pytz
import pyperclip
import random

import re

import threading
import base64
import shutil
import urllib.request
import json
from .version import __version__
import sys
import subprocess

from deep_translator import GoogleTranslator
import platform
import os
import time
import urllib.parse
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.keys import Keys 

# Chrome imports
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.edge.options import Options as EdgeOptions
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from selenium.webdriver import Firefox

from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.edge.service import Service as EdgeService
from selenium.webdriver.firefox.service import Service as FirefoxService
from subprocess import CREATE_NO_WINDOW

from selenium.webdriver.common.action_chains import ActionChains

class Api:

    def upload_qr_code(self, payload):
        """
        Receives a base64-encoded image from the frontend and uploads it
        to Supabase Storage under qr-codes/{user_id}/{qr_type}_qr.png
        qr_type: 'cable', 'internet', or 'both'
        """
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            import base64

            qr_type  = payload.get("qr_type")   # 'cable', 'internet', 'both'
            b64_data = payload.get("image_b64")  # data:image/png;base64,....

            if qr_type not in ("cable", "internet", "both"):
                return {"ok": False, "error": "Invalid QR type."}
            if not b64_data:
                return {"ok": False, "error": "No image data received."}

            # Strip the data URL prefix if present
            if "," in b64_data:
                b64_data = b64_data.split(",", 1)[1]

            image_bytes = base64.b64decode(b64_data)
            user_id     = self.active_user_id
            file_path   = f"{user_id}/{qr_type}_qr.png"

            # Upload to Supabase Storage (upsert = overwrite if already exists)
            db_module.supabase.storage.from_("qr-codes").upload(
                path=file_path,
                file=image_bytes,
                file_options={"content-type": "image/png", "upsert": "true"}
            )

            # Get the public URL so the frontend can preview it
            public_url = db_module.supabase.storage.from_("qr-codes").get_public_url(file_path)

            return {"ok": True, "url": public_url}

        except Exception as e:
            return {"ok": False, "error": friendly(e)}


    def get_qr_urls(self, payload=None):
        """
        Returns the public URLs for all three QR codes for the current user.
        Returns None for any that haven't been uploaded yet.
        """
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            user_id = self.active_user_id
            urls    = {}

            for qr_type in ("cable", "internet", "both"):
                file_path = f"{user_id}/{qr_type}_qr.png"
                try:
                    # Check if file actually exists by listing
                    files = db_module.supabase.storage.from_("qr-codes").list(user_id)
                    exists = any(f.get("name") == f"{qr_type}_qr.png" for f in (files or []))
                    if exists:
                        urls[qr_type] = db_module.supabase.storage.from_("qr-codes").get_public_url(file_path)
                    else:
                        urls[qr_type] = None
                except Exception:
                    urls[qr_type] = None

            return {"ok": True, "urls": urls}

        except Exception as e:
            return {"ok": False, "error": friendly(e)}


    def _download_qr_to_temp(self, qr_type):
        """
        Downloads the QR image from Supabase Storage to a local temp file.
        Returns the local file path, or None if not uploaded.
        qr_type: 'cable', 'internet', or 'both'
        """
        import tempfile
        try:
            user_id   = self.active_user_id
            file_path = f"{user_id}/{qr_type}_qr.png"
            data      = db_module.supabase.storage.from_("qr-codes").download(file_path)
            if not data:
                return None
            # Write to a named temp file that persists until we delete it
            tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
            tmp.write(data)
            tmp.flush()
            tmp.close()
            return tmp.name
        except Exception:
            return None
    
    def get_admin_profile(self, payload):
        """Fetch the logged-in admin's profile data."""
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            user_id = self.active_user_id
            res = db_module.supabase.table('users').select("*").eq("id", user_id).execute()
            
            if not res.data:
                return {"ok": False, "error": "User not found"}
            
            user = res.data[0]
            
            # ✅ THE FIX: Read the actual auth_method column from the database!
            auth_method = user.get("auth_method")
            if not auth_method:
                # Fallback just in case it's an old login
                auth_method = "Google" if user.get("google_id") else "Email/Password"

            return {
                "ok": True, 
                "data": {
                    "name": user.get("name", ""),
                    "email": user.get("email", ""),
                    "phone": user.get("phone", ""),
                    "business_name": user.get("business_name", ""),
                    "business_address": user.get("business_address", ""),
                    "support_contact": user.get("support_contact", ""),
                    "gstin": user.get("gstin", ""),
                    "last_login": user.get("last_login", ""),
                    "auth_method": auth_method,
                    "auto_reminder_enabled": user.get("auto_reminder_enabled", True) # ✅ Uses the real saved method now
                }
            }
        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    def update_admin_profile(self, payload):
        """Update the admin's personal and business details."""
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            user_id = self.active_user_id
            updates = {
                "name": payload.get("name"),
                "phone": payload.get("phone"),
                "business_name": payload.get("business_name"),
                "business_address": payload.get("business_address"),
                "support_contact": payload.get("support_contact"),
                "gstin": payload.get("gstin")
            }
            db_module.supabase.table('users').update(updates).eq("id", user_id).execute()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}
        
    def get_payment_dashboard_data(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            user_id = self.active_user_id
            if not user_id: return {"ok": False, "error": "Missing User ID"}

            # Read filters — identical to original
            page          = 0
            search_term   = ""
            search_type   = "name"
            plan_type     = "cable"
            status_filter = "pending"

            if isinstance(payload, dict):
                page          = int(payload.get("page", 0))
                search_term   = str(payload.get("search_term", "")).strip().lower()
                search_type   = payload.get("search_type", "name")
                plan_type     = payload.get("plan_type", "cable")
                status_filter = payload.get("status", "pending")

            # One RPC call — filtering, status categorisation, and pagination
            # all happen in the database. Python receives only the 20 rows it needs.
            result = db_module.supabase.rpc("get_payment_dashboard_data", {
                "p_user_id":       user_id,
                "p_plan_type":     plan_type,
                "p_status_filter": status_filter,
                "p_search_term":   search_term,
                "p_search_type":   search_type,
                "p_page":          page,
            }).execute()

            data     = result.data or {}
            rows     = data.get("rows", [])
            has_more = data.get("has_more", False)

            return {"ok": True, "data": rows, "has_more": has_more}

        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    def get_dashboard_stats(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            user_id = self.active_user_id
            now_ist = datetime.datetime.now(pytz.timezone('Asia/Kolkata'))

            result = db_module.supabase.rpc('get_dashboard_stats', {
                'p_user_id': user_id,
                'p_now':     now_ist.isoformat()
            }).execute()

            data = result.data
            if not data:
                return {"ok": False, "error": "No data returned"}

            # Fix defaulters key name to match frontend expectation
            if data.get('action_cards', {}).get('defaulters'):
                for d in data['action_cards']['defaulters']:
                    d['total_pending_all_current'] = d.pop('total_pending', 0)

            return {"ok": True, "data": data}

        except Exception as e:
            return {"ok": False, "error": friendly(e)}
        
    def get_daily_tracker_data(self, payload):
        """Fetches Activated, Renewed, or Expired plans using strict calendar logic."""
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            
            user_id = self.active_user_id
            target_date = payload.get("target_date") # Format: YYYY-MM-DD
            date_type = payload.get("date_type") # 'activation', 'renewal', 'expiry'
            
            if not user_id or not target_date:
                return {"ok": False, "error": "Missing parameters"}

            # Parse the calendar date
            target_date_obj = datetime.datetime.strptime(target_date, "%Y-%m-%d").date()

            # Base query structure
            query = db_module.supabase.table('subscriptions')\
                .select("id, customer_id, cable_plan_id, internet_plan_id, plan_name_cached, customers(customer_seq_id, name, phone, short_address)")\
                .eq("user_id", user_id)\
                .neq("status", "deleted")

            # 1. ACTIVATED DATE (Last Activated / Cycle Start)
            if date_type == "activation":
                start_str = f"{target_date}T00:00:00"
                end_str = f"{target_date}T23:59:59"
                res = query.gte("current_billing_start_date", start_str).lte("current_billing_start_date", end_str).execute()

            # 2. RENEWAL DATE (Exact Match with End Date)
            elif date_type == "renewal":
                start_str = f"{target_date}"
                end_str = f"{target_date}T23:59:59"
                res = query.eq("current_billing_end_date", target_date).execute()

            # 3. EXPIRY DATE (Customer plan is expiring, meaning Renewal is Tomorrow)
            elif date_type == "expiry":
                # If calendar matches Expiry Date, Renewal Date = Calendar + 1 day
                renewal_date = target_date_obj + datetime.timedelta(days=1)
                ren_str = renewal_date.strftime("%Y-%m-%d")
                
                # Search for the calculated Renewal Date in DB
                res = query.eq("current_billing_end_date", ren_str).execute()
            
            else:
                return {"ok": False, "error": "Invalid date type"}

            return {"ok": True, "data": res.data or []}
            
        except Exception as e:
            print("Tracker Data Error:", friendly(e))
            return {"ok": False, "error": friendly(e)}
    
    # ---------------------------------------------------------
    # ✅ AUTOMATED BOT: START THE BACKGROUND CLOCK
    # ---------------------------------------------------------
    def __init__(self):
        self.active_user_id = None
        self.auto_reminder_enabled = True

        # --- NEW: AUTO UPDATER VARIABLES ---
        self.download_progress = 0
        self.download_status = "idle"
        self.new_file_path = ""

        # Starts the silent background clock as soon as the app opens
        self.auto_reminder_thread = threading.Thread(target=self._automated_reminder_loop, daemon=True)
        self.auto_reminder_thread.start()
        print("Automated WhatsApp Scheduler Started (Waiting for 11:10 AM)")

    def _require_auth(self):
        """Call at the start of any sensitive method. Returns error dict if not logged in, None if ok."""
        if not self.active_user_id:
            return {"ok": False, "error": "Please log in and try again."}
        return None
    
    def get_reminder_status(self, payload=None):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        return {"ok": True, "enabled": self.auto_reminder_enabled}

    def set_reminder_status(self, payload=None):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        enabled = payload.get("enabled", True) if isinstance(payload, dict) else True
        self.auto_reminder_enabled = bool(enabled)
        try:
            db_module.supabase.table('users').update(
                {"auto_reminder_enabled": self.auto_reminder_enabled}
            ).eq("id", self.active_user_id).execute()
            print(f"[Reminder] Daily reminder {'enabled' if enabled else 'disabled'} saved to DB.")
        except Exception as e:
            print(f"[Reminder] Could not save to DB: {e}")
        return {"ok": True, "enabled": self.auto_reminder_enabled}

    def restore_session(self, payload):
        """
        Called from frontend after OTP/Google login to re-link the bot
        if the app was restarted mid-session.
        """
        # 1. Grab the secure token, NOT the user_id
        token = payload.get("access_token") if isinstance(payload, dict) else None
        
        if not token:
            return {"ok": False, "error": "Missing access token"}
            
        # 2. Only try to re-link if Python's memory is currently empty
        if not self.active_user_id:
            try:
                # 3. SECURE CHECK: We ask Supabase if this token is real and unexpired
                user_res = db_module.supabase.auth.get_user(token)
                
                if user_res and user_res.user:
                    # 4. We grab the true ID directly from the database, NOT the frontend
                    self.active_user_id = user_res.user.id
                    print(f"Secure session restored for user: {self.active_user_id}")
                    try:
                        _pref = db_module.supabase.table('users').select("auto_reminder_enabled").eq("id", self.active_user_id).execute()
                        if _pref.data:
                            self.auto_reminder_enabled = _pref.data[0].get("auto_reminder_enabled", True)
                    except Exception:
                        self.auto_reminder_enabled = True
                    return {"ok": True}
                else:
                    return {"ok": False, "error": "Invalid token"}
                    
            except Exception as e:
                return {"ok": False, "error": "Session expired or invalid."}
                
        return {"ok": True, "message": "Bot is already linked."}
    
    def get_secure_session_dir(self):
        # Find the OS-protected AppData folder
        if platform.system() == "Windows":
            base_dir = os.environ.get("APPDATA", os.path.expanduser("~"))
        elif platform.system() == "Darwin": # Mac
            base_dir = os.path.expanduser("~/Library/Application Support")
        else: # Linux
            base_dir = os.path.expanduser("~/.config")
            
        app_dir = os.path.join(base_dir, "CableMediaApp")
        os.makedirs(app_dir, exist_ok=True)
        session_dir = os.path.join(app_dir, "WhatsApp_Session")
        
        # If Chrome crashed previously, it leaves a lock file that breaks future launches.
        # This automatically deletes the lock file before Selenium tries to open.
        lock_file = os.path.join(session_dir, "SingletonLock")
        if os.path.exists(lock_file):
            try:
                os.remove(lock_file)
                print("Cleared residual Chrome lock file.")
            except Exception:
                pass 
                
        return session_dir

    def link_whatsapp(self, payload=None):
        auth_err = self._require_auth()
        if auth_err:
            return auth_err

        def _open_qr_browser():
            session_dir = self.get_secure_session_dir()
            driver = None
            try:
                chrome_options = ChromeOptions()
                chrome_options.add_argument(f"--user-data-dir={session_dir}")
                chrome_options.add_argument("--no-sandbox")
                chrome_options.add_argument("--disable-dev-shm-usage")
                chrome_options.add_argument("--disable-gpu")
                
                service = ChromeService()
                service.creation_flags = CREATE_NO_WINDOW
                driver = webdriver.Chrome(options=chrome_options, service=service)
                print("[link_whatsapp] Chrome opened for QR scan.")
                
            except Exception as e:
                friendly_error = friendly(e).replace("'", "\\'")
                try:
                    if webview.windows:
                        webview.windows[0].evaluate_js(f"showCMSAlert('Browser Notice', '{friendly_error} Trying Edge...');")
                except:
                    pass
                
                # 2. ATTEMPT EDGE
                try:
                    edge_options = EdgeOptions()
                    edge_options.add_argument(f"--user-data-dir={session_dir}")
                    edge_options.add_argument("--no-sandbox")
                    edge_options.add_argument("--disable-dev-shm-usage")
                    edge_options.add_argument("--disable-gpu")
                    
                    service = EdgeService()
                    service.creation_flags = CREATE_NO_WINDOW
                    driver = webdriver.Edge(options=edge_options, service=service)
                    print("[link_whatsapp] Edge opened for QR scan.")
                    
                except Exception:
                    # 3. ATTEMPT FIREFOX
                    try:
                        firefox_options = FirefoxOptions()
                        
                        # 🌟 THE FIX: Give Firefox its own dedicated save folder
                        ff_session_dir = f"{session_dir}_FF"
                        firefox_options.add_argument("-profile")
                        firefox_options.add_argument(ff_session_dir)
                        
                        service = FirefoxService()
                        service.creation_flags = CREATE_NO_WINDOW
                        driver = Firefox(options=firefox_options, service=service)
                        print("[link_whatsapp] Mozilla Firefox opened for QR scan.")
                        
                    except Exception as e:
                        print(f"[link_whatsapp] Could not open any browser: {e}")
                        return

            try:
                driver.get("https://web.whatsapp.com")
                print("[link_whatsapp] Waiting 3 minutes for QR scan...")
                time.sleep(180)
            except Exception as e:
                print(f"[link_whatsapp] Browser error: {e}")
            finally:
                try:
                    driver.quit()
                    print("[link_whatsapp] Browser closed after QR session.")
                except Exception:
                    pass

        thread = threading.Thread(target=_open_qr_browser, daemon=True)
        thread.start()

        return {
            "ok": True,
            "message": "Opening WhatsApp... Please scan the QR code within the next 3 minutes."
        }

    def force_run_daily_reminders(self, payload=None):
        auth_err = self._require_auth()
        if auth_err:
            return auth_err

        thread = threading.Thread(target=self._trigger_automated_reminders, daemon=True)
        thread.start()

        return {
            "ok": True,
            "message": "Daily reminders are starting in the background!"
        }

    def logout_active_user(self):
        """
        Proper logout:
        1. Signs out from Supabase Auth — automatically clears session
           and postgrest token (no manual postgrest.auth(None) needed)
        2. Clears active_user_id — stops the WhatsApp bot
        """
        try:
            db_module.supabase.auth.sign_out()
        except Exception as e:
            print(f"Supabase sign out error: {e}")

        self.active_user_id = None
        return {"ok": True}

    # ---------------------------------------------------------
    # ✅ AUTOMATED BOT: THE 10:59 AM DAILY TRIGGER
    # ---------------------------------------------------------
    def _automated_reminder_loop(self):
        tz = pytz.timezone('Asia/Kolkata')
        last_run_date = None
        
        while True:
            now = datetime.datetime.now(tz)
            
            # Check if the time is EXACTLY 10:59 AM (Or your testing time)
            if now.hour == 11 and now.minute == 30:
                current_date = now.date()
                
                # Make sure it only runs once per day locally
                if last_run_date != current_date:
                    if not self.auto_reminder_enabled:
                        print(f"\n[{now.strftime('%I:%M %p')}] Skipped: Daily reminder is disabled by admin.")
                        last_run_date = current_date
                        continue
                    if self.active_user_id: # SECURE: Only run if someone is logged in
                        
                        # =========================================================
                        # DATABASE LOCK: PREVENT DUPLICATE DEVICE EXECUTIONS
                        # =========================================================
                        try:
                            # 1. Both devices attempt to shove this row into the DB at the exact same millisecond
                            lock_payload = {
                                "user_id": self.active_user_id,
                                "lock_date": str(current_date)
                            }
                            db_module.supabase.table('daily_bot_lock').insert(lock_payload).execute()
                            
                            # 2. If the code reaches here, THIS device won the race! The database accepted the lock.
                            print(f"\n[{now.strftime('%I:%M %p')}] Lock acquired! Triggering Automated Reminders for User: {self.active_user_id}")
                            self._trigger_automated_reminders()
                            
                        except Exception as lock_err:
                            print(f"\n[{now.strftime('%I:%M %p')}] Skipped: Another device has already acquired the lock...")
                            log_error(lock_err, context="Automated Reminder Lock Error")
                            
                    else:
                        print(f"\n[{now.strftime('%I:%M %p')}] Skipped Automated Reminders: No user is currently logged in.")
                    
                    last_run_date = current_date
            
            # Check the clock every 30 seconds
            time.sleep(30)

    # --- ✅ UPDATED: Safe Hybrid Payment Fetcher ---
    def get_cycle_payments(self, payload):
        """
        Fetches payments using STRICT Database IDs (Timestamps).
        """
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            sub_id = payload.get("subscription_id")
            history_id = payload.get("history_id")
            
            # This 'target_label' comes from frontend (e.g. "2026-02-14T10:05:00..." or "UPCOMING")
            target_label = str(payload.get("cycle_start_date", "")).strip()
            
            combined_rows = []
            
            # =========================================================
            # STRATEGY 1: ACTIVE LOGS (Strict Timestamp Match)
            # =========================================================
            if sub_id:
                res = db_module.supabase.table('advance_logs').select("*").eq("subscription_id", sub_id).order('created_at', desc=True).execute()
                logs = res.data or []

                for log in logs:
                    db_label = log.get('cycle_label')
                    reason = log.get('reason', "")
                    amount = abs(log.get('amount') or 0)
                    created_at = log.get('created_at')

                    if "Cleared Past Dues" in reason:
                        continue

                    match = False
                    
                    # ✅ STRICT MODE: Compare Exact Strings
                    if db_label:
                        if db_label == target_label:
                            match = True
                    
                    # Fallback: Text matching (only if DB label is missing)
                    else:
                        if target_label == 'UPCOMING':
                            if "Upcoming" in reason and "Received" in reason: match = True
                        elif target_label in reason: 
                            match = True

                    if match:
                        mode = "Advance Adjustment"
                        type_tag = "PAYMENT"
                        
                        # Extract Real Mode
                        mode_match = re.search(r"\((.*?)\)", reason)
                        if mode_match:
                            extracted = mode_match.group(1).strip()
                            if any(x in extracted.upper() for x in ['CASH', 'UPI', 'CHEQUE', 'ONLINE', 'NET BANKING', 'BANK']):
                                mode = extracted.upper()

                        # Handle Transfers
                        if "Received from" in reason: 
                            mode = "Transfer Received"
                            type_tag = "ADJUSTMENT"
                        elif "transferred to" in reason.lower(): # ✅ Show specific Debt Transfer Out
                            mode = "Debt Transferred Out"
                            type_tag = "ADJUSTMENT"
                        elif "Transfer to" in reason:
                            continue # Hide outgoing advance transfers
                        elif "Debt Rev" in reason:
                            mode = "Deleted Plan Adjustment"
                            type_tag = "ADJUSTMENT"
                            reason = reason.replace(" (Debt Rev)", "") # Hides the tag from UI for cleaner look
                        # ✅ NEW: Handle Refunds back to the Wallet!
                        elif "Refund" in reason:
                            mode = "Moved to Advance"
                            type_tag = "REFUND"
                            amount = -abs(amount) # Make it negative so it subtracts visually in the UI
                            
                        combined_rows.append({
                            "date": created_at,
                            "type": type_tag,
                            "mode": mode,
                            "amount": amount,
                            "details": reason
                        })

            # =========================================================
            # STRATEGY 2: HISTORY ALLOCATIONS
            # =========================================================
            # =========================================================
            # STRATEGY 2: HISTORY ALLOCATIONS (Enhanced with Cheque)
            # =========================================================
            if history_id: 
                try:
                    # ✅ Added 'cheque_number' to the query
                    alloc_res = db_module.supabase.table('payment_allocations').select("amount, payments(date, mode, cheque_number, created_at)").eq("history_id", history_id).execute()
                    allocs = alloc_res.data or []
                    
                    for item in allocs:
                        payment = item.get('payments') or {}
                        pay_mode = (payment.get('mode') or "CASH").upper()
                        cheque = payment.get('cheque_number')
                        amount = float(item.get('amount') or 0)
                        
                        # ✅ Construct Detail String with Cheque support
                        if cheque:
                            det_str = f"Cheque: {cheque} (Late Payment)"
                        else:
                            det_str = f"{pay_mode} (Late Payment)"

                        combined_rows.append({
                            "date": payment.get('created_at') or payment.get('date'), 
                            "type": "PAYMENT", 
                            "mode": pay_mode, 
                            "amount": amount, 
                            "details": det_str
                        })
                except Exception as e: 
                    print(f"Alloc Error: {e}")

            combined_rows.sort(key=lambda x: x['date'] or "", reverse=True)
            return {"ok": True, "data": combined_rows}

        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    # --- HELPER: Get Indian Time ---
    def _get_ist_now(self):
        """Returns current timestamp in Asia/Kolkata timezone."""
        return datetime.datetime.now(pytz.timezone('Asia/Kolkata')).isoformat()

    def _get_ist_today(self):
        """Returns current DATE in Asia/Kolkata timezone."""
        return datetime.datetime.now(pytz.timezone('Asia/Kolkata')).date().isoformat()

    # --- 1. NEW HELPER: ADVANCE LOGGING ---
    def _log_advance(self, sub_id, cust_id, amount, reason, related_id=None, cycle_label=None):
        """
        Logs activity with a STRICT Cycle ID (Timestamp or 'UPCOMING').
        """
        try:
            payload = {
                "subscription_id": sub_id,
                "customer_id": cust_id,
                "user_id": self.active_user_id,
                "amount": amount,
                "reason": reason,
                "created_at": datetime.datetime.now(pytz.timezone('Asia/Kolkata')).isoformat(),
                "related_plan_id": related_id,
                "cycle_label": cycle_label  # ✅ NEW FIELD
            }
            db_module.supabase.table('advance_logs').insert(payload).execute()
        except Exception as e:
            print(f"Log Error: {e}")

    # ---------------------------------------------------------
    # ✅ ADJUST ADVANCE BALANCE (Bulletproofed Deleted Logic)
    # ---------------------------------------------------------
    def adjust_advance_balance(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            sub_id      = payload.get("subscription_id")
            customer_id = payload.get("customer_id")
            strategy    = payload.get("strategy")

            if not sub_id:      return {"ok": False, "error": "System Error: Missing Subscription ID."}
            if not customer_id: return {"ok": False, "error": "System Error: Missing Customer ID."}

            sub_res = db_module.supabase.table('subscriptions').select("*").eq("id", sub_id).single().execute()
            if not sub_res.data: return {"ok": False, "error": "Subscription not found"}

            source_sub  = sub_res.data
            source_name = source_sub.get('plan_name_cached') or "Unknown Plan"
            advance     = float(source_sub.get('advance_balance') or 0)

            if advance <= 0:
                return {"ok": False, "error": "No Advance Balance available."}

            remaining = advance

            # ── Collectors: Python builds, RPC writes atomically ──────────────
            sub_updates  = {}   # {str(plan_id): {sub_id, new_pending?, new_current?, ...}}
            hist_updates = []   # [{id(bigint), new_paid, new_status}]
            advance_logs = []   # [{sub_id, amount, reason, cycle_label, related_plan_id}]

            tz      = pytz.timezone('Asia/Kolkata')
            now_iso = datetime.datetime.now(tz).isoformat()

            # Helper: append to advance_logs list
            def log(sid, amt, reason, cycle_label="", related_plan_id=""):
                advance_logs.append({
                    "sub_id":          str(sid),
                    "amount":          float(amt),
                    "reason":          str(reason),
                    "cycle_label":     str(cycle_label)     if cycle_label     else "",
                    "related_plan_id": str(related_plan_id) if related_plan_id else ""
                })

            # Helper: record a subscription amount update
            def record_sub_update(plan_id, new_p, new_c, new_o, new_u=None):
                key   = str(plan_id)
                entry = sub_updates.setdefault(key, {"sub_id": key})
                if new_p is not None: entry["new_pending"]  = str(new_p)
                if new_c is not None: entry["new_current"]  = str(new_c)
                if new_o is not None: entry["new_other"]    = str(new_o)
                if new_u is not None: entry["new_upcoming"] = str(new_u)

            # Helper: calculate how advance is distributed across pending/current/osc
            # (identical logic to original)
            def calculate_distribution(plan_row, rem_amount, priority_mode):
                p = float(plan_row.get('pending_amount')        or 0)
                c = float(plan_row.get('current_amount')        or 0)
                o = float(plan_row.get('other_service_charges') or 0)

                pay_p, pay_c, pay_o = 0, 0, 0

                if priority_mode == 'osc_first': order = [('o', o), ('p', p), ('c', c)]
                else:                            order = [('p', p), ('c', c), ('o', o)]

                for type_code, amount in order:
                    if rem_amount <= 0: break
                    if amount > 0:
                        deduct      = min(rem_amount, amount)
                        rem_amount -= deduct
                        if   type_code == 'p': pay_p += deduct
                        elif type_code == 'c': pay_c += deduct
                        elif type_code == 'o': pay_o += deduct

                return pay_p, pay_c, pay_o, rem_amount

            # Helper: handle pending-debt history rows for a plan (identical logic)
            def process_pending_hist(plan_id, pay_p, is_source, current_cycle_tag, source_or_plan_name):
                nonlocal remaining
                if pay_p <= 0:
                    return
                hist_res = db_module.supabase.table('subscription_history') \
                    .select("*") \
                    .eq("subscription_id", plan_id) \
                    .neq("status", "cleared") \
                    .order("start_date", desc=False) \
                    .execute()
                temp_p = pay_p
                for h_row in (hist_res.data or []):
                    if temp_p <= 0: break
                    due = float(h_row.get('bill_amount') or 0) - float(h_row.get('paid_amount') or 0)
                    if due > 0:
                        chunk    = min(temp_p, due)
                        temp_p  -= chunk
                        new_paid = float(h_row.get('paid_amount') or 0) + chunk
                        new_stat = 'cleared' if new_paid >= float(h_row.get('bill_amount') or 0) else 'partial'
                        hist_updates.append({
                            "id":         int(h_row['id']),
                            "new_paid":   float(new_paid),
                            "new_status": new_stat
                        })
                        reason = "Adj: Pending" if is_source else f"Received from {source_name} (Pending)"
                        log(plan_id, chunk if is_source else chunk,
                            reason,
                            cycle_label=h_row.get('start_date') or "",
                            related_plan_id="" if is_source else sub_id)

                if temp_p > 0:
                    reason = "Adj: Pending" if is_source else f"Received from {source_name} (Pending)"
                    log(plan_id, temp_p, reason,
                        cycle_label=current_cycle_tag or "",
                        related_plan_id="" if is_source else sub_id)

            # ── PART 1: DELETED PLANS ────────────────────────────────────────
            if str(strategy).startswith('deleted_'):
                target_plans  = []
                priority_mode = 'plan_first'

                if strategy == 'deleted_single_adjust':
                    target_plans = [source_sub]

                elif strategy in ['deleted_multi_priority_osc', 'deleted_multi_priority_plan']:
                    priority_mode = 'osc_first' if 'osc' in strategy else 'plan_first'
                    all_del_res = db_module.supabase.table('subscriptions') \
                        .select("*").eq("customer_id", customer_id) \
                        .eq("status", "deleted") \
                        .order('deleted_at', desc=True).execute()
                    all_deleted  = all_del_res.data or []
                    target_plans = (
                        [p for p in all_deleted if str(p.get('id')) == str(sub_id)] +
                        [p for p in all_deleted if str(p.get('id')) != str(sub_id)]
                    )

                for plan in target_plans:
                    if remaining <= 0: break
                    plan_id           = plan.get('id')
                    is_source         = (str(plan_id) == str(sub_id))
                    current_cycle_tag = plan.get('current_billing_start_date')

                    pay_p, pay_c, pay_o, remaining = calculate_distribution(plan, remaining, priority_mode)
                    total_spent = pay_p + pay_c + pay_o

                    if total_spent > 0:
                        record_sub_update(
                            plan_id,
                            float(plan.get('pending_amount')        or 0) - pay_p,
                            float(plan.get('current_amount')        or 0) - pay_c,
                            float(plan.get('other_service_charges') or 0) - pay_o
                        )

                        if not is_source:
                            log(sub_id, -total_spent,
                                f"Transfer to {plan.get('plan_name_cached')}",
                                cycle_label="TRANSFER_OUT",
                                related_plan_id=plan_id)

                        process_pending_hist(plan_id, pay_p, is_source, current_cycle_tag, source_name)

                        if pay_c > 0:
                            reason = "Adj: Current Plan" if is_source else f"Received from {source_name} (Current)"
                            log(plan_id, pay_c, reason,
                                cycle_label=current_cycle_tag or "",
                                related_plan_id="" if is_source else sub_id)
                        if pay_o > 0:
                            reason = "Adj: Other Charges" if is_source else f"Received from {source_name} (Other Charges)"
                            log(plan_id, pay_o, reason,
                                cycle_label=current_cycle_tag or "",
                                related_plan_id="" if is_source else sub_id)

            # ── PART 2: ACTIVE PLANS ────────────────────────────────────────
            else:
                if strategy == 'single_other':
                    pay_p, pay_c, pay_o, remaining = calculate_distribution(source_sub, remaining, 'plan_first')
                    total_spent       = pay_p + pay_c + pay_o
                    current_cycle_tag = source_sub.get('current_billing_start_date')

                    if total_spent > 0:
                        record_sub_update(
                            sub_id,
                            float(source_sub.get('pending_amount')        or 0) - pay_p,
                            float(source_sub.get('current_amount')        or 0) - pay_c,
                            float(source_sub.get('other_service_charges') or 0) - pay_o
                        )
                        process_pending_hist(sub_id, pay_p, True, current_cycle_tag, source_name)
                        if pay_c > 0: log(sub_id, -pay_c, "Adj: Current Plan", cycle_label=current_cycle_tag or "")
                        if pay_o > 0: log(sub_id, -pay_o, "Adj: Other Charges", cycle_label=current_cycle_tag or "")

                elif strategy == 'single_upcoming':
                    upcoming = float(source_sub.get('upcoming_amount') or 0)
                    if upcoming > 0:
                        deduct     = min(remaining, upcoming)
                        remaining -= deduct
                        record_sub_update(sub_id, None, None, None, new_u=upcoming - deduct)
                        log(sub_id, -deduct, "Adj: Upcoming Plan", cycle_label="UPCOMING")

                elif 'multi' in strategy:
                    is_cable      = True if source_sub.get('cable_plan_id') else False
                    siblings_res  = db_module.supabase.table('subscriptions') \
                        .select("*").eq("customer_id", customer_id) \
                        .neq("status", "deleted").neq("id", sub_id).execute()
                    all_siblings  = siblings_res.data or []
                    same          = [s for s in all_siblings if (True if s.get('cable_plan_id') else False) == is_cable]
                    diff          = [s for s in all_siblings if (True if s.get('cable_plan_id') else False) != is_cable]
                    all_plans     = same + diff
                    priority_other = (strategy == 'multi_partial_other')

                    for plan in all_plans:
                        if remaining <= 0: break
                        calc_mode = 'osc_first' if priority_other else 'plan_first'
                        pay_p, pay_c, pay_o, remaining = calculate_distribution(plan, remaining, calc_mode)
                        total_spent = pay_p + pay_c + pay_o

                        if total_spent > 0:
                            plan_id           = plan.get('id')
                            current_cycle_tag = plan.get('current_billing_start_date')
                            record_sub_update(
                                plan_id,
                                float(plan.get('pending_amount')        or 0) - pay_p,
                                float(plan.get('current_amount')        or 0) - pay_c,
                                float(plan.get('other_service_charges') or 0) - pay_o
                            )
                            log(sub_id, -total_spent,
                                f"Transfer to {plan.get('plan_name_cached')}",
                                cycle_label="TRANSFER_OUT",
                                related_plan_id=plan_id)
                            process_pending_hist(plan_id, pay_p, False, current_cycle_tag, source_name)
                            if pay_c > 0:
                                log(plan_id, pay_c, f"Received from {source_name}",
                                    cycle_label=current_cycle_tag or "", related_plan_id=sub_id)
                            if pay_o > 0:
                                log(plan_id, pay_o, f"Received from {source_name} (Other Charges)",
                                    cycle_label=current_cycle_tag or "", related_plan_id=sub_id)

                    if strategy == 'multi_excess_all' and remaining > 0:
                        for plan in all_plans:
                            if remaining <= 0: break
                            u = float(plan.get('upcoming_amount') or 0)
                            if u > 0:
                                d          = min(remaining, u)
                                remaining -= d
                                record_sub_update(plan.get('id'), None, None, None, new_u=u - d)
                                log(sub_id, -d,
                                    f"Adj Upcoming {plan.get('plan_name_cached')}",
                                    cycle_label="TRANSFER_OUT",
                                    related_plan_id=plan.get('id'))
                                log(plan.get('id'), d,
                                    f"Received from {source_name} (Upcoming)",
                                    cycle_label="UPCOMING",
                                    related_plan_id=sub_id)

            # ── ONE atomic RPC call — ALL writes or NOTHING ──────────────────
            db_module.supabase.rpc("adjust_advance_safe", {
                "p_sub_id":       sub_id,
                "p_user_id":      self.active_user_id,
                "p_customer_id":  customer_id,
                "p_timestamp":    now_iso,
                "p_new_advance":  remaining,
                "p_sub_updates":  list(sub_updates.values()),
                "p_hist_updates": hist_updates,
                "p_advance_logs": advance_logs
            }).execute()

            self.sync_customer_totals({"customer_id": customer_id})
            return {"ok": True}

        except Exception as e:
            return {"ok": False, "error": friendly(e)}
        
    # ---------------------------------------------------------
    # ✅ NEW: TRANSFER ADVANCE (From Deleted Plan to Active Plan)
    # ---------------------------------------------------------
    def transfer_advance_balance(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            source_id = payload.get("source_id")
            target_id = payload.get("target_id")
            customer_id = payload.get("customer_id")

            if not source_id or not target_id:
                return {"ok": False, "error": "Missing Source or Target Plan ID"}

            # Fetch both plans safely
            source_res = db_module.supabase.table('subscriptions').select("*").eq("id", source_id).single().execute()
            target_res = db_module.supabase.table('subscriptions').select("*").eq("id", target_id).single().execute()

            if not source_res.data or not target_res.data:
                return {"ok": False, "error": "Plan not found"}

            source = source_res.data
            target = target_res.data

            # Check Advance
            adv_to_transfer = float(source.get("advance_balance") or 0)
            
            if adv_to_transfer <= 0:
                return {"ok": False, "error": "No advance balance available to transfer."}

            # ✅ PHASE 1 FIX: All 4 writes now atomic via RPC
            # If any step fails, ALL are rolled back automatically
            tz = pytz.timezone('Asia/Kolkata')
            now_iso = datetime.datetime.now(tz).isoformat()

            db_module.supabase.rpc('transfer_advance_safe', {
                'p_source_id':   source_id,
                'p_target_id':   target_id,
                'p_customer_id': customer_id,
                'p_user_id':     self.active_user_id,
                'p_amount':      adv_to_transfer,
                'p_source_name': source.get('plan_name_cached') or 'Deleted Plan',
                'p_target_name': target.get('plan_name_cached') or 'Active Plan',
                'p_timestamp':   now_iso
            }).execute()

            self.sync_customer_totals({"customer_id": customer_id})
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}
        
    # ---------------------------------------------------------
    # ✅ NEW: TRANSFER DEBT (From Deleted Plan to Active Plan OSC)
    # ---------------------------------------------------------
    def transfer_debt_to_active_plan(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            source_id = payload.get("source_id")
            target_id = payload.get("target_id")
            customer_id = payload.get("customer_id")

            if not source_id or not target_id:
                return {"ok": False, "error": "Missing Source or Target Plan ID"}

            # Fetch both plans
            source_res = db_module.supabase.table('subscriptions').select("*").eq("id", source_id).single().execute()
            target_res = db_module.supabase.table('subscriptions').select("*").eq("id", target_id).single().execute()

            if not source_res.data or not target_res.data:
                return {"ok": False, "error": "Plan not found"}

            source = source_res.data
            target = target_res.data
            
            target_name = target.get('plan_name_cached') or "Active Plan"
            source_name = source.get('plan_name_cached') or "Deleted Plan"

            # 1. Calculate Source Debt
            s_pend = float(source.get("pending_amount") or 0)
            s_curr = float(source.get("current_amount") or 0)
            s_osc = float(source.get("other_service_charges") or 0)
            
            plan_debt_total = s_pend + s_curr
            total_debt = plan_debt_total + s_osc
            
            if total_debt <= 0:
                return {"ok": False, "error": "No pending debt available to transfer."}

            # ✅ PHASE 1 FIX: Core financial writes now atomic via RPC
            # Source cleared + target OSC updated + all logs — all in one transaction
            tz = pytz.timezone('Asia/Kolkata')
            now_iso = datetime.datetime.now(tz).isoformat()
            c_start = source.get('current_billing_start_date') or ''

            db_module.supabase.rpc('transfer_debt_safe', {
                'p_source_id':          source_id,
                'p_target_id':          target_id,
                'p_customer_id':        customer_id,
                'p_user_id':            self.active_user_id,
                'p_total_debt':         total_debt,
                'p_s_curr':             s_curr,
                'p_s_osc':              s_osc,
                'p_source_name':        source_name,
                'p_target_name':        target_name,
                'p_source_cycle_start': c_start,
                'p_target_cycle_start': target.get('current_billing_start_date') or '',
                'p_timestamp':          now_iso
            }).execute()

            self.sync_customer_totals({"customer_id": customer_id})
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    def process_payment(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            sub_id      = payload.get("subscription_id")
            user_id     = self.active_user_id
            customer_id = payload.get("customer_id")

            amount_paid  = float(payload.get("amount") or 0)
            mode         = payload.get("mode")
            priority_osc = payload.get("pay_other_first")

            clear_upcoming_too = str(payload.get("clear_upcoming_too", "")).lower() == "true"
            force_cross_plan   = str(payload.get("force_cross_plan",   "")).lower() == "true"

            excess_strat = str(payload.get("excess_strategy", "")).lower()
            if "upcoming" in excess_strat:
                clear_upcoming_too = True
            elif "cross" in excess_strat or "other" in excess_strat:
                force_cross_plan = True

            cheque_number_val = payload.get("cheque_number") if mode == "cheque" else None

            if mode == "bank":
                mode = "Net Banking"

            mode_label = f"({mode.upper()})"
            if mode == "cheque":        mode_label = f"(CHEQUE: {cheque_number_val})"
            elif mode == "upi":         mode_label = "(UPI)"
            elif mode == "online":      mode_label = "(ONLINE)"
            elif mode == "Net Banking": mode_label = "(NET BANKING)"

            tz = pytz.timezone("Asia/Kolkata")
            current_iso_timestamp = datetime.datetime.now(tz).isoformat()

            # ── Fetch and validate subscription ──────────────────────────────
            sub_res = db_module.supabase.table("subscriptions")\
                .select("*").eq("id", sub_id).eq("user_id", user_id).single().execute()
            if not sub_res.data:
                return {"ok": False, "error": "Subscription not found"}

            sub = sub_res.data

            if sub.get("status") == "deleted":
                return {"ok": False, "error": "This plan has been removed. Please refresh the page."}

            # ── All calculations — identical to original ──────────────────────
            remaining         = amount_paid
            sender_name       = sub.get("plan_name_cached") or "Current Plan"
            current_cycle_tag = sub.get("current_billing_start_date")

            pending  = float(sub.get("pending_amount")        or 0)
            current  = float(sub.get("current_amount")        or 0)
            other    = float(sub.get("other_service_charges") or 0)
            upcoming = float(sub.get("upcoming_amount")       or 0)
            advance  = float(sub.get("advance_balance")       or 0)

            paid_osc_now  = 0
            paid_plan_now = 0

            # ── Collectors: Python builds these, RPC writes them atomically ──
            history_updates = []  # [{id, new_paid, new_status}]
            payment_allocs  = []  # [{history_id, amount}]
            advance_logs    = []  # [{sub_id, amount, reason, cycle_label, related_plan_id}]
            sibling_map     = {}  # {sib_id_str: {sub_id, new_pending?, new_current?, ...}}

            # Helper: appends to advance_logs list
            def log(sid, amt, reason, cycle_label="", related_plan_id=""):
                advance_logs.append({
                    "sub_id":          str(sid),
                    "amount":          float(amt),
                    "reason":          str(reason),
                    "cycle_label":     str(cycle_label)     if cycle_label     else "",
                    "related_plan_id": str(related_plan_id) if related_plan_id else ""
                })

            # ── OSC priority (identical to original) ─────────────────────────
            if priority_osc and remaining > 0 and other > 0:
                deduct        = min(remaining, other)
                other        -= deduct
                remaining    -= deduct
                paid_osc_now += deduct

            # ── Clear past history rows (identical to original) ───────────────
            hist_rows = db_module.supabase.table("subscription_history")\
                .select("*").eq("subscription_id", sub_id)\
                .neq("status", "cleared")\
                .order("start_date", desc=False).execute().data or []

            for h in hist_rows:
                if remaining <= 0:
                    break
                due = float(h.get("bill_amount") or 0) - float(h.get("paid_amount") or 0)
                if due > 0:
                    pay_now    = min(remaining, due)
                    remaining -= pay_now
                    new_paid   = float(h.get("paid_amount") or 0) + pay_now
                    new_status = "cleared" if new_paid >= float(h.get("bill_amount") or 0) else "partial"

                    history_updates.append({
                        "id":         int(h["id"]),
                        "new_paid":   float(new_paid),
                        "new_status": new_status
                    })
                    payment_allocs.append({
                        "history_id": int(h["id"]),
                        "amount":     float(pay_now)
                    })
                    log(sub_id, -pay_now,
                        f"Cleared Past Dues: {h.get('start_date')} {mode_label}")

                    if pending > 0:
                        pending = max(0, pending - pay_now)

            # ── Apply to current plan amounts (identical to original) ─────────
            if priority_osc:
                if remaining > 0 and pending > 0:
                    d = min(remaining, pending); pending -= d; remaining -= d; paid_plan_now += d
                if remaining > 0 and current > 0:
                    d = min(remaining, current); current -= d; remaining -= d; paid_plan_now += d
            else:
                if remaining > 0 and pending > 0:
                    d = min(remaining, pending); pending -= d; remaining -= d; paid_plan_now += d
                if remaining > 0 and current > 0:
                    d = min(remaining, current); current -= d; remaining -= d; paid_plan_now += d
                if remaining > 0 and other > 0:
                    d = min(remaining, other);   other   -= d; remaining -= d; paid_osc_now  += d

            if current_cycle_tag:
                if paid_plan_now > 0:
                    log(sub_id, -paid_plan_now,
                        f"Payment for Cycle: {current_cycle_tag} {mode_label}",
                        cycle_label=current_cycle_tag)
                if paid_osc_now > 0:
                    log(sub_id, -paid_osc_now,
                        f"Payment for Cycle: {current_cycle_tag} {mode_label} - Other Charges",
                        cycle_label=current_cycle_tag)

            # ── Cross-plan logic (identical to original) ──────────────────────
            if force_cross_plan and remaining > 0:
                is_cable = True if sub.get("cable_plan_id") else False

                siblings_res = db_module.supabase.table("subscriptions")\
                    .select("*").eq("customer_id", customer_id)\
                    .eq("user_id", user_id)\
                    .neq("status", "deleted").neq("id", sub_id).execute()
                all_siblings     = siblings_res.data or []
                same             = [s for s in all_siblings
                                    if (True if s.get("cable_plan_id") else False) == is_cable]
                diff             = [s for s in all_siblings
                                    if (True if s.get("cable_plan_id") else False) != is_cable]
                ordered_siblings = same + diff

                for sib in ordered_siblings:
                    if remaining <= 0:
                        break
                    s_pend  = float(sib.get("pending_amount")        or 0)
                    s_curr  = float(sib.get("current_amount")        or 0)
                    s_other = float(sib.get("other_service_charges") or 0)
                    sib_id  = sib["id"]

                    pay_p, pay_c, pay_o = 0, 0, 0

                    order_seq = ([("o", s_other), ("p", s_pend), ("c", s_curr)]
                                 if priority_osc
                                 else [("p", s_pend), ("c", s_curr), ("o", s_other)])

                    for code, amt in order_seq:
                        if remaining <= 0:
                            break
                        if amt > 0:
                            d = min(remaining, amt)
                            remaining -= d
                            if   code == "p": pay_p += d
                            elif code == "c": pay_c += d
                            elif code == "o": pay_o += d

                    total = pay_p + pay_c + pay_o
                    if total > 0:
                        sib_key = str(sib_id)
                        entry = sibling_map.setdefault(sib_key, {"sub_id": sib_key})
                        entry["new_pending"] = str(s_pend  - pay_p)
                        entry["new_current"] = str(s_curr  - pay_c)
                        entry["new_other"]   = str(s_other - pay_o)

                        log(sub_id, -total,
                            f"Transfer to {sib.get('plan_name_cached')}",
                            cycle_label="TRANSFER_OUT",
                            related_plan_id=sib_id)

                        if pay_p > 0:
                            sib_hist = db_module.supabase.table("subscription_history")\
                                .select("*").eq("subscription_id", sib_id)\
                                .neq("status", "cleared")\
                                .order("start_date", desc=False).execute().data or []
                            temp_p = pay_p
                            for h_row in sib_hist:
                                if temp_p <= 0:
                                    break
                                due = float(h_row.get("bill_amount") or 0) - float(h_row.get("paid_amount") or 0)
                                if due > 0:
                                    pay      = min(temp_p, due)
                                    temp_p  -= pay
                                    new_paid = float(h_row.get("paid_amount") or 0) + pay
                                    new_stat = "cleared" if new_paid >= float(h_row.get("bill_amount") or 0) else "partial"
                                    history_updates.append({
                                        "id":         int(h_row["id"]),
                                        "new_paid":   float(new_paid),
                                        "new_status": new_stat
                                    })
                                    
                                    log(sib_id, pay,
                                        f"Received from {sender_name} {mode_label} (Pending)",
                                        cycle_label=h_row.get("start_date") or "",
                                        related_plan_id=sub_id)
                            if temp_p > 0:
                                log(sib_id, temp_p,
                                    f"Received from {sender_name} {mode_label} (Pending)",
                                    cycle_label=sib.get("current_billing_start_date") or "",
                                    related_plan_id=sub_id)

                        if pay_c > 0:
                            log(sib_id, pay_c,
                                f"Received from {sender_name} {mode_label}",
                                cycle_label=sib.get("current_billing_start_date") or "",
                                related_plan_id=sub_id)
                        if pay_o > 0:
                            log(sib_id, pay_o,
                                f"Received from {sender_name} {mode_label} (Other Charges)",
                                cycle_label=sib.get("current_billing_start_date") or "",
                                related_plan_id=sub_id)

                # ── Clear upcoming for all plans (cross-plan mode) ────────────
                if clear_upcoming_too and remaining > 0:
                    if upcoming > 0:
                        d = min(remaining, upcoming)
                        upcoming  -= d
                        remaining -= d
                        log(sub_id, -d, "Adj: Upcoming", cycle_label="UPCOMING")

                    for sib in ordered_siblings:
                        if remaining <= 0:
                            break
                        su     = float(sib.get("upcoming_amount") or 0)
                        sib_id = sib["id"]
                        if su > 0:
                            d = min(remaining, su)
                            remaining -= d
                            sib_key = str(sib_id)
                            entry = sibling_map.setdefault(sib_key, {"sub_id": sib_key})
                            entry["new_upcoming"] = str(su - d)
                            log(sub_id, -d,
                                f"Adj Upcoming {sib.get('plan_name_cached')}",
                                cycle_label="TRANSFER_OUT",
                                related_plan_id=sib_id)
                            log(sib_id, d,
                                f"Received from {sender_name} (Upcoming)",
                                cycle_label="UPCOMING",
                                related_plan_id=sub_id)

            else:
                # ── No cross-plan: only clear self upcoming ───────────────────
                if clear_upcoming_too and remaining > 0 and upcoming > 0:
                    d = min(remaining, upcoming)
                    upcoming  -= d
                    remaining -= d
                    log(sub_id, -d, "Adj: Upcoming", cycle_label="UPCOMING")

            # ── Excess goes to advance ────────────────────────────────────────
            if remaining > 0:
                advance += remaining
                log(sub_id, remaining, "Payment Excess")

            # ── ONE atomic RPC call — ALL writes or NOTHING ───────────────────
            # If anything fails, PostgreSQL rolls back every write automatically.
            # No ghost payment. No orphaned logs. No partial subscription update.
            db_module.supabase.rpc("process_payment_safe", {
                "p_sub_id":           sub_id,
                "p_user_id":          self.active_user_id,  # always use server-side id
                "p_customer_id":      customer_id,
                "p_amount":           amount_paid,
                "p_mode":             mode,
                "p_cheque_number":    cheque_number_val,
                "p_timestamp":        current_iso_timestamp,

                "p_new_pending":      pending,
                "p_new_current":      current,
                "p_new_other":        other,
                "p_new_upcoming":     upcoming,
                "p_new_advance":      advance,

                "p_history_updates":  history_updates,
                "p_payment_allocs":   payment_allocs,
                "p_advance_logs":     advance_logs,
                "p_sibling_updates":  list(sibling_map.values())
            }).execute()

            self.sync_customer_totals({"customer_id": customer_id})
            return {"ok": True}

        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    # --- ✅ NEW: Update OSC (Add/Sub) ---
    def update_subscription_osc(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            user_id = self.active_user_id
            sub_id = payload.get('subscription_id')
            customer_id = payload.get('customer_id')
            amount = float(payload.get('amount') or 0)
            operation = payload.get('operation') # 'add' or 'sub'

            # 1. Fetch Current
            sub_res = db_module.supabase.table('subscriptions').select('other_service_charges').eq('id', sub_id).eq('user_id', user_id).single().execute()
            if not sub_res.data:
                return {"ok": False, "error": "Subscription not found"}
            
            current_osc = float(sub_res.data.get('other_service_charges') or 0)
            
            # 2. Calculate New
            if operation == 'add':
                new_osc = current_osc + amount
            elif operation == 'sub':
                new_osc = max(0, current_osc - amount)
            else:
                return {"ok": False, "error": "Invalid operation"}

            # 3. Update DB
            db_module.supabase.table('subscriptions').update({'other_service_charges': new_osc}).eq('id', sub_id).eq('user_id', user_id).execute()

            self.sync_customer_totals({"customer_id": customer_id})
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    # ---------------------------------------------------------
    # 1. REMOVE SUBSCRIPTION (Soft Delete Logic)
    # ---------------------------------------------------------
    def remove_subscription(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            user_id = self.active_user_id
            tz      = pytz.timezone('Asia/Kolkata')
            now_iso = datetime.datetime.now(tz).isoformat()

            sub_id = payload.get("subscription_id")

            # ── Fetch subscription ────────────────────────────────────────────
            sub_res = db_module.supabase.table('subscriptions')\
                .select("*").eq("id", sub_id).eq("user_id", user_id).single().execute()
            if not sub_res.data:
                return {"ok": False, "error": "Subscription not found"}

            sub = sub_res.data

            # ── Calculate how much was pre-paid toward upcoming (identical to original) ──
            base_price = float(sub.get('upcoming_plan_price') or sub.get('price') or 0)
            u_add      = float(sub.get('upcoming_additional_charge') or 0)
            u_disc     = float(sub.get('upcoming_discount_amount')   or 0)

            expected_upcoming_bill = (base_price + u_add) - u_disc
            if expected_upcoming_bill < 0:
                expected_upcoming_bill = 0

            current_upcoming_debt = float(sub.get('upcoming_amount') or 0)

            paid_upcoming = expected_upcoming_bill - current_upcoming_debt
            if paid_upcoming < 0:
                paid_upcoming = 0

            current_advance  = float(sub.get('advance_balance') or 0)
            new_advance      = current_advance + paid_upcoming  # same if paid_upcoming=0

            # ── ONE atomic RPC call — log + soft-delete together or nothing ──
            db_module.supabase.rpc("remove_subscription_safe", {
                "p_sub_id":        sub_id,
                "p_user_id":       self.active_user_id,
                "p_customer_id":   sub.get('customer_id'),
                "p_now_iso":       now_iso,
                "p_paid_upcoming": paid_upcoming,
                "p_new_advance":   new_advance
            }).execute()

            self.sync_customer_totals({"customer_id": sub.get('customer_id')})
            return {"ok": True}

        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    # ---------------------------------------------------------
    # 2. GET DELETED PLANS (Fetch from Main Table)
    # ---------------------------------------------------------
    def get_deleted_plans(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            cust_id = payload.get('customer_id')
            
            # Query 1 — fetch all deleted plans for this customer
            res = db_module.supabase.table('subscriptions')\
                .select("*")\
                .eq("customer_id", cust_id)\
                .eq("status", "deleted")\
                .order('deleted_at', desc=True)\
                .execute()
            
            deleted_plans = res.data or []
            if not deleted_plans:
                return {"ok": True, "data": []}

            # Query 2 — fetch ALL history for ALL deleted plans in ONE query
            plan_ids = [plan['id'] for plan in deleted_plans]
            h_res = db_module.supabase.table('subscription_history')\
                .select("*")\
                .in_("subscription_id", plan_ids)\
                .order('start_date', desc=True)\
                .execute()
            all_history = h_res.data or []

            # Group history by subscription_id in Python (no more DB queries)
            history_map = {}
            for h in all_history:
                sid = h['subscription_id']
                if sid not in history_map:
                    history_map[sid] = []
                history_map[sid].append(h)

            # Attach history to each plan
            for plan in deleted_plans:
                if not plan.get('backup_data'):
                    plan['backup_data'] = {}
                plan['backup_data']['history'] = history_map.get(plan['id'], [])
                plan['plan_name'] = plan.get('plan_name_cached')

            return {"ok": True, "data": deleted_plans}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    # ---------------------------------------------------------
    # 3. GET DELETED PLAN DETAILS (Fetch from Main Tables)
    # ---------------------------------------------------------
    def get_deleted_plan_details(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            did = payload.get("id")
            
            # Fetch from LIVE tables (since we only soft deleted)
            plan_res = db_module.supabase.table('subscriptions').select("*").eq("id", did).single().execute()
            if not plan_res.data: return {"ok": False, "error": "Plan not found"}
            
            hist_res = db_module.supabase.table('subscription_history')\
                .select("*")\
                .eq("subscription_id", did)\
                .order('start_date', desc=True)\
                .execute()
            
            plan_data = plan_res.data
            plan_data['plan_name'] = plan_data.get('plan_name_cached')
            
            # We explicitly attach history here
            plan_data['history'] = hist_res.data or []
            
            return {"ok": True, "data": plan_data}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    # ---------------------------------------------------------
    # ✅ 4. GET ARCHIVED PAYMENT RECORDS (FIXED: Valid Columns Only)
    # ---------------------------------------------------------
    def get_archived_payment_records(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            h_id = payload.get("history_id")
            
            if not h_id: return {"ok": False, "error": "No ID provided"}

            # ✅ FIX: Removed 'details' (doesn't exist). Added 'cheque_number'.
            res = db_module.supabase.table('payment_allocations')\
                .select("amount, payments(date, mode, cheque_number)")\
                .eq("history_id", h_id)\
                .execute()
            
            # Format results for the frontend
            results = []
            for row in (res.data or []):
                pay = row.get('payments') or {}
                
                # Construct "Details" manually since the column is missing
                mode = str(pay.get('mode') or "Unknown").upper()
                cheque = pay.get('cheque_number')
                
                # If cheque exists, show it. Otherwise generic message.
                display_details = f"Cheque: {cheque}" if cheque else "Payment Received"

                results.append({
                    "payment_date": pay.get('date'),
                    "mode": mode,
                    "details": display_details, # ✅ Frontend gets the text it expects
                    "amount": row.get('amount'),
                    "type": "PAYMENT"
                })
                
            return {"ok": True, "data": results}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}
    
    
    def get_available_plans(self, payload):
        """Fetch plans of a specific type (cable/internet) for the dropdown."""
        auth_err = self._require_auth()
        if auth_err: return auth_err
        user_id = self.active_user_id
        plan_type = payload.get("type") # 'cable' or 'internet'
        
        table = "cable_plans" if plan_type == "cable" else "internet_plans"
        
        try:
            # Fetch all plans created by this admin
            res = db_module.supabase.table(table).select("*").eq("user_id", user_id).execute()
            return {"ok": True, "data": res.data}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    # 2. Update: Use Actual Duration when adding new plan
    def add_subscription_to_customer(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            user_id = self.active_user_id
            cust_id = payload.get("customer_id")
            plan_id = payload.get("plan_id")
            plan_type = payload.get("type")
            plan_name = payload.get("plan_name")
            
            # --- 1. GET THE FINANCIALS (Updated) ---
            price = float(payload.get("price") or 0)
            # Fetch the new values sent from frontend
            additional = float(payload.get("additional_charge") or 0)
            discount = float(payload.get("discount_amount") or 0)

            # --- 2. CALCULATE NET AMOUNT ---
            # Formula: (Plan Price + Additional) - Discount
            final_amount = (price + additional) - discount
            if final_amount < 0: final_amount = 0

            # --- 3. Fetch Duration & Speed from Master Table ---
            duration_days = 30
            speed_val = None 

            if plan_type == 'cable':
                p_res = db_module.supabase.table('cable_plans').select('duration').eq('id', plan_id).single().execute()
                if p_res.data and p_res.data.get('duration'):
                    duration_days = int(p_res.data['duration'])
            else:
                p_res = db_module.supabase.table('internet_plans').select('duration, speed_mbps').eq('id', plan_id).single().execute()
                if p_res.data:
                    if p_res.data.get('duration'): duration_days = int(p_res.data['duration'])
                    if p_res.data.get('speed_mbps'): speed_val = str(p_res.data.get('speed_mbps')) + " Mbps"

            tz = pytz.timezone('Asia/Kolkata')
            today = datetime.datetime.now(tz).date()
            end_date = today + datetime.timedelta(days=duration_days)
            
            # ✅ FIX: Generate Exact Timestamp for the Cycle ID
            now_iso = self._get_ist_now() 

            row = {
                "user_id": user_id,
                "customer_id": cust_id,
                "plan_name_cached": plan_name,
                "price": price,
                "duration": duration_days,
                "status": "active",
                "activation_date": str(today), # This can stay as Date (Visual)
                
                # ✅ CRITICAL FIX: Use TIMESTAMP here (was str(today))
                "current_billing_start_date": now_iso, 
                
                "current_billing_end_date": end_date.strftime("%Y-%m-%d"),
                "current_amount": final_amount,
                "upcoming_amount": final_amount,
                "additional_charge": additional,
                "upcoming_additional_charge": additional,
                "upcoming_discount_amount": discount,
                "discount_amount": discount,
                
                "pending_amount": 0,
                "created_at": now_iso 
            }

            if plan_type == 'cable':
                row['cable_plan_id'] = plan_id
            else:
                row['internet_plan_id'] = plan_id
                row['plan_mbps'] = speed_val 

            res = db_module.supabase.table('subscriptions').insert(row).execute()
            if res.data:
                # ✅ Sync customer totals after adding new subscription
                self.sync_customer_totals({"customer_id": cust_id})
                return {"ok": True}
            return {"ok": False, "error": "Failed to insert"}

        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    def update_customer_info(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            user_id = self.active_user_id
            cust_id = payload.get("customer_id")
            sub_id = payload.get("subscription_id")
            
            profile_data = payload.get("profile")
            sub_data = payload.get("subscription")

            if profile_data:
                db_module.supabase.table('customers').update({
                    "name": profile_data.get("name"),
                    "phone": profile_data.get("phone"),
                    "alt_phone": profile_data.get("alt_phone"),
                    "email": profile_data.get("email"),
                    "aadhaar_number": profile_data.get("aadhaar"),
                    "short_address": profile_data.get("short_address"),
                    "long_address": profile_data.get("long_address"),
                    "notes": profile_data.get("notes")
                    # ✅ REMOVED: JS-calculated totals no longer saved here
                    # sync_customer_totals() below handles this correctly
                }).eq("id", cust_id).eq("user_id", user_id).execute()

            if sub_id and sub_data:
                update_payload = {
                    "upcoming_additional_charge": sub_data.get("additional_charge"),
                    "upcoming_discount_amount": sub_data.get("discount_amount")
                }

                # ✅ FETCH ALL NEEDED COLUMNS to calculate what was already paid
                sub_res = db_module.supabase.table('subscriptions') \
                    .select("upcoming_plan_price, price, upcoming_amount, upcoming_additional_charge, upcoming_discount_amount, advance_balance, customer_id") \
                    .eq("id", sub_id).eq("user_id", user_id).single().execute()
                
                if sub_res.data:
                    db_sub = sub_res.data
                    base = float(db_sub.get('upcoming_plan_price') or db_sub.get('price') or 0)
                    
                    # 1. Figure out exactly how much they ALREADY paid
                    old_add = float(db_sub.get('upcoming_additional_charge') or 0)
                    old_disc = float(db_sub.get('upcoming_discount_amount') or 0)
                    old_total = (base + old_add) - old_disc
                    if old_total < 0: old_total = 0
                    
                    current_debt = float(db_sub.get('upcoming_amount') or 0)
                    paid_so_far = old_total - current_debt
                    if paid_so_far < 0: paid_so_far = 0

                    # 2. Calculate the NEW total based on their edits
                    new_add = float(sub_data.get("additional_charge") or 0)
                    new_disc = float(sub_data.get("discount_amount") or 0)
                    new_total = (base + new_add) - new_disc
                    if new_total < 0: new_total = 0
                    
                    # 3. Subtract what they already paid from the new total
                    new_upcoming_debt = new_total - paid_so_far
                    
                    # ✅ SAFETY REFUND LOGIC: If the edit made the plan cheaper than what they already paid!
                    if new_upcoming_debt < 0:
                        refund_amount = abs(new_upcoming_debt)
                        new_upcoming_debt = 0
                        
                        # Move the extra money to their advance balance
                        current_adv = float(db_sub.get("advance_balance") or 0)
                        update_payload["advance_balance"] = current_adv + refund_amount
                        self._log_advance(sub_id, db_sub['customer_id'], refund_amount, "Refund from Edit Upcoming Plan", cycle_label="UPCOMING")
                    
                    update_payload["upcoming_amount"] = new_upcoming_debt

                if sub_data.get("plan_mbps") is not None:
                    update_payload["plan_mbps"] = sub_data.get("plan_mbps")
                
                if sub_data.get("setup_box_id") is not None:
                    update_payload["setup_box_id"] = sub_data.get("setup_box_id")

                db_module.supabase.table('subscriptions').update(update_payload).eq("id", sub_id).eq("user_id", user_id).execute()

            # ✅ Always recalculate totals from DB after any save
            self.sync_customer_totals({"customer_id": cust_id})

            return {"ok": True, "message": "Saved Successfully"}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    def sync_customer_totals(self, payload):
        """Calculates totals directly from database — never trusts frontend values."""
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            customer_id = payload.get("customer_id")

            # Calculate directly from subscriptions table
            subs_res = db_module.supabase.table('subscriptions') \
                .select("cable_plan_id, internet_plan_id, pending_amount, current_amount, other_service_charges") \
                .eq("customer_id", customer_id) \
                .neq("status", "deleted") \
                .execute()

            cable_pending = 0
            net_pending = 0
            total_pending = 0

            for sub in (subs_res.data or []):
                due = (
                    float(sub.get("pending_amount") or 0) +
                    float(sub.get("current_amount") or 0) +
                    float(sub.get("other_service_charges") or 0)
                )
                total_pending += due
                if sub.get("cable_plan_id"):
                    cable_pending += due
                if sub.get("internet_plan_id"):
                    net_pending += due

            # Save Python-calculated totals
            db_module.supabase.table('customers').update({
                "cable_pending_amount": cable_pending,
                "net_pending_amount": net_pending,
                "total_pending_all_current": total_pending
            }).eq("id", customer_id).execute()

            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}
    
    # 1. Update: Check for Expiry every time details are fetched
    def get_customer_details(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        
        # ✅ SAFE REPLACEMENT: We use the backend's verified ID instead of the frontend's
        safe_user_id = self.active_user_id 
        customer_id = payload.get("customer_id")

        try:
            # 1. FETCH CUSTOMER PROFILE (With the security lock added)
            cust_res = db_module.supabase.table('customers') \
                .select("*") \
                .eq("id", customer_id) \
                .eq("user_id", safe_user_id) \
                .single() \
                .execute()

            if not cust_res.data:
                return {"ok": False, "error": "Customer not found"}

            # 2. FETCH SUBSCRIPTIONS (With the security lock added)
            sub_res = db_module.supabase.table('subscriptions') \
                .select("*, internet_plans(speed_mbps), cable_plans(num_channels)") \
                .eq("customer_id", customer_id) \
                .eq("user_id", safe_user_id) \
                .neq("status", "deleted") \
                .order('created_at', desc=False) \
                .order('plan_name_cached', desc=False) \
                .execute()

            return {"ok": True, "data": {"profile": cust_res.data, "subscriptions": sub_res.data}}

        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    # ---------------------------------------------------------
    # ✅ 3. TOGGLE STATUS (Updated: Fixes Stop Date & Start Status)
    # ---------------------------------------------------------
    def toggle_subscription_status(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            user_id = self.active_user_id
            tz = pytz.timezone('Asia/Kolkata')
            now_iso  = datetime.datetime.now(tz).isoformat()
            today_iso = datetime.datetime.now(tz).date().isoformat()

            sub_id = payload.get("subscription_id")
            action = payload.get("action")
            pay_upcoming_with_advance = payload.get("pay_upcoming_with_advance", False)

            # ── FETCH subscription ────────────────────────────────────────
            sub_data = db_module.supabase.table('subscriptions')\
                .select("*").eq("id", sub_id).eq("user_id", user_id).single().execute()
            if not sub_data.data:
                return {"ok": False, "error": "Subscription not found"}

            sub = sub_data.data

            # ── STOP: only 1 write, no RPC needed ────────────────────────
            if action == 'stop':
                db_module.supabase.table('subscriptions').update({
                    "status": "inactive",
                    "current_billing_end_date": now_iso
                }).eq("id", sub_id).eq("user_id", user_id).execute()

                self.sync_customer_totals({"customer_id": sub.get('customer_id')})
                return {"ok": True}

            # ── START: all writes go into one atomic RPC ──────────────────
            elif action == 'start':

                # --- STEP A: Calculate old cycle history snapshot ---
                # (identical logic to original)
                old_start = sub.get('current_billing_start_date')
                if not old_start:
                    old_start = sub.get('activation_date') or sub.get('created_at') or today_iso

                old_price = float(sub.get('price') or 0)
                old_add   = float(sub.get('additional_charge') or 0)
                old_disc  = float(sub.get('discount_amount') or 0)
                old_other = float(sub.get('other_service_charges') or 0)

                old_bill_total = (old_price + old_add) - old_disc
                if old_bill_total < 0: old_bill_total = 0

                remaining_debt = float(sub.get('current_amount') or 0)
                paid_so_far    = old_bill_total - remaining_debt
                if paid_so_far < 0: paid_so_far = 0

                hist_status = 'unpaid'
                if paid_so_far >= old_bill_total: 
                    hist_status = 'cleared'
                elif paid_so_far > 0: 
                    hist_status = 'partial'

                # --- STEP B: Calculate osc_paid_amount for history row ---
                # (identical logic to original)
                cycle_id = str(old_start).strip()
                all_logs = db_module.supabase.table('advance_logs')\
                    .select("*").eq("subscription_id", sub_id).execute().data or []

                final_osc_paid = 0
                for log in all_logs:
                    lbl = str(log.get('cycle_label') or '').strip()
                    rsn = str(log.get('reason') or '')
                    is_this_cycle = (lbl == cycle_id) or (cycle_id in rsn)
                    is_osc = "other charges" in rsn.lower()
                    if is_this_cycle and is_osc:
                        final_osc_paid += abs(float(log.get('amount') or 0))

                # --- STEP C: Find advance_log IDs to retag UPCOMING → PRE-PAID ---
                # (identical logic to original)
                pay_ids_to_update = []
                refund_ids_to_update = []
                
                for log in all_logs:
                    lbl = log.get('cycle_label')
                    rsn = log.get('reason') or ""
                    
                    is_target = False
                    if lbl == 'UPCOMING':
                        is_target = True
                    elif not lbl and ("Upcoming" in rsn or "Adj Upcoming" in rsn):
                        is_target = True
                        
                    if is_target:
                        if "Refund" in rsn:
                            refund_ids_to_update.append(log['id']) # Separate the refunds!
                        else:
                            pay_ids_to_update.append(log['id'])    # Standard payments

                # --- STEP D: Calculate new cycle amounts ---
                # (identical logic to original)
                new_current_bill = float(sub.get('upcoming_amount') or 0)
                new_add = float(sub.get('upcoming_additional_charge') or 0)
                new_disc = float(sub.get('upcoming_discount_amount') or 0)
                base_price = float(sub.get('upcoming_plan_price') or sub.get('price') or 0)

                next_cycle_upcoming_bill = (base_price + new_add) - new_disc
                if next_cycle_upcoming_bill < 0: next_cycle_upcoming_bill = 0

                advance = float(sub.get('advance_balance') or 0)
                current_debt = new_current_bill
                upcoming_debt = next_cycle_upcoming_bill

                # Build advance log entries to insert (0, 1, or 2)
                advance_logs_to_insert = []

                if advance > 0 and current_debt > 0:
                    deduct = min(advance, current_debt)
                    current_debt -= deduct
                    advance -= deduct
                    advance_logs_to_insert.append({
                        "amount": -deduct,
                        "reason": f"Payment for Cycle: {now_iso} (ADVANCE)",
                        "cycle_label": now_iso
                    })

                if pay_upcoming_with_advance and advance > 0 and upcoming_debt > 0:
                    deduct = min(advance, upcoming_debt)
                    upcoming_debt -= deduct
                    advance -= deduct
                    advance_logs_to_insert.append({
                        "amount": -deduct,
                        "reason": "Adj: Upcoming (Start Plan)",
                        "cycle_label": "UPCOMING"
                    })

                # New billing end date (identical to original)
                new_billing_end = str(
                    datetime.datetime.now(tz).date() +
                    datetime.timedelta(days=int(sub.get('duration') or 30))
                )

                # Pre-computed pending total (identical to original)
                current_pending  = float(sub.get('pending_amount') or 0)
                new_pending_total = current_pending + remaining_debt

                # ── STEP E: One atomic RPC call — ALL 5 writes or NOTHING ──
                db_module.supabase.rpc("start_subscription_cycle", {
                    "p_sub_id": sub_id,
                    "p_user_id": self.active_user_id,
                    "p_customer_id": sub.get('customer_id'),
                    "p_now_iso": now_iso,
                    "p_today_iso": today_iso,

                    # History row
                    "p_hist_plan_name": sub.get('plan_name_cached'),
                    "p_hist_start_date": old_start,
                    "p_hist_end_date": now_iso,
                    "p_hist_price": old_price,
                    "p_hist_additional_charge": old_add,
                    "p_hist_discount_amount": old_disc,
                    "p_hist_osc_snapshot": old_other,
                    "p_hist_osc_paid_amount": final_osc_paid,
                    "p_hist_bill_amount": old_bill_total,
                    "p_hist_paid_amount": paid_so_far,
                    "p_hist_status": hist_status,

                    # Intermediate update
                    "p_new_pending_total": new_pending_total,

                    # Retag log IDs (pass as JSON array)
                    "p_retag_log_ids": pay_ids_to_update,
                    "p_refund_log_ids": refund_ids_to_update, # ✅ NOW PASSED SECURELY INTO RPC!

                    # Advance logs to insert
                    "p_advance_logs_to_insert": advance_logs_to_insert,

                    # New cycle data
                    "p_new_status": "active",
                    "p_new_activation_date": today_iso,
                    "p_new_billing_start": now_iso,
                    "p_new_billing_end": new_billing_end,
                    "p_new_current_amount": current_debt,
                    "p_new_advance_balance": advance,
                    "p_new_price": float(sub.get('upcoming_plan_price') or sub.get('price') or 0),
                    "p_new_additional_charge": new_add,
                    "p_new_discount_amount": new_disc,
                    "p_new_upcoming_additional": new_add,
                    "p_new_upcoming_discount": new_disc,
                    "p_new_upcoming_amount": upcoming_debt
                }).execute()

                self.sync_customer_totals({"customer_id": sub.get('customer_id')})
                return {"ok": True}

            else:
                return {"ok": False, "error": "Invalid action"}

        except Exception as e:
            return {"ok": False, "error": friendly(e)}
        
    # 4. New Function: Get Payment History
    def get_payment_history(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            customer_id = payload.get("customer_id")
            
            # Fetch payments for this customer, ordered by newest first
            res = db_module.supabase.table('payments')\
                .select("*")\
                .eq("customer_id", customer_id)\
                .order('date', desc=True)\
                .order('created_at', desc=True)\
                .execute()
                
            return {"ok": True, "data": res.data}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}
        
    # ---------------------------------------------------------
    # ✅ NEW: WHATSAPP REMINDER BOT (SELENIUM)
    # ---------------------------------------------------------
    def send_whatsapp_reminder(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            # ✅ Extracts LIST of plans
            sub_ids = payload.get("subscription_ids", [])
            
            # Failsafe for older frontend cache
            if not sub_ids and payload.get("subscription_id"):
                sub_ids = [payload.get("subscription_id")]
                
            if not sub_ids:
                return {"ok": False, "error": "No subscriptions selected."}
                
            cust_id = payload.get("customer_id")
            msg_type = payload.get("message_type", "current") # e.g., current, upcoming, osc, only_upcoming

            # 1. Fetch Customer Phone & Alternate Phone
            cust_res = db_module.supabase.table('customers').select("phone, alt_phone").eq("id", cust_id).single().execute()
            if not cust_res.data:
                return {"ok": False, "error": "Customer not found."}
            
            phones_to_try = []
            
            # Clean Primary Phone
            raw_phone = str(cust_res.data.get('phone') or '').strip().replace(" ", "").replace("+", "")
            if len(raw_phone) == 10: phones_to_try.append("91" + raw_phone)
            elif raw_phone.startswith("91"): phones_to_try.append(raw_phone)

            # Clean Alternate Phone
            alt_phone = str(cust_res.data.get('alt_phone') or '').strip().replace(" ", "").replace("+", "")
            if len(alt_phone) == 10: phones_to_try.append("91" + alt_phone)
            elif alt_phone.startswith("91"): phones_to_try.append(alt_phone)
            
            if not phones_to_try:
                return {"ok": False, "error": "No valid phone numbers found for this customer."}

            # 2. Fetch Selected Subscriptions & Group Them
            subs = db_module.supabase.table('subscriptions').select("*").in_("id", sub_ids).execute().data or []
            if not subs: return {"ok": False, "error": "Subscriptions not found."}
            
            c_subs = [s for s in subs if s.get('cable_plan_id')]
            i_subs = [s for s in subs if s.get('internet_plan_id')]

            # ✅ Pre-fetch ALL history rows in ONE query — eliminates N+1 inside build_manual_section
            all_sub_ids = [s['id'] for s in subs]
            history_map = {}
            if all_sub_ids:
                hist_bulk = db_module.supabase.table('subscription_history') \
                    .select("*") \
                    .in_("subscription_id", all_sub_ids) \
                    .in_("status", ["unpaid", "partial"]) \
                    .order("start_date", desc=False) \
                    .execute().data or []
                for h in hist_bulk:
                    sid = h['subscription_id']
                    if sid not in history_map:
                        history_map[sid] = []
                    history_map[sid].append(h)

            # 3. Format Dates Helper
            def fmt_date(d_str):
                if not d_str or d_str == '-': return ""
                parts = d_str.split('T')[0].split('-')
                if len(parts) == 3: return f"{parts[2]}-{parts[1]}-{parts[0]}"
                return d_str

            tz = pytz.timezone('Asia/Kolkata')
            today = datetime.datetime.now(tz).date()

            # 4. Initialize Message
            msg = f"Dear Customer,\nThis is a friendly reminder regarding your subscription renewals.\n\n"
            if msg_type in ['current', 'upcoming']:
                msg += "*Outstanding Bill Details:*\n"

            total_overall = 0

            # 5. Helper function to build sections (Preserving your exact original format)
            def build_manual_section(subs_list, title):
                nonlocal total_overall
                section_msg = ""
                has_content = False
                sec_total = 0
                temp_msg = f"\n*{title}:*"

                for sub in subs_list:
                    s_id = sub['id']
                    plan_type = "cable" if sub.get('cable_plan_id') else "internet"
                    plan_name = sub.get('plan_name_cached') or f"{plan_type.title()} Plan"
                    
                    history = history_map.get(s_id, [])

                    # Extract Exact Values
                    osc = float(sub.get('other_service_charges') or 0)
                    upcoming = float(sub.get('upcoming_amount') or 0)
                    current = float(sub.get('current_amount') or 0)
                    c_start = fmt_date(sub.get('current_billing_start_date'))
                    
                    c_end_raw = sub.get('current_billing_end_date')
                    c_end = fmt_date(c_end_raw)

                    # SMART EXPIRY CHECK FOR MANUAL BUTTON
                    is_expired_today = False
                    if c_end_raw:
                        try:
                            exp_date = datetime.datetime.strptime(c_end_raw.split('T')[0], "%Y-%m-%d").date()
                            if (exp_date - today).days == 0:
                                is_expired_today = True
                        except (ValueError, TypeError): pass
                        
                    is_stopped = (sub.get('status') == 'inactive')
                    
                    alert_tag = ""
                    if is_stopped:
                        alert_tag = " [🚨 EXPIRED TODAY]" if is_expired_today else " [🚨 EXPIRED]"

                    plan_msg = ""
                    plan_total = 0

                    # Formatter logic directly matching your original structure
                    if msg_type == 'osc':
                        if osc > 0:
                            plan_msg += f"  - Other Service Charges (OSC): ₹{int(osc)}\n"
                            plan_total += osc
                    elif msg_type == 'only_upcoming':
                        if upcoming > 0:
                            try:
                                c_end_dt = datetime.datetime.strptime(c_end_raw.split('T')[0], "%Y-%m-%d")
                                dur = int(sub.get('duration') or 30)
                                upc_end_dt = c_end_dt + datetime.timedelta(days=dur)
                                u_start = fmt_date(c_end_dt.isoformat())
                                u_end = fmt_date(upc_end_dt.isoformat())
                                plan_msg += f"  - Upcoming Plan ({u_start} to {u_end}): ₹{int(upcoming)}\n"
                            except (ValueError, TypeError):
                                plan_msg += f"  - Upcoming Plan: ₹{int(upcoming)}\n"
                            plan_total += upcoming
                    else:
                        for h in history:
                            due = float(h.get('bill_amount') or 0) - float(h.get('paid_amount') or 0)
                            if due > 0:
                                plan_msg += f"  - Previous Pending ({fmt_date(h.get('start_date'))} to {fmt_date(h.get('end_date'))}): ₹{int(due)}\n"
                                plan_total += due
                        
                        if current > 0: 
                            label = "Current Plan"
                            if is_stopped:
                                label = "Previous Pending (Expired Today)" if is_expired_today else "Previous Pending (Stopped)"
                            plan_msg += f"  - {label} ({c_start} to {c_end}): ₹{int(current)}\n"
                            plan_total += current
                            
                        if osc > 0: 
                            plan_msg += f"  - Other Service Charges (OSC): ₹{int(osc)}\n"
                            plan_total += osc
                        
                        if msg_type == 'upcoming' and upcoming > 0:
                            plan_msg += f"  - Upcoming Plan (dates generated after renewal): ₹{int(upcoming)}\n"
                            plan_total += upcoming
                    
                    if plan_msg:
                        temp_msg += f"\n• *{plan_name}{alert_tag}:*\n" + plan_msg
                        sec_total += plan_total
                        has_content = True

                if has_content:
                    if msg_type in ['current', 'upcoming']:
                        temp_msg += f"  *Total Due for {title.split(' ')[0]}: ₹{int(sec_total)}*\n"
                    total_overall += sec_total
                    section_msg = temp_msg

                return section_msg

            # 6. Build final body
            qr_types = []
            
            cable_text = build_manual_section(c_subs, "Cable Subscriptions") if c_subs else ""
            if cable_text:
                msg += cable_text
                qr_types.append("cable")
                
            internet_text = build_manual_section(i_subs, "Internet Subscriptions") if i_subs else ""
            if internet_text:
                msg += internet_text
                qr_types.append("internet")

            msg += f"\n-----------------\n*Total Amount Due: ₹{int(total_overall)}*\n-----------------\n\n"
            
            any_stopped = any(s.get('status') == 'inactive' for s in subs)

            # Smart Footer Text
            if msg_type == 'osc':
                msg += "Kindly clear this amount at your earliest convenience to ensure smooth service. Thank you!"
            elif msg_type == 'only_upcoming':
                msg += "Please renew your plan on time to avoid any interruption in your entertainment. Have a great day!"
            else:
                if any_stopped:
                    msg += "⚠️ *Reminder:* One or more of your plans are currently STOPPED. Please clear your pending dues to resume uninterrupted entertainment!"
                else:
                    msg += "To ensure uninterrupted service and avoid late fees, please clear your outstanding dues at the earliest. Thank you for your continued support!"

            # ---------------------------------------------------------
            # ✅ TRANSLATION LOGIC (Applies if language is NOT English)
            # ---------------------------------------------------------
            target_lang = payload.get("language", "en")
            
            # ✅ Generate the 3rd Follow-Up Message dynamically based on Multi-Plan
            plan_str = "cable & internet" if ("cable" in qr_types and "internet" in qr_types) else (qr_types[0] if qr_types else "subscription")
            follow_up_msg = f"Please pay your {plan_str} bill using the QR code(s) above and send a screenshot of your payment here."
            
            translation_failed = False
            if target_lang != 'en':
                try:
                    # Instantly translates BOTH messages
                    msg = GoogleTranslator(source='en', target=target_lang).translate(msg)
                    follow_up_msg = GoogleTranslator(source='en', target=target_lang).translate(follow_up_msg)
                except Exception as trans_err:
                    print(f"Translation failed, falling back to English: {trans_err}")
                    log_error(trans_err, "GoogleTranslator rate limit or network error")
                    translation_failed = True

            # 6. Trigger Selenium Bot in background — UI never freezes
            threading.Thread(
                target=self._run_selenium_whatsapp,
                args=(phones_to_try, msg, qr_types, follow_up_msg),
                daemon=True
            ).start()

            return {
                "ok": True,
                "message": "WhatsApp reminder is being sent in the background!",
                "translation_failed": translation_failed
            }

        except Exception as e:
            print("WhatsApp Error:", e)
            return {"ok": False, "error": friendly(e)}

    # --- SELENIUM BOT EXECUTION ---
    def _run_selenium_whatsapp(self, phones_to_try, message, plan_types_list, follow_up_msg):
        # Create a persistent profile folder securely
        session_dir = self.get_secure_session_dir()
        driver = None

        # 1. ATTEMPT TO LAUNCH CHROME FIRST
        # 1. ATTEMPT TO LAUNCH CHROME FIRST
        try:
            chrome_options = ChromeOptions()
            chrome_options.add_argument(f"--user-data-dir={session_dir}")
            chrome_options.add_argument("--no-sandbox")
            chrome_options.add_argument("--disable-dev-shm-usage")
            chrome_options.add_argument("--disable-gpu")
            
            service = ChromeService()
            service.creation_flags = CREATE_NO_WINDOW
            driver = webdriver.Chrome(options=chrome_options, service=service)
            print("Browser: Google Chrome launched successfully.")

        except Exception:
            # 2. FALLBACK: ATTEMPT EDGE
            try:
                edge_options = EdgeOptions()
                edge_options.add_argument(f"--user-data-dir={session_dir}")
                edge_options.add_argument("--no-sandbox")
                edge_options.add_argument("--disable-dev-shm-usage")
                edge_options.add_argument("--disable-gpu")
                
                service = EdgeService()
                service.creation_flags = CREATE_NO_WINDOW
                driver = webdriver.Edge(options=edge_options, service=service)
                print("Browser: Microsoft Edge launched successfully.")

            except Exception:
                # 3. FALLBACK: ATTEMPT FIREFOX
                try:
                    firefox_options = FirefoxOptions()
                    
                    ff_session_dir = f"{session_dir}_FF"
                    firefox_options.add_argument("-profile")
                    firefox_options.add_argument(ff_session_dir)
                    
                    service = FirefoxService()
                    service.creation_flags = CREATE_NO_WINDOW
                    driver = Firefox(options=firefox_options, service=service)
                    print("Browser: Mozilla Firefox launched successfully.")

                except Exception as e:
                    raise Exception(
                        "WhatsApp bot could not open a browser.\n\n"
                        "Please install one of the following:\n"
                        "• Google Chrome\n"
                        "• Microsoft Edge\n"
                        "• Mozilla Firefox\n\n"
                        "Then restart the app and try again."
                    )

        # 3. EXECUTE WHATSAPP ACTIONS (SMART FALLBACK LOOP)
        try:
            encoded_msg = urllib.parse.quote(message)
            message_sent_successfully = False
            
            # ✅ Loop through the phone numbers (Primary first, then Alternate)
            for phone in phones_to_try:
                print(f"Checking WhatsApp registry for number: {phone}...")
                url = f"https://web.whatsapp.com/send?phone={phone}&text={encoded_msg}"
                
                driver.get(url)

                wait_start = time.time()
                chat_ready = False
                invalid_number = False
                send_btn = None
                
                # ✅ FIX: Lowered timeout to 15s to be snappy, but safe for slow internet
                while time.time() - wait_start < 15:
                    try:
                        # ✅ FIX: Added "isn't on WhatsApp" to catch the new WhatsApp popup text!
                        invalid_xpath = '//*[contains(text(), "shared via url is invalid") or contains(text(), "invalid phone number") or contains(text(), "isn\'t registered on WhatsApp") or contains(text(), "not registered on WhatsApp") or contains(text(), "isn\'t on WhatsApp")]'
                        if driver.find_elements(By.XPATH, invalid_xpath):
                            invalid_number = True
                            break
                            
                        # Check if the chat box is open and ready
                        send_xpath = '//button[@aria-label="Send"] | //span[@data-icon="send"]'
                        btns = driver.find_elements(By.XPATH, send_xpath)
                        if btns:
                            send_btn = btns[0]
                            chat_ready = True
                            break
                    except Exception:
                        pass
                    time.sleep(1)

                # If invalid, skip rest of loop and try alternate number
                if invalid_number:
                    print(f"Number {phone} is NOT on WhatsApp. Trying alternate number...")
                    continue 

                # If valid, send everything!
                if chat_ready and send_btn:
                    print(f"Number {phone} is ACTIVE! Sending message...")
                    time.sleep(2) 
                    
                    try:
                        driver.execute_script("arguments[0].click();", send_btn)
                    except Exception:
                        driver.switch_to.active_element.send_keys(Keys.ENTER)
                    
                    # ✅ SAFETY DELAY: Wait 5 full seconds after sending the 1st text
                    time.sleep(5) 

                    # ---------------------------------------------------------
                    # ✅ NEW: MULTI-QR LOOP (CLIPBOARD PASTE SIMULATION)
                    # ---------------------------------------------------------
                    if isinstance(plan_types_list, str): plan_types_list = [plan_types_list]

                    # ── QR Selection logic ─────────────────────────────────
                    # If customer has BOTH cable and internet, use the combined QR.
                    # If combined QR not uploaded, fall back to sending both separately.
                    has_both = ("cable" in plan_types_list and "internet" in plan_types_list)

                    if has_both:
                        both_path = self._download_qr_to_temp("both")
                        if both_path:
                            qr_paths_to_send = [("both_qr.png", both_path)]
                        else:
                            # Fall back: send cable then internet separately
                            qr_paths_to_send = []
                            for pt in plan_types_list:
                                p = self._download_qr_to_temp(pt)
                                if p:
                                    qr_paths_to_send.append((f"{pt}_qr.png", p))
                    else:
                        qr_paths_to_send = []
                        for pt in plan_types_list:
                            p = self._download_qr_to_temp(pt)
                            if p:
                                qr_paths_to_send.append((f"{pt}_qr.png", p))

                    import tempfile as _tmp_mod
                    temp_files_to_clean = [path for _, path in qr_paths_to_send]

                    for img_name, qr_image_path in qr_paths_to_send:
                        if os.path.exists(qr_image_path):
                            print(f"{img_name} ready! Simulating Paste...")
                            try:
                                with open(qr_image_path, "rb") as f:
                                    b64_string = base64.b64encode(f.read()).decode('utf-8')

                                chat_box_xpath = '//footer//div[@contenteditable="true"] | //div[@title="Type a message"]'
                                chat_box = WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.XPATH, chat_box_xpath)))

                                js_paste = """
                                var b64Data = arguments[0]; var filename = arguments[1]; var targetBox = arguments[2];
                                var byteString = atob(b64Data); var ab = new ArrayBuffer(byteString.length); var ia = new Uint8Array(ab);
                                for (var i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                                var blob = new Blob([ab], { type: 'image/png' }); var file = new File([blob], filename, { type: 'image/png' });
                                var dataTransfer = new DataTransfer(); dataTransfer.items.add(file);
                                var pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer });
                                targetBox.focus(); targetBox.dispatchEvent(pasteEvent);
                                """
                                driver.execute_script(js_paste, b64_string, img_name, chat_box)

                                preview_send_xpath = '//span[@data-icon="send"] | //div[@aria-label="Send"]'
                                preview_send_btn = WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.XPATH, preview_send_xpath)))
                                time.sleep(5)
                                try:
                                    driver.execute_script("arguments[0].click();", preview_send_btn)
                                except Exception:
                                    driver.switch_to.active_element.send_keys(Keys.ENTER)
                                time.sleep(5)

                            except Exception as img_err:
                                print(f"Warning: Could not simulate Paste: {img_err}")
                        else:
                            print(f"No QR found at {qr_image_path}. Skipping.")

                    # Clean up temp files
                    for tf in temp_files_to_clean:
                        try: os.unlink(tf)
                        except Exception: pass
                        
                        if os.path.exists(qr_image_path):
                            print(f"{img_name} found! Simulating Paste (Ctrl+V)...")
                            try:
                                # ✅ 1. Read the image
                                with open(qr_image_path, "rb") as f:
                                    b64_string = base64.b64encode(f.read()).decode('utf-8')
                                    
                                # ✅ 2. Find the exact typing box of the CURRENT customer (Locks the target)
                                chat_box_xpath = '//footer//div[@contenteditable="true"] | //div[@title="Type a message"]'
                                chat_box = WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.XPATH, chat_box_xpath)))
                                    
                                # ✅ 3. Inject JS to simulate "Paste" exactly into this text box!
                                # This prevents the mouse from accidentally clicking the left sidebar.
                                js_paste = """
                                var b64Data = arguments[0];
                                var filename = arguments[1];
                                var targetBox = arguments[2];
                                
                                // Convert base64 back to an image file
                                var byteString = atob(b64Data);
                                var ab = new ArrayBuffer(byteString.length);
                                var ia = new Uint8Array(ab);
                                for (var i = 0; i < byteString.length; i++) {
                                    ia[i] = byteString.charCodeAt(i);
                                }
                                var blob = new Blob([ab], { type: 'image/png' });
                                var file = new File([blob], filename, { type: 'image/png' });
                                
                                // Create a Clipboard payload
                                var dataTransfer = new DataTransfer();
                                dataTransfer.items.add(file);
                                
                                // Dispatch the Paste Event (Like hitting Ctrl+V on your keyboard)
                                var pasteEvent = new ClipboardEvent('paste', {
                                    bubbles: true,
                                    cancelable: true,
                                    clipboardData: dataTransfer
                                });
                                
                                targetBox.focus();
                                targetBox.dispatchEvent(pasteEvent);
                                """
                                driver.execute_script(js_paste, b64_string, img_name, chat_box)
                                
                                # ✅ 4. Wait for the Image Preview modal to open
                                preview_send_xpath = '//span[@data-icon="send"] | //div[@aria-label="Send"]'
                                preview_send_btn = WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.XPATH, preview_send_xpath)))
                                
                                time.sleep(5) # Let the preview render completely
                                
                                # ✅ 5. Click Send for the Image (WITHOUT A CAPTION)
                                try:
                                    driver.execute_script("arguments[0].click();", preview_send_btn)
                                except Exception:
                                    driver.switch_to.active_element.send_keys(Keys.ENTER)
                                    
                                # ✅ SAFETY DELAY: Wait 5 full seconds between sending the Image and typing the 3rd text
                                time.sleep(5) 

                            except Exception as img_err:
                                print(f"Warning: Could not simulate Paste: {img_err}")
                        else:
                            print(f"No QR code found at {qr_image_path}. Skipping image.")

                    # ---------------------------------------------------------
                    # ✅ 6. SEND 3RD FOLLOW UP MESSAGE SEPARATELY
                    # ---------------------------------------------------------
                    print("Sending 3rd follow up message...")
                    try:
                        # Find the main chat box again
                        chat_box_xpath = '//footer//div[@contenteditable="true"] | //div[@title="Type a message"]'
                        main_chat_box = WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.XPATH, chat_box_xpath)))
                        
                        # Focus and type the separate message
                        driver.execute_script("arguments[0].focus();", main_chat_box)
                        time.sleep(0.5)
                        
                        # Type it out and hit Enter automatically
                        ActionChains(driver).send_keys(follow_up_msg).send_keys(Keys.ENTER).perform()
                        
                    except Exception as follow_err:
                        print(f"Warning: Could not send 3rd message: {follow_err}")
                        
                    time.sleep(4) # Wait for final message to leave the phone
                    
                    message_sent_successfully = True
                    break # ✅ Success, break out of phone loop so it doesn't try the alternate

            # ✅ If loop finished and no messages were successfully sent
            if not message_sent_successfully:
                raise Exception("Neither the Primary nor the Alternate phone number is registered on WhatsApp.")

            time.sleep(5) # Wait 5 seconds for everything to finish before closing
            
        except Exception as e:
            log_error(e, context="Selenium execution failed")
            raise Exception(f"{friendly(e)}") # Passed straight to the frontend alert
        finally:
            if driver:
                driver.quit()

    # ---------------------------------------------------------
    # ✅ NEW API FUNCTIONS FOR HISTORY & ADVANCE LOGS
    # ---------------------------------------------------------

    def get_history_logs(self, payload):
        """Fetch Plan History - Reads strictly saved OSC value"""
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            sid = payload.get("subscription_id")
            
            # 1. Fetch History
            h_res = db_module.supabase.table('subscription_history').select("*").eq("subscription_id", sid).order('start_date', desc=True).execute()
            logs = h_res.data if h_res.data else []

            # 2. Assign the saved value to 'calculated_osc_paid' so frontend can use it
            for log in logs:
                # If the new column exists and has data, use it. 
                saved_val = log.get('osc_paid_amount')
                if saved_val is not None:
                     log['calculated_osc_paid'] = saved_val
                else:
                     log['calculated_osc_paid'] = 0

            return {"ok": True, "data": logs}

        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    def get_advance_logs(self, payload):
        """Fetch Advance Transactions - Excluding Direct Payments"""
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            sid = payload.get("subscription_id")
            res = db_module.supabase.table('advance_logs').select("*").eq("subscription_id", sid).order('created_at', desc=True).execute()
            logs = res.data or []

            filtered_logs = []
            for log in logs:
                reason = str(log.get('reason') or "")
                
                # ✅ LOGIC: Filter out "Direct Payments"
                if "Payment for Cycle" in reason or "Cleared Past Dues" in reason:
                    # Convert to uppercase to be safe
                    r_upper = reason.upper()
                    
                    # Keywords to exclude.
                    # NOTE: We removed the closing ')' to catch cases like "(CHEQUE: 12345)"
                    exclude_modes = ["(CASH", "(UPI", "(ONLINE", "(CHEQUE", "(NET BANKING", "(BANK"]
                    
                    if any(x in r_upper for x in exclude_modes):
                        continue
                
                # If we passed the check, keep the log
                filtered_logs.append(log)

            return {"ok": True, "data": filtered_logs}
            
        except Exception as e: 
            return {"ok": False, "error": friendly(e)}

    def get_allocation_details(self, payload):
        """Fetch View Dates for a specific history row"""
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            hid = payload.get("history_id")
            res = db_module.supabase.table('payment_allocations').select("*, payments(date, mode)").eq("history_id", hid).execute()
            return {"ok": True, "data": res.data}
        except Exception as e: return {"ok": False, "error": friendly(e)}

    def edit_history_entry(self, payload):
        """Edit old history row (Refunding excess to Advance)"""
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            hist_id = payload.get("history_id")
            new_bill = float(payload.get("bill_amount") or 0)
            
            hist = db_module.supabase.table('subscription_history').select("*").eq("id", hist_id).single().execute().data
            if not hist: return {"ok": False, "error": "History not found"}
            
            paid = float(hist.get('paid_amount') or 0)
            
            # Update Bill Amount
            db_module.supabase.table('subscription_history').update({"bill_amount": new_bill}).eq("id", hist_id).execute()
            
            # Refund Logic: If Paid > New Bill, move excess to Advance
            if paid > new_bill:
                refund_amt = paid - new_bill
                sub_id = hist['subscription_id']
                
                # 1. Update History Paid to match Bill (it's cleared now)
                db_module.supabase.table('subscription_history').update({"paid_amount": new_bill, "status": "cleared"}).eq("id", hist_id).execute()
                
                # 2. Add Refund to Advance
                sub = db_module.supabase.table('subscriptions').select("advance_balance").eq("id", sub_id).single().execute().data
                if sub:
                    new_adv = float(sub.get('advance_balance') or 0) + refund_amt
                    db_module.supabase.table('subscriptions').update({"advance_balance": new_adv}).eq("id", sub_id).execute()
                    
                    # Log it
                    self._log_advance(sub_id, hist['customer_id'], refund_amt, f"Refund from Edit History")

            return {"ok": True}
        except Exception as e: return {"ok": False, "error": friendly(e)}
        
    def get_customers(self, payload=None):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            user_id = self.active_user_id 
            
            # 1. Setup Pagination and Search variables
            page = 0
            search_term = ""
            search_type = "name"

            if isinstance(payload, dict):
                page = int(payload.get("page", 0))
                search_term = payload.get("search_term", "").strip()
                search_type = payload.get("search_type", "name")
            
            page_size = 20
            start = page * page_size
            end = start + page_size - 1

            # 2. Start building the database query
            query = db_module.supabase.table('customers').select("*", count="exact").eq('user_id', user_id)

            # 3. Apply the Search Filter if the user typed something
            if search_term:
                if search_type == "name":
                    query = query.ilike("name", f"%{search_term}%")
                elif search_type == "phone":
                    query = query.ilike("phone", f"%{search_term}%")
                elif search_type == "address":
                    query = query.ilike("short_address", f"%{search_term}%")
                elif search_type == "id":
                    try:
                        query = query.eq("customer_seq_id", int(search_term))
                    except ValueError:
                        pass
                
            # 4. Fetch the matching data 20 at a time (Even when searching)
            response = query.order('created_at', desc=True).range(start, end).execute()
            
            total_count = response.count or 0
            has_more = (start + page_size) < total_count

            return {
                "ok": True, 
                "data": response.data,
                "has_more": has_more
            }
        except Exception as e:
            print(f"Error fetching customers: {e}")
            return {"ok": False, "error": friendly(e)}
        
    def create_customer_with_plans(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            customer_data = payload.get('customer')
            subscriptions_data = payload.get('subscriptions')
            user_id = self.active_user_id

            # 1. Get Customer ID (atomic per-user sequence — race condition safe)
            seq_res = db_module.supabase.rpc('get_next_customer_seq_id_for_user', {
                'p_user_id': user_id
            }).execute()
            next_id = seq_res.data

            # 2. Insert Customer
            cust_payload = {
                "user_id": user_id,
                "customer_seq_id": next_id,
                "name": customer_data.get('name'),
                "phone": customer_data.get('phone'),
                "alt_phone": customer_data.get('alt_phone'),
                "email": customer_data.get('email'),
                "aadhaar_number": customer_data.get('aadhaar_number'),
                "short_address": customer_data.get('short_address'), 
                "long_address": customer_data.get('long_address'),   
                "is_active": True
            }
            cust_response = db_module.supabase.table('customers').insert(cust_payload).execute()
            if not cust_response.data: return {"ok": False, "error": "Failed to create customer"}
            new_customer_id = cust_response.data[0]['id']

            # 3. Insert Plans (Fetch actual duration for each)
            
            today = datetime.datetime.now(pytz.timezone('Asia/Kolkata')).date()
            final_subs = []

            for sub in subscriptions_data: 
                # --- FETCH DURATION ---
                duration_days = 30 # Default
                plan_id = sub.get('plan_id')
                if sub.get('plan_type') == 'cable':
                    p = db_module.supabase.table('cable_plans').select('duration').eq('id', plan_id).single().execute()
                    if p.data and p.data.get('duration'): duration_days = int(p.data['duration'])
                else:
                    p = db_module.supabase.table('internet_plans').select('duration').eq('id', plan_id).single().execute()
                    if p.data and p.data.get('duration'): duration_days = int(p.data['duration'])
                
                end_date = today + datetime.timedelta(days=duration_days)

                # ✅ NEW: Handle Financials (Base + Add - Disc)
                base_price = float(sub.get('price') or 0)
                add_charge = float(sub.get('additional_charge') or 0)
                discount = float(sub.get('discount_amount') or 0)
                
                final_amount = (base_price + add_charge) - discount
                if final_amount < 0: final_amount = 0

                row = {
                    "user_id": user_id,
                    "customer_id": new_customer_id,
                    "plan_name_cached": sub.get('plan_name', 'Unknown Plan'),
                    "price": base_price,
                    "duration": duration_days, # ✅ FIX: Saves real duration (e.g. 37)
                    "status": "active",
                    "activation_date": str(today),
                    "current_billing_start_date": self._get_ist_now(),
                    "current_billing_end_date": end_date.strftime("%Y-%m-%d"),
                    
                    # ✅ FIX: Save the calculated net amount
                    "current_amount": final_amount, 
                    "upcoming_amount": final_amount,

                    # ✅ FIX: Save the breakdown columns
                    "additional_charge": add_charge,
                    "upcoming_additional_charge": add_charge,
                    "discount_amount": discount,
                    "upcoming_discount_amount": discount,

                    "pending_amount": 0,
                    "created_at": self._get_ist_now() 
                }
                if sub.get('plan_type') == 'cable': row['cable_plan_id'] = plan_id
                else: row['internet_plan_id'] = plan_id
                final_subs.append(row)

            if final_subs: 
                db_module.supabase.table('subscriptions').insert(final_subs).execute()
                self.sync_customer_totals({"customer_id": new_customer_id})
            return {"ok": True, "data": "Success"}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}
    
    def register(self, data):
        res = register_user(
            data.get("name"),
            data.get("email"),
            data.get("password")
        )
        if not res["ok"]:
            return res
        # Supabase automatically sends verification OTP email
        return {"ok": True}

    def login(self, data):
        email = data.get("email")

        # Step 1: Validate credentials via Supabase Auth
        res = login_user(email, data.get("password"))
        if not res["ok"]:
            return res

        user_id = res.get("user_id")

        # Step 3: Send login OTP for 2FA
        otp_res = send_login_otp(email)
        if not otp_res["ok"]:
            return {"ok": False, "error": "Failed to send OTP email. Please try again."}

        return {
            "ok": True,
            "user_id": user_id
        }

    def sendReset(self, data):
        email = data.get("email")
        if not email:
            return {"ok": False, "error": "Email is required"}
        return send_password_reset(email)

    def verifyOtp(self, payload):
        email = payload.get("email")
        code = payload.get("code")
        purpose = payload.get("purpose")

        # Map purpose to Supabase OTP type
        otp_type_map = {
            "login": "email",
            "register": "signup",
            "reset": "recovery"
        }
        otp_type = otp_type_map.get(purpose, "email")

        result = verify_supabase_otp(email, code, otp_type)

        if result["ok"]:
            user_id = result["user_id"]
            access_token = result["access_token"]

            # ✅ Full session with refresh_token — enables auto-refresh after 1 hour
            # DO NOT call postgrest.auth() after this — breaks auto-refresh
            refresh_token = result.get("refresh_token")
            set_auth_session(access_token, refresh_token)

            self.active_user_id = user_id

            try:
                _pref = db_module.supabase.table('users').select("auto_reminder_enabled").eq("id", self.active_user_id).execute()
                if _pref.data:
                    self.auto_reminder_enabled = _pref.data[0].get("auto_reminder_enabled", True)
            except Exception:
                self.auto_reminder_enabled = True

            # Update last_login and mark verified
            
            
            try:
                now_iso = datetime.datetime.now(pytz.timezone('Asia/Kolkata')).isoformat()
                db_module.supabase.table('users').update({
                    "last_login": now_iso,
                    "is_verified": True,
                    "auth_method": "Email/Password"
                }).eq("id", user_id).execute()
            except Exception as e:
                print(f"Error updating last_login: {e}")

            result["user_id"] = user_id

            # Fetch user name to save in sessionStorage — avoids flash of "Admin" on dashboard
            try:
                name_res = db_module.supabase.table('users') \
                    .select("name") \
                    .eq("id", user_id) \
                    .single().execute()
                result["user_name"] = (name_res.data or {}).get("name") or ""
            except Exception:
                result["user_name"] = ""

        return result

    def resetPassword(self, payload):
        new_password = payload.get("newPassword")
        if not new_password:
            return {"ok": False, "error": "Missing new password"}
        
        # ✅ SECURITY FIX: Enforce strong passwords on reset
        if len(new_password) < 8 or not re.search(r"\d", new_password) or not re.search(r"[A-Z]", new_password) or not re.search(r"[!@#$%^&*(),.?\":{}|<>]", new_password):
            return {
                "ok": False, 
                "error": "Password must be at least 8 characters long, contain an uppercase letter, a number, and a special character."
            }
        
        return reset_password_with_token(new_password)

    def startGoogleLogin(self):
        try:
            start_google_oauth_flow()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    def check_google_success(self):
        if check_google_login_status():
            user_id = get_google_user_id()
            access_token = get_google_access_token()

            self.active_user_id = user_id

            try:
                _pref = db_module.supabase.table('users').select("auto_reminder_enabled").eq("id", self.active_user_id).execute()
                if _pref.data:
                    self.auto_reminder_enabled = _pref.data[0].get("auto_reminder_enabled", True)
            except Exception:
                self.auto_reminder_enabled = True

            if access_token:
                # ✅ Full session with refresh_token — same auto-refresh as email/password
                refresh_token = get_google_refresh_token()
                set_auth_session(access_token, refresh_token)
                print(f"Google auth session set for: {user_id}")

            # Update last_login
            
            
            try:
                now_iso = datetime.datetime.now(pytz.timezone('Asia/Kolkata')).isoformat()
                db_module.supabase.table('users').update({
                    "last_login": now_iso,
                    "auth_method": "Google"
                }).eq("id", user_id).execute()
            except Exception as e:
                print(f"Error saving Google login time: {e}")

            # Fetch user name to save in sessionStorage
            user_name = ""
            try:
                name_res = db_module.supabase.table('users') \
                    .select("name") \
                    .eq("id", user_id) \
                    .single().execute()
                user_name = (name_res.data or {}).get("name") or ""
            except Exception:
                pass
            return {"ok": True, "user_id": user_id, "user_name": user_name}
        return {"ok": False}

    # -------------------------
    # SUBSCRIPTION PLAN API
    # -------------------------

    def get_plans(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            user_id = self.active_user_id
            
            # 1. Setup Pagination and Search variables
            plan_type = "cable"
            page = 0
            search_term = ""
            search_type = "name"

            if isinstance(payload, dict):
                plan_type = payload.get("type", "cable")
                page = int(payload.get("page", 0))
                search_term = str(payload.get("search_term", "")).strip()
                search_type = payload.get("search_type", "name")
                
            table = "cable_plans" if plan_type == "cable" else "internet_plans"
            sub_col = "cable_plan_id" if plan_type == "cable" else "internet_plan_id"
            
            page_size = 20
            start = page * page_size
            end = start + page_size - 1

            # 2. Build query
            query = db_module.supabase.table(table).select("*", count="exact").eq("user_id", user_id)

            # 3. Apply Search Filters
            if search_term:
                if search_type == "name":
                    query = query.ilike("name", f"%{search_term}%")
                elif search_type == "price":
                    try: 
                        query = query.eq("price", float(search_term))
                    except ValueError: 
                        pass
                elif search_type == "duration":
                    try: 
                        query = query.eq("duration", int(search_term))
                    except ValueError: 
                        pass
                    
            # 4. ✅ ALWAYS FETCH 20 AT A TIME (Even when searching)
            res = query.order('created_at', desc=True).range(start, end).execute()
            total_count = res.count or 0
            has_more = (start + page_size) < total_count

            plans = res.data or []
            
            if not plans:
                return {"ok": True, "data": [], "has_more": False}

            # 5. Efficiently calculate how many customers are using each fetched plan
            plan_ids = [p['id'] for p in plans]
            sub_res = db_module.supabase.table('subscriptions')\
                .select(f"customer_id, {sub_col}")\
                .eq("user_id", user_id)\
                .in_(sub_col, plan_ids)\
                .neq("status", "deleted").execute()

            from collections import defaultdict
            plan_customers = defaultdict(set)
            for s in (sub_res.data or []):
                pid = s.get(sub_col)
                cid = s.get('customer_id')
                if pid and cid:
                    plan_customers[pid].add(cid)

            for plan in plans:
                plan['customer_count'] = len(plan_customers.get(plan['id'], set()))

            return {"ok": True, "data": plans, "has_more": has_more}
            
        except Exception as e:
            print(f"Error fetching plans: {e}")
            return {"ok": False, "error": friendly(e)}

    def add_plan(self, data):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        user_id = self.active_user_id
        plan_type = data.get("type")
        
        payload = {
            "user_id": user_id,
            "name": data.get("name"),
            "price": data.get("price"),
            "duration": data.get("duration"),
            "updated_at": datetime.datetime.now(pytz.timezone('Asia/Kolkata')).isoformat()
        }

        # ✅ FIXED INDENTATION HERE
        if data.get("notes"):
             payload["notes"] = data.get("notes")

        if plan_type == "cable":
            payload["num_channels"] = data.get("num_channels")
            table = "cable_plans"
        else:
            payload["speed_mbps"] = data.get("speed_mbps")
            table = "internet_plans"

        try:
            res = db_module.supabase.table(table).insert(payload).execute()
            return {"ok": True, "data": res.data}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    def get_plan_details(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        plan_id = payload.get("id")
        plan_type = payload.get("type")
        table = "cable_plans" if plan_type == "cable" else "internet_plans"
        
        # Link to the correct foreign key in the subscriptions table
        sub_col = "cable_plan_id" if plan_type == "cable" else "internet_plan_id"

        try:
            # 1. Fetch Master Plan Data
            res = db_module.supabase.table(table).select("*").eq("id", plan_id).single().execute()
            plan_data = res.data

            # 2. Fetch all non-deleted subscriptions for this plan
            cust_res = db_module.supabase.table('subscriptions')\
                .select("customer_id")\
                .eq(sub_col, plan_id)\
                .neq("status", "deleted")\
                .execute()
            
            # 3. Use a Set to get the unique count of customer IDs
            if cust_res.data:
                unique_customers = {row['customer_id'] for row in cust_res.data}
                plan_data['customer_count'] = len(unique_customers)
            else:
                plan_data['customer_count'] = 0

            return {"ok": True, "data": plan_data}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}

    def update_plan(self, data):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            plan_type = data.get("type")
            plan_id = data.get("id")
            
            # Determine Tables
            table = "cable_plans" if plan_type == "cable" else "internet_plans"

            # Prepare Payload
            payload = {
                "name": data.get("name"), 
                "price": data.get("price"),
                "duration": data.get("duration"), 
                "notes": data.get("notes"),
                "updated_at": datetime.datetime.now(pytz.timezone('Asia/Kolkata')).isoformat()
            }
            
            if plan_type == "cable": 
                payload["num_channels"] = data.get("num_channels")
            else: 
                payload["speed_mbps"] = data.get("speed_mbps")
            
            # ✅ ONLY Update Master Table
            # The Supabase Trigger we just created will handle the rest instantly!
            db_module.supabase.table(table).update(payload).eq("id", plan_id).execute()

            return {"ok": True}
        except Exception as e: 
            return {"ok": False, "error": friendly(e)}

    def delete_plan(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        plan_id  = payload.get("id")
        plan_type = payload.get("type")
        table    = "cable_plans"    if plan_type == "cable" else "internet_plans"
        plan_col = "cable_plan_id"  if plan_type == "cable" else "internet_plan_id"

        try:
            # ── Guard: block if any active/inactive subscriptions use this plan ──
            active_subs = db_module.supabase.table('subscriptions') \
                .select("id").eq(plan_col, plan_id) \
                .in_("status", ["active", "inactive"]).execute()

            if active_subs.data and len(active_subs.data) > 0:
                count = len(active_subs.data)
                return {
                    "ok": False,
                    "error": f"Cannot delete this plan. {count} customer(s) are currently "
                            f"using it. Please remove their plan first."
                }

            # ── Collect IDs for soft-deleted subscriptions linked to this plan ──
            deleted_subs = db_module.supabase.table('subscriptions') \
                .select("id").eq(plan_col, plan_id).eq("status", "deleted").execute()
            sub_ids = [s['id'] for s in (deleted_subs.data or [])]

            hist_ids = []
            if sub_ids:
                hist_res = db_module.supabase.table('subscription_history') \
                    .select("id").in_("subscription_id", sub_ids).execute()
                hist_ids = [h['id'] for h in (hist_res.data or [])]

            # ── ONE atomic RPC call — all deletes or nothing ──────────────
            db_module.supabase.rpc("delete_plan_safe", {
                "p_plan_id":    plan_id,
                "p_plan_table": table,
                "p_plan_col":   plan_col,
                "p_sub_ids":    sub_ids,
                "p_hist_ids":   hist_ids,
            }).execute()

            return {"ok": True}

        except Exception as e:
            return {"ok": False, "error": friendly(e)}
    
    def get_deleted_plan_count(self, payload):
        """Returns count of soft deleted subscriptions for a plan."""
        auth_err = self._require_auth()
        if auth_err: return auth_err
        try:
            plan_id = payload.get("plan_id")
            plan_col = payload.get("plan_col")

            res = db_module.supabase.table('subscriptions') \
                .select("id") \
                .eq(plan_col, plan_id) \
                .eq("status", "deleted") \
                .execute()

            count = len(res.data) if res.data else 0
            return {"ok": True, "count": count}
        except Exception as e:
            return {"ok": False, "count": 0, "error": friendly(e)}
        
    # =========================================================
    # ✅ AUTOMATED BOT: CONSOLIDATE BILLS & SEND MULTIPLE QR
    # =========================================================
    def _trigger_automated_reminders(self):

        tz    = pytz.timezone('Asia/Kolkata')
        today = datetime.datetime.now(tz).date()

        EXPIRING_DAYS = [3, 1]
        EXPIRED_DAYS  = [-1, -4, -12]

        try:
            if not self.active_user_id:
                return

            # ── Q1: Admin support contact ────────────────────────────────────
            admin_phone = ""
            try:
                u_res = db_module.supabase.table('users') \
                    .select("support_contact") \
                    .eq("id", self.active_user_id) \
                    .single().execute()
                admin_phone = (u_res.data or {}).get("support_contact") or ""
            except Exception:
                pass

            # ── Q2: Lightweight scan — find which customers need reminders ────
            res = db_module.supabase.table('subscriptions') \
                .select("customer_id, current_billing_end_date, status") \
                .eq("user_id", self.active_user_id) \
                .in_("status", ["active", "inactive"]) \
                .execute()
            subs = res.data or []

            customer_ids_to_remind = set()
            for sub in subs:
                end_str = sub.get('current_billing_end_date')
                if not end_str: continue
                try:
                    end_date  = datetime.datetime.strptime(end_str.split('T')[0], "%Y-%m-%d").date()
                    days_left = (end_date - today).days
                except (ValueError, TypeError):
                    continue
                status = sub.get('status')
                if days_left in EXPIRING_DAYS and status == 'active':
                    customer_ids_to_remind.add(sub['customer_id'])
                elif days_left == 0:
                    customer_ids_to_remind.add(sub['customer_id'])
                elif days_left in EXPIRED_DAYS and status == 'inactive':
                    customer_ids_to_remind.add(sub['customer_id'])

            if not customer_ids_to_remind:
                return

            # ── Q3: Fetch ALL subscriptions + customer info in ONE query ──────
            # Replaces the old per-customer loop that did 1 query per customer
            all_subs_res = db_module.supabase.table('subscriptions') \
                .select("*, customers(id, name, phone, alt_phone)") \
                .in_("customer_id", list(customer_ids_to_remind)) \
                .in_("status", ["active", "inactive"]) \
                .execute()
            all_subs = all_subs_res.data or []

            if not all_subs:
                return

            # ── Q4: Fetch ALL history rows for ALL subscriptions in ONE query ──
            # Replaces the old per-subscription query inside build_section
            all_sub_ids = [s['id'] for s in all_subs]
            all_hist_res = db_module.supabase.table('subscription_history') \
                .select("subscription_id, bill_amount, paid_amount, start_date, end_date") \
                .in_("subscription_id", all_sub_ids) \
                .in_("status", ["unpaid", "partial"]) \
                .order("start_date", desc=False) \
                .execute()

            # Group history rows by subscription_id in Python
            # history_map[sub_id] = [row1, row2, ...]
            history_map = {}
            for h in (all_hist_res.data or []):
                sid = h['subscription_id']
                if sid not in history_map:
                    history_map[sid] = []
                history_map[sid].append(h)

            # Group subscriptions by customer_id in Python
            # subs_by_customer[customer_id] = [sub1, sub2, ...]
            subs_by_customer = {}
            for s in all_subs:
                cid = s['customer_id']
                if cid not in subs_by_customer:
                    subs_by_customer[cid] = []
                subs_by_customer[cid].append(s)

            # ─────────────────────────────────────────────────────────────────
            # All DB queries are done. Everything below is pure Python.
            # ─────────────────────────────────────────────────────────────────

            automation_tasks = []

            def fmt_d(d):
                if not d or d == '-': return ""
                p = d.split('T')[0].split('-')
                return f"{p[2]}-{p[1]}-{p[0]}" if len(p) == 3 else d

            def get_surface_due(s):
                return (float(s.get('pending_amount') or 0) +
                        float(s.get('current_amount') or 0) +
                        float(s.get('other_service_charges') or 0))

            # build_section now receives history rows from the pre-fetched map
            # instead of querying the DB — identical output, zero queries
            def build_section(subs_list, title):
                temp_msg    = f"*{title}:*\n"
                sec_curr    = 0
                sec_upc     = 0
                has_content = False

                for sub in subs_list:
                    s_id      = sub['id']
                    plan_name = sub.get('plan_name_cached') or 'Plan'
                    c_start   = fmt_d(sub.get('current_billing_start_date'))
                    c_end_raw = sub.get('current_billing_end_date')
                    c_end     = fmt_d(c_end_raw)
                    dur       = int(sub.get('duration') or 30)
                    status    = sub.get('status')

                    current  = float(sub.get('current_amount') or 0)
                    osc      = float(sub.get('other_service_charges') or 0)
                    upcoming = float(sub.get('upcoming_amount') or 0)

                    is_expired_today = False
                    days_left_val    = 0
                    if c_end_raw:
                        try:
                            exp_date      = datetime.datetime.strptime(c_end_raw.split('T')[0], "%Y-%m-%d").date()
                            days_left_val = (exp_date - today).days
                            if days_left_val == 0:
                                is_expired_today = True
                        except (ValueError, TypeError):
                            pass

                    is_inactive = (status == 'inactive')
                    is_exp_past = (days_left_val < 0)

                    if is_expired_today:
                        alert_tag = " [🚨 EXPIRED TODAY]"
                    elif is_inactive:
                        days_ago = abs(days_left_val)
                        if days_ago == 1:
                            alert_tag = " [🔴 Expired Yesterday]"
                        else:
                            alert_tag = f" [🔴 Expired {days_ago} Days Ago]"
                    elif days_left_val == 1:
                        alert_tag = " [⏰ Expiring Tomorrow]"
                    elif days_left_val == 3:
                        alert_tag = " [⏰ Expiring in 3 Days]"
                    else:
                        alert_tag = ""

                    plan_msg  = ""
                    plan_curr = 0
                    plan_upc  = 0

                    # ✅ Use pre-fetched history — NO DB query here
                    hist = history_map.get(s_id, [])

                    for h in hist:
                        due = float(h.get('bill_amount') or 0) - float(h.get('paid_amount') or 0)
                        if due > 0:
                            h_start   = fmt_d(h.get('start_date'))
                            h_end     = fmt_d(h.get('end_date'))
                            plan_msg += f"  - Previous Pending ({h_start} to {h_end}): ₹{int(due)}\n"
                            plan_curr += due

                    if current > 0:
                        if is_expired_today:
                            curr_label = "Previous Pending (Expired Today)"
                        elif is_inactive:
                            curr_label = "Previous Pending"
                        else:
                            curr_label = "Current Plan"
                        plan_msg  += f"  - {curr_label} ({c_start} to {c_end}): ₹{int(current)}\n"
                        plan_curr += current

                    if osc > 0:
                        plan_msg  += f"  - Other Service Charges (OSC): ₹{int(osc)}\n"
                        plan_curr += osc

                    if upcoming > 0:
                        plan_msg += f"  - Upcoming Plan (dates generated after renewal): ₹{int(upcoming)}\n"
                        plan_upc = upcoming

                    plan_total_curr = plan_curr
                    plan_total_upc  = plan_curr + plan_upc

                    if plan_msg or plan_curr > 0 or plan_upc > 0:
                        temp_msg += f"\n• *{plan_name}{alert_tag}:*\n"

                        if is_exp_past and plan_curr == 0 and plan_upc > 0:
                            days_ago_val = abs(days_left_val)
                            if days_ago_val <= 4:
                                temp_msg += (f"  ✅ All your current dues are cleared!\n"
                                             f"  To continue enjoying uninterrupted service,\n"
                                             f"  please pay your upcoming plan amount of ₹{int(plan_upc)}.\n"
                                             f"  For any queries please contact us on {admin_phone}.\n")
                                sec_curr += plan_curr
                                sec_upc  += plan_upc
                            else:
                                temp_msg += (f"  ✅ All your current dues are cleared!\n"
                                             f"  If you wish to continue enjoying uninterrupted service,\n"
                                             f"  or if you have planned a specific starting date,\n"
                                             f"  or if you have any queries,\n"
                                             f"  please contact us on {admin_phone}.\n")
                        else:
                            temp_msg   += plan_msg
                            temp_msg   += f"  - - - - - - - - - - - - - -\n"
                            temp_msg   += f"  *Total Due (Till Current) : ₹{int(plan_total_curr)}*\n"
                            temp_msg   += f"  *Total Due (Till Upcoming): ₹{int(plan_total_upc)}*\n"
                            temp_msg   += f"  - - - - - - - - - - - - - -\n"
                            sec_curr   += plan_curr
                            sec_upc    += plan_upc

                        has_content = True

                    elif days_left_val in [3, 1]:
                        try:
                            c_end_dt = datetime.datetime.strptime(c_end_raw.split('T')[0], "%Y-%m-%d")
                            u_end    = fmt_d((c_end_dt + datetime.timedelta(days=dur)).isoformat())
                        except Exception:
                            u_end = "TBD"
                        temp_msg   += f"\n• *{plan_name}{alert_tag}:*\n"
                        temp_msg   += f"  ✅ All dues are cleared.\n"
                        temp_msg   += f"  Your plan will auto renew on {c_end} till {u_end}.\n"
                        temp_msg   += f"  If you do not want to auto renew, please contact us on {admin_phone}.\n"
                        has_content = True

                if not has_content:
                    return "", 0, 0

                if sec_curr > 0 or sec_upc > 0:
                    temp_msg += f"\n  -----------------\n"
                    temp_msg += f"  *{title.split(' ')[0]} Total (Till Current) : ₹{int(sec_curr)}*\n"
                    temp_msg += f"  *{title.split(' ')[0]} Total (Till Upcoming): ₹{int(sec_curr + sec_upc)}*\n"
                    temp_msg += f"  -----------------\n"

                return temp_msg, sec_curr, sec_upc

            # ── Process each customer using pre-fetched data ──────────────────
            for cust_id in customer_ids_to_remind:

                fresh_subs = subs_by_customer.get(cust_id, [])
                if not fresh_subs:
                    continue

                cust      = fresh_subs[0].get('customers') or {}
                cust_name = cust.get('name') or 'Customer'

                phones_to_try = []
                raw = str(cust.get('phone') or '').strip().replace(" ", "").replace("+", "")
                if len(raw) == 10: phones_to_try.append("91" + raw)
                elif raw.startswith("91"): phones_to_try.append(raw)
                alt = str(cust.get('alt_phone') or '').strip().replace(" ", "").replace("+", "")
                if len(alt) == 10: phones_to_try.append("91" + alt)
                elif alt.startswith("91"): phones_to_try.append(alt)
                if not phones_to_try:
                    continue

                relevant_subs = []
                for sub in fresh_subs:
                    end_str = sub.get('current_billing_end_date')
                    if not end_str: continue
                    try:
                        end_date  = datetime.datetime.strptime(end_str.split('T')[0], "%Y-%m-%d").date()
                        days_left = (end_date - today).days
                    except (ValueError, TypeError):
                        continue
                    status = sub.get('status')

                    include = False
                    if days_left in EXPIRING_DAYS and status == 'active':
                        include = True
                    elif days_left == 0:
                        include = True
                    elif days_left in EXPIRED_DAYS and status == 'inactive':
                        include = True

                    if include:
                        relevant_subs.append((sub, days_left))

                if not relevant_subs:
                    continue

                relevant_subs.sort(key=lambda x: x[1], reverse=True)

                c_subs = [s for s, _ in relevant_subs if s.get('cable_plan_id')]
                i_subs = [s for s, _ in relevant_subs if s.get('internet_plan_id')]

                if not c_subs and not i_subs:
                    continue

                any_expired = any(s.get('status') == 'inactive' for s, _ in relevant_subs)
                any_expiring_today = any(d == 0 for _, d in relevant_subs)
                any_expiring_soon  = any(d in EXPIRING_DAYS for _, d in relevant_subs)

                any_expired_with_curr_dues = any(
                    s.get('status') == 'inactive' and
                    (float(s.get('pending_amount') or 0) +
                     float(s.get('current_amount') or 0) +
                     float(s.get('other_service_charges') or 0)) > 0
                    for s, _ in relevant_subs
                )

                if any_expiring_today and any_expired:
                    opening = (f"Hello {cust_name}! 👋\n"
                               f"This is an important reminder regarding your subscription plans.\n"
                               f"You have a plan that expired today and some plans with outstanding dues.\n")
                elif any_expiring_today:
                    opening = (f"Hello {cust_name}! 👋\n"
                               f"This is an important reminder regarding your subscription renewals.\n"
                               f"Your plan has expired today. Please renew to continue uninterrupted service.\n")
                elif any_expiring_soon and any_expired_with_curr_dues:
                    opening = (f"Hello {cust_name}! 👋\n"
                               f"This is a reminder regarding your subscription plans.\n"
                               f"You have upcoming renewals and some expired plans with outstanding dues.\n")
                elif any_expiring_soon and any_expired:
                    opening = (f"Hello {cust_name}! 👋\n"
                               f"This is a reminder regarding your subscription plans.\n"
                               f"You have upcoming renewals and some recently expired plans.\n")
                elif any_expiring_soon:
                    opening = (f"Hello {cust_name}! 👋\n"
                               f"This is a friendly reminder regarding your upcoming subscription renewals.\n")
                elif any_expired_with_curr_dues:
                    opening = (f"Hello {cust_name}! 👋\n"
                               f"This is a reminder regarding your expired subscription plans.\n"
                               f"You have outstanding dues. Please clear them to restart your service.\n")
                elif any_expired:
                    opening = (f"Hello {cust_name}! 👋\n"
                               f"This is a reminder regarding your expired subscription plans.\n"
                               f"Please review your account details below.\n")
                else:
                    opening = (f"Hello {cust_name}! 👋\n"
                               f"This is a friendly reminder regarding your upcoming subscription renewals.\n")

                qr_types   = []
                grand_curr = 0
                grand_upc  = 0
                cable_msg  = ""
                net_msg    = ""

                if c_subs:
                    cable_text, cc, cu = build_section(c_subs, "Cable Subscriptions")
                    if cable_text:
                        cable_msg   = opening + "\n" + cable_text
                        grand_curr += cc
                        grand_upc  += cu
                        qr_types.append("cable")

                if i_subs:
                    net_text, nc, nu = build_section(i_subs, "Internet Subscriptions")
                    if net_text:
                        if not cable_msg:
                            net_msg = opening + "\n" + net_text
                        else:
                            net_msg = net_text
                        grand_curr += nc
                        grand_upc  += nu
                        qr_types.append("internet")

                if not cable_msg and not net_msg:
                    continue

                if grand_curr == 0 and grand_upc == 0:
                    closing = (f"All your plans are fully paid including the upcoming renewal. "
                               f"Your plans will auto renew smoothly. "
                               f"For any changes, please contact us on {admin_phone}.")
                elif grand_curr == 0 and grand_upc > 0:
                    closing = (f"Great news — your current dues are all cleared! "
                               f"Please pay ₹{int(grand_upc)} for the upcoming renewal "
                               f"to continue your service without any interruption. "
                               f"Contact us on {admin_phone}.")
                elif any_expired or any_expiring_today:
                    closing = (f"⚠️ *Reminder:* One or more of your plans have expired. "
                               f"Please clear your dues of ₹{int(grand_curr)} and pay the upcoming renewal "
                               f"to resume uninterrupted service. Contact us on {admin_phone}.")
                else:
                    closing = (f"To ensure uninterrupted service, please clear your outstanding dues "
                               f"and pay the upcoming renewal before your plan expires. "
                               f"Contact us on {admin_phone}.")

                summary_msg  = f"-----------------\n"
                summary_msg += f"*TOTAL PAYMENT DUE*\n"
                summary_msg += f"-----------------\n"
                summary_msg += f"*Till Current : ₹{int(grand_curr)}*\n"
                summary_msg += f"*Till Upcoming: ₹{int(grand_curr + grand_upc)}*\n"
                summary_msg += f"-----------------\n\n"
                summary_msg += closing

                if not qr_types:
                    if any(s.get('cable_plan_id') for s, _ in relevant_subs):
                        qr_types.append('cable')
                    if any(s.get('internet_plan_id') for s, _ in relevant_subs):
                        qr_types.append('internet')

                plan_str  = ("cable & internet"
                             if ("cable" in qr_types and "internet" in qr_types)
                             else (qr_types[0] if qr_types else "subscription"))
                follow_up = (f"Please pay your {plan_str} bill using the QR code(s) above "
                             f"and send a screenshot of your payment here.\n\n"
                             f"_Note: If you have already made your payment, please ignore this message. "
                             f"This is an auto-generated reminder. "
                             f"For any queries, please contact us on {admin_phone}._")

                all_paid = (grand_curr == 0 and grand_upc == 0)

                automation_tasks.append({
                    "name":             cust_name,
                    "phones_to_try":    phones_to_try,
                    "cable_message":    cable_msg,
                    "internet_message": net_msg,
                    "summary_message":  "" if all_paid else summary_msg,
                    "qr_types":         [] if all_paid else qr_types,
                    "follow_up":        "" if all_paid else follow_up
                })

            if automation_tasks:
                try:
                    threading.Thread(
                        target=self._run_automated_selenium_whatsapp_batch,
                        args=(automation_tasks,),
                        daemon=True
                    ).start()
                except Exception as bot_e:
                    print(f"Failed to auto-send batch: {bot_e}")

        except Exception as main_e:
            print(f"Automated Reminder Error: {main_e}")

    # ---------------------------------------------------------
    # ✅ AUTOMATED BOT: BATCH SELENIUM EXECUTION (SMART FALLBACK)
    # ---------------------------------------------------------
    def _run_automated_selenium_whatsapp_batch(self, tasks):
        session_dir = self.get_secure_session_dir()
        driver = None

        try:
            chrome_options = ChromeOptions()
            chrome_options.add_argument(f"--user-data-dir={session_dir}")
            chrome_options.add_argument("--no-sandbox")
            chrome_options.add_argument("--disable-dev-shm-usage")
            chrome_options.add_argument("--disable-gpu")
            
            service = ChromeService()
            service.creation_flags = CREATE_NO_WINDOW
            driver = webdriver.Chrome(options=chrome_options, service=service)
            print("Browser: Google Chrome launched successfully.")
        except Exception:
            try:
                edge_options = EdgeOptions()
                edge_options.add_argument(f"--user-data-dir={session_dir}")
                edge_options.add_argument("--no-sandbox")
                edge_options.add_argument("--disable-dev-shm-usage")
                edge_options.add_argument("--disable-gpu")
                
                service = EdgeService()
                service.creation_flags = CREATE_NO_WINDOW
                driver = webdriver.Edge(options=edge_options, service=service)
                print("Browser: Microsoft Edge launched successfully.")
            except Exception:
                try:
                    firefox_options = FirefoxOptions()
                    
                    ff_session_dir = f"{session_dir}_FF"
                    firefox_options.add_argument("-profile")
                    firefox_options.add_argument(ff_session_dir)
                    
                    service = FirefoxService()
                    service.creation_flags = CREATE_NO_WINDOW
                    driver = Firefox(options=firefox_options, service=service)
                    print("Browser: Mozilla Firefox launched successfully.")
                except Exception as e:
                    # No browser found — show clear message to user
                    try:
                        if webview.windows:
                            webview.windows[0].evaluate_js(
                                "alert('Automated WhatsApp Reminder Failed!\\n\\n"
                                "No supported browser found on this computer.\\n\\n"
                                "Please install one of the following:\\n"
                                "• Google Chrome\\n"
                                "• Microsoft Edge\\n"
                                "• Mozilla Firefox\\n\\n"
                                "Then restart the app and try again.');"
                            )
                    except Exception:
                        pass
                    raise Exception(f"No browser found. Please install Chrome, Edge or Firefox: {e}")

        try:
            failed_customers = [] # Tracker for failed reminders
            
            # PRE-LOAD WHATSAPP ONCE
            driver.get("https://web.whatsapp.com")
            wait = WebDriverWait(driver, 60)
            print("Waiting for WhatsApp Web to load initially...")
            time.sleep(10) 
            
            # ✅ LOOP THROUGH ALL CUSTOMERS WITH SMART FALLBACK
            for task in tasks:
                cust_name        = task["name"]
                phones_to_try    = task["phones_to_try"]
                cable_message    = task.get("cable_message", "")
                internet_message = task.get("internet_message", "")
                summary_message  = task.get("summary_message", "")
                plan_types_list  = task["qr_types"]
                follow_up_msg    = task["follow_up"]

                # Use cable or internet as first message for URL loading
                message = cable_message if cable_message else internet_message
                
                print(f"Processing Automated Reminder for {cust_name}...")
                message_sent_successfully = False
                
                try:
                    encoded_msg = urllib.parse.quote(message)

                    # ✅ Inner Loop: Test Primary then Alternate Phone
                    for phone in phones_to_try:
                        print(f"Checking WhatsApp registry for number: {phone}...")
                        url = f"https://web.whatsapp.com/send?phone={phone}&text={encoded_msg}"
                        driver.get(url)
                        
                        wait_start = time.time()
                        chat_ready = False
                        invalid_number = False
                        send_btn = None
                        
                        # Smart Scanner
                        while time.time() - wait_start < 59:
                            try:
                                invalid_xpath = '//*[contains(text(), "shared via url is invalid") or contains(text(), "invalid phone number") or contains(text(), "isn\'t registered on WhatsApp") or contains(text(), "not registered on WhatsApp") or contains(text(), "isn\'t on WhatsApp")]'
                                if driver.find_elements(By.XPATH, invalid_xpath):
                                    invalid_number = True
                                    break
                                    
                                send_xpath = '//button[@aria-label="Send"] | //span[@data-icon="send"]'
                                btns = driver.find_elements(By.XPATH, send_xpath)
                                if btns:
                                    send_btn = btns[0]
                                    chat_ready = True
                                    break
                            except Exception:
                                pass
                            time.sleep(1)

                        if invalid_number:
                            print(f"Number {phone} is NOT on WhatsApp. Trying alternate number if available...")
                            continue

                        if not chat_ready:
                            print(f"Number {phone} timed out — WhatsApp took too long to load. Trying alternate if available...")
                            continue
                            
                        if chat_ready and send_btn:
                            print(f"Number {phone} is ACTIVE! Sending message to {cust_name}...")
                            time.sleep(2)
                            try: driver.execute_script("arguments[0].click();", send_btn)
                            except Exception: driver.switch_to.active_element.send_keys(Keys.ENTER)
                            time.sleep(8)

                            chat_box_xpath = '//footer//div[@contenteditable="true"] | //div[@title="Type a message"]'

                            # Helper — paste text via clipboard (no URL reload, preserves newlines)
                            def send_text_message(text):
                                if not text: return
                                try:
                                    pyperclip.copy(text)
                                    time.sleep(random.uniform(1, 2))
                                    chat_box = WebDriverWait(driver, 15).until(
                                        EC.presence_of_element_located((By.XPATH, chat_box_xpath))
                                    )
                                    chat_box.click()
                                    time.sleep(random.uniform(2, 3))
                                    chat_box.send_keys(Keys.CONTROL, 'v')
                                    time.sleep(random.uniform(3, 5))
                                    send_btn_msg = WebDriverWait(driver, 10).until(
                                        EC.presence_of_element_located((By.XPATH, '//button[@aria-label="Send"] | //span[@data-icon="send"]'))
                                    )
                                    try: driver.execute_script("arguments[0].click();", send_btn_msg)
                                    except Exception: chat_box.send_keys(Keys.ENTER)
                                    time.sleep(random.uniform(8, 10))
                                except Exception as e:
                                    print(f"Warning: Could not send text message: {e}")

                            # Message 2 — Internet Subscriptions
                            if cable_message and internet_message:
                                send_text_message(internet_message)

                            # Message 3 — Total Payment Due + closing
                            if summary_message:
                                send_text_message(summary_message)

                            # MULTI-QR LOOP
                            # ── QR Selection (same logic as manual path) ──
                            has_both = ("cable" in plan_types_list and "internet" in plan_types_list)

                            if has_both:
                                both_path = self._download_qr_to_temp("both")
                                if both_path:
                                    auto_qr_paths = [("both_qr.png", both_path)]
                                else:
                                    auto_qr_paths = []
                                    for pt in plan_types_list:
                                        p = self._download_qr_to_temp(pt)
                                        if p: auto_qr_paths.append((f"{pt}_qr.png", p))
                            else:
                                auto_qr_paths = []
                                for pt in plan_types_list:
                                    p = self._download_qr_to_temp(pt)
                                    if p: auto_qr_paths.append((f"{pt}_qr.png", p))

                            auto_temp_files = [path for _, path in auto_qr_paths]

                            for img_name, qr_image_path in auto_qr_paths:
                                if os.path.exists(qr_image_path):
                                    try:
                                        with open(qr_image_path, "rb") as f:
                                            b64_string = base64.b64encode(f.read()).decode('utf-8')

                                        chat_box = WebDriverWait(driver, 15).until(
                                            EC.presence_of_element_located((By.XPATH, chat_box_xpath))
                                        )

                                        js_paste = """
                                        var b64Data = arguments[0]; var filename = arguments[1]; var targetBox = arguments[2];
                                        var byteString = atob(b64Data); var ab = new ArrayBuffer(byteString.length); var ia = new Uint8Array(ab);
                                        for (var i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                                        var blob = new Blob([ab], { type: 'image/png' }); var file = new File([blob], filename, { type: 'image/png' });
                                        var dataTransfer = new DataTransfer(); dataTransfer.items.add(file);
                                        var pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer });
                                        targetBox.focus(); targetBox.dispatchEvent(pasteEvent);
                                        """
                                        driver.execute_script(js_paste, b64_string, img_name, chat_box)

                                        preview_send_xpath = '//span[@data-icon="send"] | //div[@aria-label="Send"]'
                                        preview_send_btn = WebDriverWait(driver, 15).until(
                                            EC.presence_of_element_located((By.XPATH, preview_send_xpath))
                                        )
                                        time.sleep(5)
                                        try: driver.execute_script("arguments[0].click();", preview_send_btn)
                                        except Exception: driver.switch_to.active_element.send_keys(Keys.ENTER)
                                        time.sleep(5)

                                    except Exception as img_err:
                                        print(f"Warning: Could not paste QR: {img_err}")

                            # Clean up temp files
                            for tf in auto_temp_files:
                                try: os.unlink(tf)
                                except Exception: pass

                                if os.path.exists(qr_image_path):
                                    try:
                                        with open(qr_image_path, "rb") as f:
                                            b64_string = base64.b64encode(f.read()).decode('utf-8')

                                        chat_box = WebDriverWait(driver, 15).until(
                                            EC.presence_of_element_located((By.XPATH, chat_box_xpath))
                                        )

                                        js_paste = """
                                        var b64Data = arguments[0]; var filename = arguments[1]; var targetBox = arguments[2];
                                        var byteString = atob(b64Data); var ab = new ArrayBuffer(byteString.length); var ia = new Uint8Array(ab);
                                        for (var i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                                        var blob = new Blob([ab], { type: 'image/png' }); var file = new File([blob], filename, { type: 'image/png' });
                                        var dataTransfer = new DataTransfer(); dataTransfer.items.add(file);
                                        var pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer });
                                        targetBox.focus(); targetBox.dispatchEvent(pasteEvent);
                                        """
                                        driver.execute_script(js_paste, b64_string, img_name, chat_box)

                                        preview_send_xpath = '//span[@data-icon="send"] | //div[@aria-label="Send"]'
                                        preview_send_btn = WebDriverWait(driver, 15).until(
                                            EC.presence_of_element_located((By.XPATH, preview_send_xpath))
                                        )
                                        time.sleep(5)
                                        try: driver.execute_script("arguments[0].click();", preview_send_btn)
                                        except Exception: driver.switch_to.active_element.send_keys(Keys.ENTER)
                                        time.sleep(5)

                                    except Exception as img_err:
                                        print(f"Warning: Could not paste QR: {img_err}")

                            # Message — Follow up + note
                            if follow_up_msg:
                                send_text_message(follow_up_msg)
                                
                            message_sent_successfully = True
                            time.sleep(5) # Wait before jumping to next customer
                            break # Success! Break out of phone loop
                            
                    # Record failure if both numbers were invalid
                    if not message_sent_successfully:
                        print(f"Failed: {cust_name} has no valid WhatsApp numbers.")
                        failed_customers.append(cust_name)
                    
                except Exception as loop_err:
                    print(f"Failed to process customer {cust_name}: {loop_err}")
                    failed_customers.append(cust_name)
                    continue 
            
            # ✅ TRIGGER POPUP ALERT IN THE APP WHEN FINISHED
            if failed_customers:
                failed_names = ", ".join(failed_customers)
                safe_names = failed_names.replace("'", "\\'") # Prevent JS errors
                try:
                    if webview.windows:
                        js_code = f"showCMSAlert('Reminders Status', 'Some numbers were not on WhatsApp:<br><br><b>{safe_names}</b>');"
                        webview.windows[0].evaluate_js(js_code)
                except Exception as e:
                    log_error(e, "evaluate_js failed (failed_customers alert)")
            else:
                try:
                    if webview.windows:
                        webview.windows[0].evaluate_js("showCMSAlert('Reminders Status', 'All messages were sent successfully!');")
                except Exception as e:
                    log_error(e, "evaluate_js failed (success alert)")
            
        except Exception as e:
            log_error(e, context="Selenium batch execution failed")
        finally:
            if driver:
                print("All automated messages processed. Closing browser.")
                driver.quit()

    def delete_customer(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        user_id     = self.active_user_id
        customer_id = payload.get("customer_id")

        try:
            # ── Read customer details before any writes ───────────────────
            cust_res = db_module.supabase.table('customers') \
                .select("*").eq("id", customer_id).eq("user_id", user_id) \
                .single().execute()

            if not cust_res.data:
                return {"ok": False, "error": "Customer not found"}

            cust = cust_res.data

            # ── Collect all IDs Python needs to pass to the RPC ──────────
            subs_res = db_module.supabase.table('subscriptions') \
                .select("id").eq("user_id", user_id).eq("customer_id", customer_id) \
                .execute()
            sub_ids = [s['id'] for s in (subs_res.data or [])]

            hist_ids = []
            if sub_ids:
                hist_res = db_module.supabase.table('subscription_history') \
                    .select("id").in_("subscription_id", sub_ids).execute()
                hist_ids = [h['id'] for h in (hist_res.data or [])]

            # ── ONE atomic RPC call — all deletes + archive or nothing ────
            db_module.supabase.rpc("delete_customer_safe", {
                "p_customer_id":   customer_id,
                "p_user_id":       user_id,
                "p_sub_ids":       sub_ids,
                "p_hist_ids":      hist_ids,
                "p_cust_seq_id":   cust.get("customer_seq_id"),
                "p_name":          cust.get("name") or "",
                "p_phone":         cust.get("phone") or "",
                "p_alt_phone":     cust.get("alt_phone") or "",
                "p_short_address": cust.get("short_address") or "",
            }).execute()

            return {"ok": True}

        except Exception as e:
            return {"ok": False, "error": friendly(e)}
    
    def check_for_updates(self):
        """Checks the GitHub repo for a newer version release."""
        GITHUB_REPO = "rishikhandekar/CustomerManagementSystem" 
        url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'CMS-Desktop-App'})
            with urllib.request.urlopen(req, timeout=5) as response:
                data = json.loads(response.read().decode())
                
                latest_version = data.get("tag_name", __version__)
                
                # IMPORTANT: Find the .exe file from the GitHub assets!
                download_url = ""
                for asset in data.get("assets", []):
                    if asset.get("name", "").endswith(".exe"):
                        download_url = asset.get("browser_download_url")
                        break

                def parse_v(v): return [int(x) for x in v.lstrip('v').split('.')]
                if parse_v(latest_version) > parse_v(__version__):
                    return {
                        "ok": True,
                        "update_available": True,
                        "current": __version__,
                        "latest": latest_version,
                        "download_url": download_url, # Send direct file link to frontend
                        "notes": data.get("body", "Bug fixes and performance improvements.")
                    }
                else:
                    return {"ok": True, "update_available": False, "current": __version__}

        except Exception as e:
            return {"ok": False, "error": "Could not connect to update server."}

    # --- NEW: BACKGROUND DOWNLOADER & RESTART LOGIC ---
    def start_download(self, url):
        if not url:
            return {"ok": False, "error": "No .exe file found on GitHub Release!"}
            
        self.download_progress = 0
        self.download_status = "downloading"
        threading.Thread(target=self._download_worker, args=(url,), daemon=True).start()
        return {"ok": True}

    def _download_worker(self, url):
        try:
            # Download it to the user's Downloads folder temporarily
            downloads_folder = os.path.join(os.path.expanduser('~'), 'Downloads')
            self.new_file_path = os.path.join(downloads_folder, 'CMS_Update_Temp.exe')

            def reporthook(blocknum, blocksize, totalsize):
                if totalsize > 0:
                    percent = int((blocknum * blocksize * 100) / totalsize)
                    self.download_progress = min(percent, 100)

            urllib.request.urlretrieve(url, self.new_file_path, reporthook)
            self.download_status = "done"
        except Exception as e:
            self.download_status = f"error: {str(e)}"

    def get_download_progress(self):
        return {
            "progress": self.download_progress,
            "status": self.download_status
        }

    def apply_update_and_restart(self):
        """The Magic Script that replaces the .exe while the app is closed"""
        current_exe = sys.executable 
        new_exe = self.new_file_path 

        # If you are testing in Python (not a compiled .exe yet)
        if not getattr(sys, 'frozen', False):
            os.startfile(new_exe)
            os._exit(0)

        # If it IS a compiled .exe, build the invisible replacement script
        bat_path = os.path.join(os.path.dirname(current_exe), "updater.bat")
        bat_content = f"""@echo off
timeout /t 2 /nobreak > NUL
move /y "{new_exe}" "{current_exe}"
start "" "{current_exe}"
del "%~f0"
"""
        with open(bat_path, "w") as f:
            f.write(bat_content)

        # Launch the invisible script and kill the current app immediately
        subprocess.Popen(bat_path, creationflags=subprocess.CREATE_NO_WINDOW)
        os._exit(0)

    def get_deleted_customers(self, payload):
        auth_err = self._require_auth()
        if auth_err: return auth_err
        user_id = self.active_user_id
        try:
            # Fetch the list of deleted customers for the new page
            res = db_module.supabase.table('deleted_customers').select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
            return {"ok": True, "data": res.data}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}
        
    def unlink_whatsapp(self, payload=None):
        """Securely deletes the WhatsApp session folder so the user is logged out."""        
        auth_err = self._require_auth()
        if auth_err: return auth_err
        
        try:
            session_dir = self.get_secure_session_dir()
            if os.path.exists(session_dir):
                shutil.rmtree(session_dir) # Permanently deletes the folder
            
            # Also clean up the old unsafe folder if it's still lying around
            unsafe_dir = os.path.join(os.getcwd(), "WhatsApp_Session")
            if os.path.exists(unsafe_dir):
                shutil.rmtree(unsafe_dir)
                
            return {"ok": True, "message": "WhatsApp unlinked securely!"}
        except Exception as e:
            return {"ok": False, "error": friendly(e)}