// 1. Handle "Go Back" Logic
document.getElementById("btnBack").addEventListener("click", (e) => {
    e.preventDefault();

    const purpose = sessionStorage.getItem("otp_purpose");

    if (purpose === "register") {
        location.href = "register.html";
    } else if (purpose === "reset") {
        location.href = "forget-password.html";
    } else {
        location.href = "login.html";
    }
});

const inputs = Array.from(document.querySelectorAll(".otp"));

/* Auto-focus, numeric-only, backspace */
inputs.forEach((input, index) => {
    input.addEventListener("input", () => {
        input.value = input.value.replace(/[^0-9]/g, "");
        if (input.value && index < inputs.length - 1) {
            inputs[index + 1].focus();
        }
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !input.value && index > 0) {
            inputs[index - 1].focus();
        }
    });
});

/* Submit OTP */
document.getElementById("otpForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const btnVerify = e.target.querySelector('button[type="submit"]');
    const originalText = btnVerify.innerText;
    btnVerify.disabled = true;
    btnVerify.innerText = "Verifying... ⏳";

    try {
        const email = sessionStorage.getItem("otp_email");
        const purpose = sessionStorage.getItem("otp_purpose");

        if (!email || !purpose) {
            alert("Missing OTP data. Please go back and try again.");
            btnVerify.disabled = false;
            btnVerify.innerText = originalText;
            return;
        }

        const code = inputs.map(i => i.value).join("");

        if (code.length !== 6) {
            alert("Please enter the 6-digit OTP");
            btnVerify.disabled = false;
            btnVerify.innerText = originalText;
            return;
        }

        const res = await window.pywebview.api.verifyOtp({ email, code, purpose });

        if (!res || !res.ok) {
            alert(res?.error || "OTP verification failed. Please check the code and try again.");
            btnVerify.disabled = false;
            btnVerify.innerText = originalText;
            return;
        }

        if (res.user_id) {
            sessionStorage.setItem("user_id", res.user_id);
        }
        if (res.user_name) {
            sessionStorage.setItem("user_name", res.user_name);
        }

        /* Cleanup */
        sessionStorage.removeItem("otp_purpose");

        if (purpose !== "reset") {
            sessionStorage.removeItem("otp_email");
        }

        /* Redirect */
        if (purpose === "reset") {
            location.href = "reset-password.html";
        } else {
            location.href = "dashboard.html";
        }

    } catch (error) {
        alert("System Error: " + error);
        btnVerify.disabled = false;
        btnVerify.innerText = originalText;
    }
});
