// ✅ PASTE THIS NEW CODE AT THE VERY TOP OF THE FILE
document.addEventListener("DOMContentLoaded", () => {
    const passwordInput = document.getElementById("password");
    const reqBox = document.getElementById("passwordReqs");
    
    const reqLength = document.getElementById("reqLength");
    const reqLower = document.getElementById("reqLower");
    const reqUpper = document.getElementById("reqUpper");
    const reqNumber = document.getElementById("reqNumber");
    const reqSpecial = document.getElementById("reqSpecial");

    // 1. Show the box when user clicks into the password field
    passwordInput.addEventListener("focus", () => {
        reqBox.classList.add("show-reqs");
    });

    // 2. Hide the box when user clicks away
    passwordInput.addEventListener("blur", () => {
        reqBox.classList.remove("show-reqs");
    });

    // 3. Check the rules in real-time as they type
    passwordInput.addEventListener("input", (e) => {
        const val = e.target.value;

        // Check length (8+)
        if (val.length >= 8) reqLength.classList.add("valid");
        else reqLength.classList.remove("valid");

        // ✅ Check for lowercase letter
        if (/[a-z]/.test(val)) reqLower.classList.add("valid");
        else reqLower.classList.remove("valid");

        // Check for uppercase letter
        if (/[A-Z]/.test(val)) reqUpper.classList.add("valid");
        else reqUpper.classList.remove("valid");

        // Check for number
        if (/\d/.test(val)) reqNumber.classList.add("valid");
        else reqNumber.classList.remove("valid");

        // Check for special character
        if (/[!@#$%^&*(),.?":{}|<>]/.test(val)) reqSpecial.classList.add("valid");
        else reqSpecial.classList.remove("valid");
    });
});

document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const btnRegister = document.getElementById("btnRegister");
    const originalText = btnRegister.innerText;
    btnRegister.disabled = true;
    btnRegister.innerText = "Creating Account... ⏳";

    try {
        const name = document.getElementById("name").value.trim();
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;

        // ✅ SECURITY FIX: Frontend Password Check with Lowercase included
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;
        if (!passwordRegex.test(password)) {
            showToast("Password must be at least 8 characters long, contain an uppercase letter, a lowercase letter, a number, and a special character.", 'warning');
            btnRegister.disabled = false;
            btnRegister.innerText = originalText;
            return; // Stops the form from submitting
        }

        const res = await window.pywebview.api.register({ name, email, password });

        if (!res.ok) {
            showToast(res.error, 'error');
            btnRegister.disabled = false;
            btnRegister.innerText = originalText;
            return;
        }

        // Supabase sends verification OTP to email automatically
        sessionStorage.setItem("otp_email", email);
        sessionStorage.setItem("otp_purpose", "register");
        sessionStorage.setItem("user_name", name);

        location.href = "otp.html";

    } catch (error) {
        showToast("System Error: " + error, 'error');
        btnRegister.disabled = false;
        btnRegister.innerText = originalText;
    }
});

/* Google Login Logic */
let googlePollInterval = null; // ✅ Track interval so we can cancel it

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

    // ✅ Change button to Cancel so user can abort
    btnGoogle.disabled = false;
    btnGoogle.innerText = "Cancel Google Login ✕";

    let isNavigating = false;
    let elapsedSeconds = 0;
    const TIMEOUT_SECONDS = 120;

    googlePollInterval = setInterval(async () => {
        if (isNavigating) return;

        elapsedSeconds++;

        if (elapsedSeconds >= TIMEOUT_SECONDS) {
            resetGoogleButton();
            showToast("Google login timed out. Please try again.", 'warning');
            return;
        }

        let status;
        try {
            status = await window.pywebview.api.check_google_success();
        } catch (err) {
            // Bridge callback missed during navigation — safe to ignore
            return;
        }

        if (status && status.ok) {
            isNavigating = true;
            clearInterval(googlePollInterval);
            googlePollInterval = null;
            if (status.user_id) sessionStorage.setItem("user_id", status.user_id);
            if (status.user_name) sessionStorage.setItem("user_name", status.user_name);
            setTimeout(() => { location.href = "dashboard.html"; }, 250);
        }
    }, 1000);
});