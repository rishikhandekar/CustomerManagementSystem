document.getElementById("resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const btnSend = document.getElementById("btnSend");
    const originalText = btnSend.innerText;
    btnSend.disabled = true;
    btnSend.innerText = "Sending OTP... ⏳";

    try {
        const email = document.getElementById("email").value.trim();

        const res = await window.pywebview.api.sendReset({ email });

        if (!res.ok) {
            showToast(res.error, 'error');
            btnSend.disabled = false;
            btnSend.innerText = originalText;
            return;
        }

        sessionStorage.setItem("otp_email", email);
        sessionStorage.setItem("otp_purpose", "reset");

        location.href = "otp.html";

    } catch (error) {
        showToast("System Error: " + error, 'error');
        btnSend.disabled = false;
        btnSend.innerText = originalText;
    }
});
