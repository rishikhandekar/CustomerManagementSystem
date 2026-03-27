/* frontend/js/profile.js */


// ── CMS Custom Alert Modal ────────────────────────────────────
function showCMSAlert(title, message) {
    document.getElementById('cmsAlertTitle').innerHTML = title;
    document.getElementById('cmsAlertMessage').innerHTML = message;
    document.getElementById('cmsAlertOverlay').style.display = 'flex';
}
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('cmsAlertOk').addEventListener('click', () => {
        document.getElementById('cmsAlertOverlay').style.display = 'none';
    });
    document.getElementById('cmsAlertOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'cmsAlertOverlay') {
            document.getElementById('cmsAlertOverlay').style.display = 'none';
        }
    });
});
window.showCMSAlert = showCMSAlert;

// ─────────────────────────────────────────────────────────────

loadLayout('');

// ✅ Wrap everything in an initialization function
async function initProfile() {
    const userId = sessionStorage.getItem('user_id');
    
    if (!userId) {
        window.location.href = 'login.html';
        return;
    }

    // 1. Fetch Profile Data
    try {
        const res = await window.pywebview.api.get_admin_profile({ user_id: userId });
        
        if (res.ok) {
            const data = res.data;
            // Personal
            document.getElementById('profName').value = data.name || '';
            document.getElementById('profEmail').value = data.email || sessionStorage.getItem('user_email') || '';
            document.getElementById('profPhone').value = data.phone || '';
            
            // Business
            document.getElementById('bizName').value = data.business_name || '';
            document.getElementById('bizContact').value = data.support_contact || '';
            document.getElementById('bizGst').value = data.gstin || '';
            document.getElementById('bizAddress').value = data.business_address || '';

            // Security
            document.getElementById('authMethod').innerText = data.auth_method || 'Email/Password';
            

            // ✅ Lock ONLY text fields on initial load (Toggles remain active)
            const fieldsToLock = ['profName', 'profPhone', 'bizName', 'bizContact', 'bizGst', 'bizAddress'];
            fieldsToLock.forEach(id => {
                const el = document.getElementById(id);
                if(el) {
                    el.disabled = true;
                    el.classList.add('input-locked');
                }
            });

            // Format Date
            let loginDateStr = "Never";
            if (data.last_login) {
                const d = new Date(data.last_login);
                loginDateStr = d.toLocaleString('en-IN', { 
                    day: '2-digit', month: 'short', year: 'numeric', 
                    hour: '2-digit', minute: '2-digit', hour12: true 
                });
            }
            document.getElementById('lastLogin').innerText = loginDateStr;

            // Disable password change if they logged in with Google
            if (data.auth_method === "Google") {
                const btnPw = document.getElementById('btnChangePassword');
                btnPw.innerText = "Managed by Google";
                btnPw.disabled = true;
                btnPw.classList.add('disabled-btn');
            }
        } else {
            console.error("Backend Error:", res.error);
            alert("Failed to load profile from database: " + res.error);
        }
    } catch (err) {
        console.error("System Error: ", err);
    }

    // 2. Edit / Save Profile Data Toggle
    // ✅ FIX: Removed toggles so they are always interactive
    const editableFields = ['profName', 'profPhone', 'bizName', 'bizContact', 'bizGst', 'bizAddress'];

    let originalProfileData = {};

    document.getElementById('btnSaveProfile').addEventListener('click', async () => {
        const btnSave = document.getElementById('btnSaveProfile');
        const btnCancel = document.getElementById('btnCancelEdit'); // ✅ Get Cancel Button
        
        // IF IN "EDIT" MODE: Unlock fields and switch button text
        if (btnSave.innerText.trim() === "Edit Profile") {
            // ✅ STORE ORIGINAL VALUES (Handles text AND checkboxes)
            editableFields.forEach(id => {
                const el = document.getElementById(id);
                if(el) {
                    originalProfileData[id] = (el.type === 'checkbox') ? el.checked : el.value;
                }
            });

            editableFields.forEach(id => {
                const el = document.getElementById(id);
                if(el) {
                    el.disabled = false;
                    el.classList.remove('input-locked');
                    el.classList.add('editable-pencil');
                }
            });
            document.getElementById('profName').focus(); // Highlight first field
            btnSave.innerText = "Save Profile Changes";
            btnCancel.style.display = "block"; // ✅ SHOW Cancel Button
            return; // Stop here, wait for user to make changes and click again
        }

        // IF IN "SAVE" MODE: Proceed with saving to database
        btnSave.innerText = "Saving Details... ⏳";
        btnSave.disabled = true;
        btnCancel.style.display = "none"; // Hide cancel while saving

        const payload = {
            user_id: userId,
            name: document.getElementById('profName').value,
            phone: document.getElementById('profPhone').value,
            business_name: document.getElementById('bizName').value,
            support_contact: document.getElementById('bizContact').value,
            gstin: document.getElementById('bizGst').value,
            business_address: document.getElementById('bizAddress').value,
        };

        try {
            const res = await window.pywebview.api.update_admin_profile(payload);
            if (res.ok) {
                alert("Profile updated successfully!");
                sessionStorage.setItem('user_name', payload.name);
                
                // On success, re-lock the fields and change button back to "Edit"
                editableFields.forEach(id => {
                    const el = document.getElementById(id);
                    if(el) {
                        el.disabled = true;
                        el.classList.add('input-locked');
                        el.classList.remove('editable-pencil');
                    }
                });
                btnSave.innerText = "Edit Profile"; 
            } else {
                alert("Update failed: " + res.error);
                btnSave.innerText = "Save Profile Changes"; 
                btnCancel.style.display = "block"; // Bring cancel back on error
            }
        } catch (err) {
            alert("System Error: " + err);
            btnSave.innerText = "Save Profile Changes"; 
            btnCancel.style.display = "block"; // Bring cancel back on error
        } finally {
            btnSave.disabled = false;
        }
    });

    // ✅ NEW: CANCEL BUTTON LOGIC
    document.getElementById('btnCancelEdit').addEventListener('click', () => {
        const btnSave = document.getElementById('btnSaveProfile');
        const btnCancel = document.getElementById('btnCancelEdit');

        // Restore original values and re-lock fields
        editableFields.forEach(id => {
            const el = document.getElementById(id);
            if(el) {
                // ✅ Restore correct state based on element type
                if (el.type === 'checkbox') {
                    el.checked = originalProfileData[id];
                } else {
                    el.value = originalProfileData[id] || '';
                }
                el.disabled = true;
                el.classList.add('input-locked');
                el.classList.remove('editable-pencil');
            }
        });

        // Reset Buttons
        btnSave.innerText = "Edit Profile";
        btnCancel.style.display = "none";
    });

    // 3. Change Password Logic
    document.getElementById('btnChangePassword').addEventListener('click', async () => {
        const email = document.getElementById('profEmail').value;
        const btnPw = document.getElementById('btnChangePassword');
        
        if (!email) return alert("Email not found.");

        btnPw.innerText = "Sending OTP... ⏳";
        btnPw.disabled = true;

        try {
            const res = await window.pywebview.api.sendReset({ email: email });

            if (res.ok) {
                sessionStorage.setItem("otp_email", email);
                sessionStorage.setItem("otp_purpose", "reset");
                sessionStorage.setItem("redirect_after_reset", "profile.html"); 
                
                window.location.href = "otp.html";
            } else {
                alert("Error sending OTP: " + res.error);
                btnPw.innerText = "Send OTP to Email";
                btnPw.disabled = false;
            }
        } catch (err) {
            alert("System Error: " + err);
            btnPw.innerText = "Send OTP to Email";
            btnPw.disabled = false;
        }
    });

    // ──────────────────────────────────────────────────────────────────
    // 4. WhatsApp Automation Buttons
    // ──────────────────────────────────────────────────────────────────

    // Button: Reconnect WhatsApp (Link via QR scan)
    document.getElementById('btnLinkWhatsApp').addEventListener('click', async () => {
        const btn = document.getElementById('btnLinkWhatsApp');
        const originalText = btn.innerHTML;

        btn.innerHTML = '&#9203; Opening Browser...';
        btn.disabled = true;

        try {
            const res = await window.pywebview.api.link_whatsapp();
            if (res.ok) {
                showCMSAlert('WhatsApp Linking 🔗', res.message);
            } else {
                showCMSAlert('Error ❌', res.error);
            }
        } catch (err) {
            showCMSAlert('System Error ❌', String(err));
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });

    // ✅ Button: Unlink WhatsApp Session
    document.getElementById('btnUnlinkWhatsApp').addEventListener('click', async () => {
        const btn = document.getElementById('btnUnlinkWhatsApp');
        const isSure = confirm("Are you sure you want to unlink WhatsApp? You will need to scan the QR code again next time.");
        if (!isSure) return;

        const originalText = btn.innerHTML;
        btn.innerHTML = '&#9203; Unlinking...';
        btn.disabled = true;

        try {
            const res = await window.pywebview.api.unlink_whatsapp();
            if (res.ok) {
                showCMSAlert('WhatsApp Unlinked 🔌', res.message);
            } else {
                showCMSAlert('Error ❌', res.error);
            }
        } catch (err) {
            showCMSAlert('System Error ❌', String(err));
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });

    // Button: Force Send Daily Reminders
    document.getElementById('btnForceReminders').addEventListener('click', async () => {
        const btn = document.getElementById('btnForceReminders');
        const originalText = btn.innerHTML;

        btn.innerHTML = '&#9203; Starting Bot...';
        btn.disabled = true;

        try {
            const res = await window.pywebview.api.force_run_daily_reminders();
            if (res.ok) {
                showCMSAlert('Bot Started ▶', res.message);
            } else {
                showCMSAlert('Error ❌', res.error);
            }
        } catch (err) {
            showCMSAlert('System Error ❌', String(err));
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });
}

// ✅ THE FIX: Wait for Python, then wait an extra 300ms for PyWebView internals
let isProfileInitialized = false;

function startWhenReady() {
    if (isProfileInitialized) return;
    
    if (window.pywebview && window.pywebview.api) {
        isProfileInitialized = true;
        
        // 🛑 THE MAGIC DELAY: This stops the "_returnValuesCallbacks" terminal crash!
        // We give PyWebView 300 milliseconds to build its internal receivers before fetching data.
        setTimeout(() => {
            initProfile();
        }, 300); 
    }
}

// 1. Listen for the official ready event
window.addEventListener('pywebviewready', startWhenReady);

// 2. Check repeatedly until the API is fully injected
const checkInterval = setInterval(() => {
    if (window.pywebview && window.pywebview.api) {
        clearInterval(checkInterval);
        startWhenReady();
    }
}, 100);