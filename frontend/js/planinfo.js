/* frontend/js/planinfo.js */
loadLayout('subscriptions');

async function initPlanInfo() {
    // 1. Get ID from Session
    const planId = sessionStorage.getItem('current_plan_id');
    const planType = sessionStorage.getItem('current_plan_type');
    
    if(!planId || !planType) { 
        window.location.href = 'subscription.html'; 
        return; 
    }

    const btnPrimary = document.getElementById('btnPrimary');
    const btnSecondary = document.getElementById('btnSecondary');
    const inputs = document.querySelectorAll('.form-input, .form-textarea');

    // Modal Elements
    const deleteModal = document.getElementById('deleteModal');
    const btnModalCancel = document.getElementById('btnModalCancel');
    const btnModalDelete = document.getElementById('btnModalDelete');

    let isEditMode = false;

    try {
        // 2. Fetch Data
        const res = await window.pywebview.api.get_plan_details({ id: planId, type: planType });
        
        if(res.ok && res.data) {
            const data = res.data;
            const pName = document.getElementById('pName');
            const pPrice = document.getElementById('pPrice');
            const pDuration = document.getElementById('pDuration');
            const pNotes = document.getElementById('pNotes');
            const lblDynamic = document.getElementById('lblDynamic');
            const pDynamic = document.getElementById('pDynamic');

            pName.value = data.name || ""; 
            pPrice.value = data.price || "";
            pDuration.value = data.duration || "";
            pNotes.value = data.notes || "";

            // ✅ Populate Unique Customer Count
            const pCustomerCount = document.getElementById('pCustomerCount');
            if (pCustomerCount) {
                pCustomerCount.value = data.customer_count || 0;
            }

            // ✅ Correctly handle the display for Number of Channels / Speed
            const dynamicVal = (planType === 'cable') ? data.num_channels : data.speed_mbps;
            pDynamic.value = (dynamicVal !== null && dynamicVal !== undefined) ? dynamicVal : "";

            if(planType === 'cable') {
                lblDynamic.innerText = "Number of Channels";
            } else {
                lblDynamic.innerText = "Speed (Mbps)*";
                if (pName.value === "") {
                    pName.value = `${pDynamic.value} Mbps Plan`;
                }
            }
        }
    } catch (err) {
        console.error("Critical JS Error:", err);
    }

    // 3. Handle Edit / Submit
    btnPrimary.addEventListener('click', async () => {
        if(!isEditMode) {
            // Enter Edit Mode
            isEditMode = true;
            document.getElementById('editModeBanner').style.display = 'block';
            inputs.forEach(i => {
                if (i.id !== 'pCustomerCount') {
                    i.disabled = false;
                    i.classList.add('editable-pencil');
                }
            });
            document.getElementById('pDynamic').disabled = false;
            document.getElementById('pDynamic').classList.add('editable-pencil');

            btnPrimary.innerText = "Submit"; 
            btnPrimary.classList.add("btn-submit");
            btnSecondary.innerText = "Cancel";
            btnSecondary.className = "btn-delete-plan";
            
            btnSecondary.onclick = () => location.reload();
        } else {
            // --- SUBMIT CHANGES ---
            const price = document.getElementById('pPrice').value.trim();
            const duration = document.getElementById('pDuration').value.trim();
            const dynamicVal = document.getElementById('pDynamic').value.trim();
            const nameVal = document.getElementById('pName').value.trim();

            // --- 🔴 CHANGED VALIDATION LOGIC ---
            let isValid = true;
            let missingFields = [];

            // 1. Common Requirements
            if (!price) missingFields.push("Price");
            if (!duration) missingFields.push("Duration");

            // 2. Specific Requirements
            if (planType === 'cable') {
                // For Cable: Name is REQUIRED, Channels are OPTIONAL
                if (!nameVal) missingFields.push("Plan Name");
            } else {
                // For Internet: Speed is REQUIRED, Name is OPTIONAL
                if (!dynamicVal) missingFields.push("Speed (Mbps)");
            }

            if (missingFields.length > 0) {
                showToast("Please fill in the required fields:\n- " + missingFields.join("\n- "), 'warning');
                return;
            }
            // -----------------------------------

            let finalName = nameVal;
            if (planType === 'internet' && !finalName) {
                finalName = `${dynamicVal} Mbps Plan`;
            }

            const updateData = {
                id: planId,
                type: planType,
                name: finalName,
                price: price,
                duration: duration,
                notes: document.getElementById('pNotes').value
            };

            // Send null if empty string to avoid DB errors for integers
            const cleanDynamicVal = dynamicVal === "" ? null : dynamicVal;

            if(planType === 'cable') {
                updateData.num_channels = cleanDynamicVal;
            } else {
                updateData.speed_mbps = cleanDynamicVal;
            }

            const updateRes = await window.pywebview.api.update_plan(updateData);
            if (updateRes.ok) {
                showToast("Plan Updated Successfully!", 'success');
                location.reload();
            } else {
                showToast("Update failed: " + JSON.stringify(updateRes.error), 'error');
            }
        }
    });

    // 4. Handle Delete Button (Open Modal)
    btnSecondary.addEventListener('click', async () => {
        if (!isEditMode) {
            if (deleteModal) {

                // Fetch count of soft deleted subscriptions for this plan
                const plan_col = planType === 'cable' ? 'cable_plan_id' : 'internet_plan_id';
                const countRes = await window.pywebview.api.get_deleted_plan_count({
                    plan_id: planId,
                    plan_col: plan_col
                });

                const archivedCount = (countRes && countRes.ok) ? countRes.count : 0;

                // Build modal message
                const deleteModalText = document.getElementById('deleteModalText');
                if (archivedCount > 0) {
                    deleteModalText.innerText = `This will also permanently remove ${archivedCount} archived plan record(s). Once deleted, it cannot be restored.`;
                } else {
                    deleteModalText.innerText = `Once deleted, it cannot be restored.`;
                }

                deleteModal.style.display = 'flex';
            }
        }
    });

    // 5. Modal Cancel
    if (btnModalCancel) {
        btnModalCancel.addEventListener('click', () => {
            deleteModal.style.display = 'none';
        });
    }

    // 6. Block Modal OK button
    const btnBlockOk = document.getElementById('btnBlockOk');
    const blockModal = document.getElementById('blockModal');
    const blockModalText = document.getElementById('blockModalText');

    if (btnBlockOk) {
        btnBlockOk.addEventListener('click', () => {
            blockModal.style.display = 'none';
        });
    }

    // 7. Confirm Delete
    if (btnModalDelete) {
        btnModalDelete.addEventListener('click', async () => {

            // Disable button to prevent double click
            btnModalDelete.disabled = true;
            btnModalDelete.innerText = 'Deleting...';

            const delRes = await window.pywebview.api.delete_plan({ 
                id: planId, 
                type: planType 
            });

            if (delRes.ok) {
                showToast("Plan Deleted Successfully.", 'success');
                window.location.href = 'subscription.html';
            } else {
                // Hide confirm modal
                deleteModal.style.display = 'none';

                // Reset button
                btnModalDelete.disabled = false;
                btnModalDelete.innerText = 'Delete';

                // Show block modal with the friendly error message
                blockModalText.innerText = delRes.error;
                blockModal.style.display = 'flex';
            }
        });
    }
}

// ✅ FIXED INITIALIZATION LOGIC
// Checks if API is ready immediately, otherwise waits for event
if (window.pywebview) {
    initPlanInfo();
} else {
    window.addEventListener('pywebviewready', initPlanInfo);
}