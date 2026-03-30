document.addEventListener("DOMContentLoaded", () => {
    const pendingToast = sessionStorage.getItem("pending_auth_toast");
    if (pendingToast) {
        const [msg, type] = pendingToast.split('|');
        showToast(msg, type || 'success');
        sessionStorage.removeItem("pending_auth_toast");
    }
});


document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const btnLogin = document.getElementById("btnLogin");
    const originalText = btnLogin.innerText;
    btnLogin.disabled = true;
    btnLogin.innerText = "Sending OTP... ⏳";

    try {
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;

        const res = await window.pywebview.api.login({ email, password });

        if (!res.ok) {
            showToast(res.error, 'error');
            btnLogin.disabled = false;
            btnLogin.innerText = originalText;
            return;
        }

        sessionStorage.setItem("otp_email", email);
        sessionStorage.setItem("otp_purpose", "login");

        location.href = "otp.html";

    } catch (err) {
        console.error("Login process error:", err);
        showToast("Could not connect. Please check your internet and try again.", 'error');
        btnLogin.disabled = false;
        btnLogin.innerText = originalText;
    }
});

/* Google Login Logic */
let googlePollInterval = null; // ✅ Track interval globally so we can cancel it

function resetGoogleButton() {
    const btnGoogle = document.getElementById("btnGoogle");
    btnGoogle.disabled = false;
    btnGoogle.innerText = "Login with Google";
    if (googlePollInterval) {
        clearInterval(googlePollInterval);
        googlePollInterval = null;
    }
}

document.getElementById("btnGoogle").addEventListener("click", async () => {
    const btnGoogle = document.getElementById("btnGoogle");

    // ✅ If already polling — cancel current attempt and reset
    if (googlePollInterval) {
        resetGoogleButton();
        return;
    }

    btnGoogle.disabled = true;
    btnGoogle.innerText = "Opening Google... ⏳";

    const res = await window.pywebview.api.startGoogleLogin();

    if (!res.ok) {
        showToast(res.error || "Google login failed to start", 'error');
        resetGoogleButton();
        return;
    }

    // ✅ Change button to show Cancel option
    btnGoogle.disabled = false;
    btnGoogle.innerText = "Cancel Google Login ✕";

    let isNavigating = false;
    let elapsedSeconds = 0;
    const TIMEOUT_SECONDS = 120; // 2 minutes max wait

    googlePollInterval = setInterval(async () => {
        if (isNavigating) return;

        elapsedSeconds++;

        // ✅ TIMEOUT: Stop polling after 2 minutes
        if (elapsedSeconds >= TIMEOUT_SECONDS) {
            resetGoogleButton();
            showToast("Google login timed out. Please try again.", 'warning');
            return;
        }

        const status = await window.pywebview.api.check_google_success();

        if (status.ok) {
            isNavigating = true;
            clearInterval(googlePollInterval);
            googlePollInterval = null;
            if (status.user_id) {
                sessionStorage.setItem("user_id", status.user_id);
            }
            if (status.user_name) {
                sessionStorage.setItem("user_name", status.user_name);
            }
            location.href = "dashboard.html";
        }
    }, 1000);
});

// ==========================================
// --- ON STARTUP: CHECK FOR MANDATORY UPDATES ---
// ==========================================
async function enforceMandatoryUpdate() {
    try {
        const res = await window.pywebview.api.check_for_updates();
        
        if (res.ok && res.update_available) {
            // 1. Show the un-closable modal
            document.getElementById('updateOverlay').style.display = 'flex';
            document.getElementById('updateNewVersion').innerText = res.latest;

            // 2. Parse the Release Notes from GitHub
            const notesList = document.getElementById('updateNotesList');
            notesList.innerHTML = ''; 
            
            if (res.notes) {
                // Split the notes by line breaks and remove markdown bullet points
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

            // 3. Make the download button trigger the background download!
            const btnDownload = document.getElementById('btnDownloadUpdate');
            
            btnDownload.onclick = async () => {
                if (!res.download_url) {
                    showToast("No .exe file found on GitHub to download!", "error");
                    return;
                }

                // Hide the old text, show the progress bar
                btnDownload.disabled = true;
                btnDownload.innerHTML = "Initializing Download...";
                document.getElementById('updateProgressContainer').style.display = 'block';
                const progressText = document.getElementById('updateProgressText');
                progressText.style.display = 'block';

                // Tell Python to start downloading
                const startRes = await window.pywebview.api.start_download(res.download_url);
                
                if (!startRes.ok) {
                    showToast(startRes.error, "error");
                    btnDownload.innerHTML = "Download Failed";
                    return;
                }

                // Start checking the progress every 500ms
                const progressInterval = setInterval(async () => {
                    const statusRes = await window.pywebview.api.get_download_progress();
                    
                    if (statusRes.status === "downloading") {
                        document.getElementById('updateProgressBar').style.width = statusRes.progress + "%";
                        progressText.innerText = `Downloading: ${statusRes.progress}%`;
                        btnDownload.innerHTML = "Downloading... Please wait.";
                    } 
                    else if (statusRes.status === "done") {
                        clearInterval(progressInterval);
                        document.getElementById('updateProgressBar').style.width = "100%";
                        progressText.innerText = `Download Complete!`;
                        btnDownload.innerHTML = "Installing & Restarting... 🚀";
                        btnDownload.style.backgroundColor = "#16a34a"; // Turn green
                        
                        // Wait 1 second so they see it hit 100%, then trigger the magic restart script!
                        setTimeout(() => {
                            window.pywebview.api.apply_update_and_restart();
                        }, 1000);
                    }
                    else if (statusRes.status.startsWith("error")) {
                        clearInterval(progressInterval);
                        showToast("Download failed: " + statusRes.status, "error");
                        btnDownload.innerHTML = "Download Failed";
                    }
                }, 500);
            };
        }
    } catch (err) {
        console.error("Silent fail on update check (no internet):", err);
        // If they have no internet, we just let them log in normally. 
        // The API will block them later anyway if offline.
    }
}

// ✅ Wait for PyWebView to inject Python, then run the update check!
window.addEventListener('pywebviewready', () => {
    setTimeout(() => {
        enforceMandatoryUpdate();
    }, 300); // 300ms delay ensures Python is fully loaded before asking
});