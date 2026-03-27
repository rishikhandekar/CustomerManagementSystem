/* frontend/js/layout.js */

async function loadLayout(activePage) {
    try {
        const response = await fetch('layout.html');
        const html = await response.text();
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        const sidebarHTML = tempDiv.querySelector('.sidebar').outerHTML;
        const headerHTML = tempDiv.querySelector('.top-header').outerHTML;

        const sidebarPlace = document.getElementById('sidebar-placeholder');
        const headerPlace = document.getElementById('header-placeholder');

        if (sidebarPlace) sidebarPlace.innerHTML = sidebarHTML;
        if (headerPlace) headerPlace.innerHTML = headerHTML;

        const profileIcon = document.querySelector('.user-profile');
        if (profileIcon) {
            profileIcon.addEventListener('click', () => {
                window.location.href = 'profile.html';
            });
        }

        const activeNavId = `nav-${activePage}`;
        const activeNavItem = document.getElementById(activeNavId);
        if (activeNavItem) activeNavItem.classList.add('active');

        // ✅ LOGOUT LOGIC: Properly clears session, token and stops bot
        const logoutBtn = document.getElementById('globalLogout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async (e) => {
                e.preventDefault();

                try {
                    await window.pywebview.api.logout_active_user();
                } catch (err) {
                    console.error("Logout error:", err);
                }

                sessionStorage.clear();
                window.location.href = 'login.html';
            });
        }
        
    } catch (error) {
        console.error("Error loading layout:", error);
    }
}

// ── Create Toast Container (injected on every page) ────────
(function() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
    `;
    document.body.appendChild(container);
})();