document.getElementById("resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const btnSend = document.getElementById("btnSend");
    const originalText = btnSend.innerText;
    btnSend.disabled = true;
    btnSend.innerText = "Sending OTP... ⏳";

    try {
        const email = document.getElementById("email").value.trim();

        const res = await window.pywebview.api.sendReset({ email });

        // ✅ KEEP THIS: It catches real system errors and rate limits
        if (!res.ok) {
            showToast(res.error, 'error');
            btnSend.disabled = false;
            btnSend.innerText = originalText;
            return;
        }

        // ✅ This part only runs if the backend successfully triggered the process
        sessionStorage.setItem("otp_email", email);
        sessionStorage.setItem("otp_purpose", "reset");
        
        const longMessage = `OTP sent to ${email}. If registered, you will receive it shortly...`;
        sessionStorage.setItem("pending_otp_toast", longMessage);

        location.href = "otp.html";

    } catch (error) {
        showToast("System Error: " + error, 'error');
        btnSend.disabled = false;
        btnSend.innerText = originalText;
    }
});
