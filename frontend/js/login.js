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