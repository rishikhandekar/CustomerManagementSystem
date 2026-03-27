/* frontend/js/addplan.js */
loadLayout('subscriptions');

document.addEventListener('DOMContentLoaded', () => {
    const checkCable = document.getElementById('checkCable');
    const checkInternet = document.getElementById('checkInternet');
    const formCable = document.getElementById('formCable');
    const formInternet = document.getElementById('formInternet');

    // 1. Toggle Visibility
    checkCable.addEventListener('change', () => {
        formCable.style.display = checkCable.checked ? 'block' : 'none';
    });
    checkInternet.addEventListener('change', () => {
        formInternet.style.display = checkInternet.checked ? 'block' : 'none';
    });

    // 2. Submit Logic
    document.getElementById('btnSubmit').addEventListener('click', async () => {
        
        // A. Get User ID
        const userId = sessionStorage.getItem('user_id');
        if (!userId) {
            alert("Error: User not logged in. Please log in again.");
            return;
        }

        // B. Check Selection
        if (!checkCable.checked && !checkInternet.checked) {
            alert("Please select at least one Subscription Type.");
            return;
        }

        // --- STEP 1: VALIDATION (Check EVERYTHING before saving anything) ---
        
        // Validate Cable inputs if checked
        if (checkCable.checked) {
            const name = document.getElementById('cableName').value.trim();
            const price = document.getElementById('cablePrice').value.trim();
            const duration = document.getElementById('cableDuration').value.trim();

            if (!name || !price || !duration) {
                alert("Please fill all required fields for Cable Plan (Name, Price, Duration).");
                return; // 🛑 STOP! Nothing is saved yet.
            }
        }

        // Validate Internet inputs if checked
        if (checkInternet.checked) {
            const speed = document.getElementById('netSpeed').value.trim();
            const price = document.getElementById('netPrice').value.trim();
            const duration = document.getElementById('netDuration').value.trim();

            if (!speed || !price || !duration) {
                alert("Please fill all required fields for Internet Plan (Speed, Price, Duration).");
                return;
            }
        }

        // --- STEP 2: EXECUTION (Only reached if ALL validations passed) ---
        
        let errors = [];
        let successCount = 0;

        // Save Cable Plan
        if (checkCable.checked) {
            const res = await window.pywebview.api.add_plan({
                user_id: userId,
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
        if (checkInternet.checked) {
            const speedVal = document.getElementById('netSpeed').value.trim();
            // If name is empty, auto-generate it like "100 Mbps Plan"
            let nameVal = document.getElementById('netName').value.trim();
            if (!nameVal) {
                nameVal = `${speedVal} Mbps Plan`;
            }

            const res = await window.pywebview.api.add_plan({
                user_id: userId,
                type: 'internet',
                name: nameVal, // Sending generated or optional name
                price: document.getElementById('netPrice').value.trim(),
                duration: document.getElementById('netDuration').value.trim(),
                speed_mbps: speedVal
            });

            if (res.ok) successCount++;
            else errors.push("Internet Error: " + res.error);
        }

        // --- STEP 3: FINAL FEEDBACK ---
        if (errors.length > 0) {
            alert("Failed to add plans:\n" + errors.join("\n"));
        } else if (successCount > 0) {
            alert("Plan(s) Added Successfully!");
            window.location.href = 'subscription.html';
        }
    });
});