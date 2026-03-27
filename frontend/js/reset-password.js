document.addEventListener("DOMContentLoaded", () => {
    const passwordInput = document.getElementById("newPassword"); // Targets the reset field
    const reqBox = document.getElementById("passwordReqs");
    
    const reqLength = document.getElementById("reqLength");
    const reqLower = document.getElementById("reqLower");
    const reqUpper = document.getElementById("reqUpper");
    const reqNumber = document.getElementById("reqNumber");
    const reqSpecial = document.getElementById("reqSpecial");

    passwordInput.addEventListener("focus", () => {
        reqBox.classList.add("show-reqs");
    });

    passwordInput.addEventListener("blur", () => {
        reqBox.classList.remove("show-reqs");
    });

    passwordInput.addEventListener("input", (e) => {
        const val = e.target.value;

        // Check length (8+)
        if (val.length >= 8) reqLength.classList.add("valid");
        else reqLength.classList.remove("valid");

        // Check for lowercase letter
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

document.getElementById("resetPwForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const newPassword = document.getElementById("newPassword").value;
    const confirm = document.getElementById("confirmPassword").value;

    if (newPassword !== confirm) {
        alert("Passwords do not match");
        return;
    }

    // ✅ SECURITY FIX: Validate new password strength
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
        alert("Password must be at least 8 characters long, contain an uppercase letter, a lowercase letter, a number, and a special character.");
        return;
    }

    // resetPassword now calls supabase.auth.update_user() for the authenticated user
    // The user is already authenticated via OTP verification on the previous page
    const res = await window.pywebview.api.resetPassword({
        newPassword
    });

    if (!res.ok) {
        alert(res.error);
        return;
    }

    alert("Password updated successfully!");

    sessionStorage.removeItem("otp_email");

    const redirectTarget = sessionStorage.getItem("redirect_after_reset");
    if (redirectTarget) {
        sessionStorage.removeItem("redirect_after_reset");
        location.href = redirectTarget;
    } else {
        location.href = "login.html";
    }
});
