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

// ── QR Upload Handler ─────────────────────────────────────────
async function handleQRUpload(event, qrType) {
    const file = event.target.files[0];
    if (!file) return;

    const previewId  = `preview${qrType.charAt(0).toUpperCase() + qrType.slice(1)}QR`;
    const statusId   = `status${qrType.charAt(0).toUpperCase() + qrType.slice(1)}QR`;
    const holderId   = `placeholder${qrType.charAt(0).toUpperCase() + qrType.slice(1)}QR`;

    // Replace capital B in Both
    const previewEl  = document.getElementById(
        qrType === 'both' ? 'previewBothQR' :
        qrType === 'cable' ? 'previewCableQR' : 'previewInternetQR'
    );
    const statusEl   = document.getElementById(
        qrType === 'both' ? 'statusBothQR' :
        qrType === 'cable' ? 'statusCableQR' : 'statusInternetQR'
    );
    const holderEl   = document.getElementById(
        qrType === 'both' ? 'placeholderBothQR' :
        qrType === 'cable' ? 'placeholderCableQR' : 'placeholderInternetQR'
    );

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = e => {
        previewEl.src = e.target.result;
        previewEl.style.display = 'block';
        if (holderEl) holderEl.style.display = 'none';
    };
    reader.readAsDataURL(file);

    // Upload to backend
    statusEl.textContent = 'Uploading...';
    statusEl.className   = 'qr-status uploading';

    try {
        const b64 = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload  = () => resolve(r.result);
            r.onerror = reject;
            r.readAsDataURL(file);
        });

        const res = await window.pywebview.api.upload_qr_code({
            qr_type:    qrType,
            image_b64:  b64
        });

        if (res.ok) {
            statusEl.textContent = '✓ Saved';
            statusEl.className   = 'qr-status saved';
            showToast(`${qrType.charAt(0).toUpperCase() + qrType.slice(1)} QR saved!`, 'success');
        } else {
            statusEl.textContent = 'Error';
            statusEl.className   = 'qr-status error';
            showToast('Upload failed: ' + res.error, 'error');
        }
    } catch (err) {
        statusEl.textContent = 'Error';
        statusEl.className   = 'qr-status error';
        showToast('Upload error: ' + err, 'error');
    }
}

// ── Load existing QR previews from Supabase ───────────────────
async function loadExistingQRs() {
    try {
        const res = await window.pywebview.api.get_qr_urls();
        if (!res.ok) return;

        const map = {
            cable:    { preview: 'previewCableQR',    holder: 'placeholderCableQR',    status: 'statusCableQR'    },
            internet: { preview: 'previewInternetQR', holder: 'placeholderInternetQR', status: 'statusInternetQR' },
            both:     { preview: 'previewBothQR',     holder: 'placeholderBothQR',     status: 'statusBothQR'     },
        };

        for (const [type, ids] of Object.entries(map)) {
            const url = res.urls[type];
            if (url) {
                const preview = document.getElementById(ids.preview);
                const holder  = document.getElementById(ids.holder);
                const status  = document.getElementById(ids.status);
                if (preview) {
                    preview.src          = url + '?t=' + Date.now(); // cache bust
                    preview.style.display = 'block';
                }
                if (holder) holder.style.display = 'none';
                if (status) {
                    status.textContent = '✓ Saved';
                    status.className   = 'qr-status saved';
                }
            }
        }
    } catch (e) {
        console.log('Could not load QR previews:', e);
    }
}

loadLayout('');

// ✅ Wrap everything in an initialization function
async function initProfile() {
    const userId = sessionStorage.getItem('user_id');
    
    if (!userId) {
        window.location.href = 'login.html';
        return;
    }

    // ✅ NEW: Check for pending password reset toast
    const pendingToast = sessionStorage.getItem("pending_auth_toast");
    if (pendingToast) {
        const [msg, type] = pendingToast.split('|');
        showToast(msg, type || 'success');
        sessionStorage.removeItem("pending_auth_toast");
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

            // Reminder toggle — load saved state from DB
            const reminderToggle = document.getElementById('toggleDailyReminder');
            const reminderStatusText = document.getElementById('reminderStatusText');
            const reminderEnabled = data.auto_reminder_enabled !== false;
            reminderToggle.checked = reminderEnabled;
            reminderStatusText.textContent = reminderEnabled ? '✅ Daily reminders are active' : '🔕 Daily reminders are disabled';
            reminderStatusText.style.color = reminderEnabled ? '#2e7d32' : '#c62828';
            

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
            showToast("Failed to load profile: " + res.error, 'error');
        }
    } catch (err) {
        console.error("System Error: ", err);
        showToast("Could not load profile. Please check your internet connection.", 'warning');
    }

    // Load existing QR code previews
    loadExistingQRs();

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
                showToast("Profile updated successfully!", 'success');
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
                showToast("Update failed: " + res.error, 'error');
                btnSave.innerText = "Save Profile Changes"; 
                btnCancel.style.display = "block"; // Bring cancel back on error
            }
        } catch (err) {
            showToast("System Error: " + err, 'error');
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
        
        if (!email) return showToast("Email not found.", 'warning');

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
                showToast("Error sending OTP: " + res.error, 'error');
                btnPw.innerText = "Send OTP to Email";
                btnPw.disabled = false;
            }
        } catch (err) {
            showToast("System Error: " + err, 'error');
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

        // ✅ ADD THIS CHECK
        if (!localStorage.getItem('browser_download_warned')) {
            showToast("First time setup: Please wait up to 1 minute while background drivers are configured...", 'info', 8000);
            localStorage.setItem('browser_download_warned', 'true');
        }

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

        // ✅ ADD THIS CHECK
        if (!localStorage.getItem('browser_download_warned')) {
            showToast("First time setup: Please wait up to 1 minute while background drivers are configured...", 'info', 8000);
            localStorage.setItem('browser_download_warned', 'true');
        }

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

    // --- APP VERSION & UPDATES ---
    const btnCheckUpdates = document.getElementById('btnCheckUpdates');
    
    // 1. On page load, ask Python what version we are currently running
    try {
        const updateCheck = await window.pywebview.api.check_for_updates();
        if (updateCheck && updateCheck.current) {
            document.getElementById('appVersionDisplay').innerText = updateCheck.current;
        }
    } catch (e) {
        console.error("Could not load current version on startup");
    }

    // 2. Handle the "Check for Updates" button click
    if (btnCheckUpdates) {
        let isCheckingUpdate = false;

        btnCheckUpdates.addEventListener('click', async () => {
            if (isCheckingUpdate) return; // Prevent double-clicks
            
            isCheckingUpdate = true;
            const originalText = btnCheckUpdates.innerHTML;
            btnCheckUpdates.innerHTML = "Checking...";
            btnCheckUpdates.disabled = true;

            try {
                // Ask Python to check GitHub
                const res = await window.pywebview.api.check_for_updates();

                if (res.ok) {
                    if (res.update_available) {
                        // 1. Revert the original profile button so it doesn't stay stuck on "Checking..."
                        btnCheckUpdates.innerHTML = "Check for Updates";
                        btnCheckUpdates.disabled = false;

                        // 2. Show the un-closable modal
                        document.getElementById('updateOverlayProfile').style.display = 'flex';
                        document.getElementById('updateNewVersionProfile').innerText = res.latest;

                        // 3. Parse the Release Notes from GitHub
                        const notesList = document.getElementById('updateNotesListProfile');
                        notesList.innerHTML = ''; 
                        if (res.notes) {
                            const lines = res.notes.split('\n');
                            lines.forEach(line => {
                                let cleanLine = line.replace(/^- /, '').replace(/^\* /, '').trim();
                                if (cleanLine) {
                                    let li = document.createElement('li');
                                    li.innerText = cleanLine;
                                    notesList.appendChild(li);
                                }
                            });
                        } else {
                            notesList.innerHTML = '<li>General bug fixes and security improvements.</li>';
                        }

                        // 4. Handle the Download logic inside the modal!
                        const btnDownloadModal = document.getElementById('btnDownloadUpdateProfile');
                        
                        btnDownloadModal.onclick = async () => {
                            if (!res.download_url) {
                                showToast("No .exe file found on GitHub to download!", "error");
                                return;
                            }

                            // Show progress UI
                            btnDownloadModal.disabled = true;
                            btnDownloadModal.innerHTML = "Initializing Download...";
                            document.getElementById('updateProgressContainerProfile').style.display = 'block';
                            const progressText = document.getElementById('updateProgressTextProfile');
                            progressText.style.display = 'block';

                            // Tell Python to start downloading
                            const startRes = await window.pywebview.api.start_download(res.download_url);
                            
                            if (!startRes.ok) {
                                showToast(startRes.error, "error");
                                btnDownloadModal.innerHTML = "Download Failed";
                                return;
                            }

                            // Start polling every 500ms
                            const progressInterval = setInterval(async () => {
                                const statusRes = await window.pywebview.api.get_download_progress();
                                
                                if (statusRes.status === "downloading") {
                                    document.getElementById('updateProgressBarProfile').style.width = statusRes.progress + "%";
                                    progressText.innerText = `Downloading: ${statusRes.progress}%`;
                                    btnDownloadModal.innerHTML = "Downloading... Please wait.";
                                } 
                                else if (statusRes.status === "done") {
                                    clearInterval(progressInterval);
                                    document.getElementById('updateProgressBarProfile').style.width = "100%";
                                    progressText.innerText = `Download Complete!`;
                                    btnDownloadModal.innerHTML = "Installing & Restarting... 🚀";
                                    btnDownloadModal.style.backgroundColor = "#16a34a"; // Turn green
                                    
                                    // Trigger the magic restart script!
                                    setTimeout(() => {
                                        window.pywebview.api.apply_update_and_restart();
                                    }, 1000);
                                }
                                else if (statusRes.status.startsWith("error")) {
                                    clearInterval(progressInterval);
                                    showToast("Download failed: " + statusRes.status, "error");
                                    btnDownloadModal.innerHTML = "Download Failed";
                                }
                            }, 500);
                        };
                    } else {
                        // No updates needed
                        showToast(`You are on the latest version! (${res.current})`, 'success');
                        btnCheckUpdates.innerHTML = "Up to date ✅";
                    }
                } else {
                    showToast(res.error, 'error');
                    btnCheckUpdates.innerHTML = originalText;
                }

            } catch (err) {
                showToast('System Error: ' + err, 'error');
                btnCheckUpdates.innerHTML = originalText;
            } finally {
                isCheckingUpdate = false;
                // Only re-enable the button if an update ISN'T available
                if (btnCheckUpdates.innerHTML !== "Download Update" && btnCheckUpdates.innerHTML !== "Up to date ✅") {
                    btnCheckUpdates.disabled = false;
                }
            }
        });
    }

    // ── Daily Reminder Toggle ─────────────────────────────────
    const reminderToggle = document.getElementById('toggleDailyReminder');
    const reminderStatusText = document.getElementById('reminderStatusText');

    reminderToggle.addEventListener('change', async () => {
        const enabled = reminderToggle.checked;
        try {
            const res = await window.pywebview.api.set_reminder_status({ enabled });
            if (res.ok) {
                reminderStatusText.textContent = enabled
                    ? '✅ Daily reminders are active'
                    : '🔕 Daily reminders are disabled';
                reminderStatusText.style.color = enabled ? '#2e7d32' : '#c62828';
                showToast(
                    enabled ? 'Daily reminders enabled ✅' : 'Daily reminders disabled 🔕',
                    enabled ? 'success' : 'warning'
                );
            } else {
                reminderToggle.checked = !enabled;
                showToast('Failed to update: ' + res.error, 'error');
            }
        } catch (err) {
            reminderToggle.checked = !enabled;
            showToast('System Error: ' + err, 'error');
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