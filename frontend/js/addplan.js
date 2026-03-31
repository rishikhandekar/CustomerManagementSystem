/* frontend/js/addplan.js */
loadLayout('subscriptions');

document.addEventListener('DOMContentLoaded', () => {
    const toggleCable = document.getElementById('toggleCable');
    const toggleInternet = document.getElementById('toggleInternet');
    const formCable = document.getElementById('formCable');
    const formInternet = document.getElementById('formInternet');

    // 1. Toggle Visibility
    toggleCable.addEventListener('click', () => {
        toggleCable.classList.toggle('active');
        formCable.style.display = toggleCable.classList.contains('active') ? 'block' : 'none';
    });

    toggleInternet.addEventListener('click', () => {
        toggleInternet.classList.toggle('active');
        formInternet.style.display = toggleInternet.classList.contains('active') ? 'block' : 'none';
    });

    // 2. Submit Logic
    document.getElementById('btnSubmit').addEventListener('click', async () => {
        
        // A. Get User ID
        const userId = sessionStorage.getItem('user_id');
        if (!userId) {
            showToast("Error: User not logged in. Please log in again.", 'error');
            return;
        }

        // B. Check Selection
        if (!toggleCable.classList.contains('active') && !toggleInternet.classList.contains('active')) {
            showToast("Please select at least one Subscription Type.", 'warning');
            return;
        }

        // --- STEP 1: VALIDATION (Check EVERYTHING before saving anything) ---
        
        // Validate Cable inputs if checked
        if (toggleCable.classList.contains('active')) {
            const name = document.getElementById('cableName').value.trim();
            const price = document.getElementById('cablePrice').value.trim();
            const duration = document.getElementById('cableDuration').value.trim();

            if (!name || !price || !duration) {
                showToast("Please fill all required fields for Cable Plan (Name, Price, Duration).", 'warning');
                return; // 🛑 STOP! Nothing is saved yet.
            }
        }

        // Validate Internet inputs if checked
        if (toggleInternet.classList.contains('active')) {
            const speed = document.getElementById('netSpeed').value.trim();
            const price = document.getElementById('netPrice').value.trim();
            const duration = document.getElementById('netDuration').value.trim();

            if (!speed || !price || !duration) {
                showToast("Please fill all required fields for Internet Plan (Speed, Price, Duration).", 'warning');
                return;
            }
        }

        // --- STEP 2: EXECUTION (Only reached if ALL validations passed) ---
        
        let errors = [];
        let successCount = 0;

        try {
            // Save Cable Plan
            if (toggleCable.classList.contains('active')) {
                const res = await window.pywebview.api.add_plan({
                    type: 'cable',
                    name: document.getElementById('cableName').value.trim(),
                    price: document.getElementById('cablePrice').value.trim(),
                    duration: document.getElementById('cableDuration').value.trim(),
                    num_channels: document.getElementById('cableChannels').value.trim()
                });

                if (res.ok) successCount++;
                else errors.push("Cable Error: " + res.error);
            }

            // Save Internet Plan
            if (toggleInternet.classList.contains('active')) {
                const speedVal = document.getElementById('netSpeed').value.trim();
                let nameVal = document.getElementById('netName').value.trim();
                if (!nameVal) { nameVal = `${speedVal} Mbps Plan`; }

                const res = await window.pywebview.api.add_plan({
                    type: 'internet',
                    name: nameVal,
                    price: document.getElementById('netPrice').value.trim(),
                    duration: document.getElementById('netDuration').value.trim(),
                    speed_mbps: speedVal
                });

                if (res.ok) successCount++;
                else errors.push("Internet Error: " + res.error);
            }

            // --- STEP 3: FINAL FEEDBACK ---
            if (errors.length > 0) {
                showToast("Failed to add plans: " + errors.join(", "), 'error');
            } else if (successCount > 0) {
                sessionStorage.setItem('pending_subscription_toast', 'Plan(s) Added Successfully!|success');
                window.location.href = 'subscription.html';
            }

        } catch (err) {
            showToast("Could not connect. Please check your internet and try again.", 'error');
        }
    });
});