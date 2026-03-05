// js/settings.js

const GOOGLE_CLIENT_ID = '1075497087840-g6fj2olui0p5r4if1otan841n6hs8j0q.apps.googleusercontent.com';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.events';

export function initSettings() {
    const inputIcal = document.getElementById('setting-ical');
    const inputGemini = document.getElementById('setting-gemini');
    const inputDualisEmail = document.getElementById('setting-dualis-email');
    const inputDualisPassword = document.getElementById('setting-dualis-password');
    const saveBtn = document.getElementById('save-settings-btn');
    const googleBtn = document.getElementById('setting-google-btn');

    // Load existing settings
    if (inputIcal) inputIcal.value = localStorage.getItem('learnspace_ical_url') || '';
    if (inputGemini) inputGemini.value = localStorage.getItem('learnspace_gemini_key') || '';
    if (inputDualisEmail) inputDualisEmail.value = localStorage.getItem('learnspace_dualis_email') || '';
    if (inputDualisPassword) inputDualisPassword.value = localStorage.getItem('learnspace_dualis_password') || '';

    // Check if already connected
    const existingToken = localStorage.getItem('learnspace_google_token');
    if (existingToken && googleBtn) {
        googleBtn.innerHTML = '✅ Google verbunden';
        googleBtn.style.backgroundColor = '#e6f4ea';
        googleBtn.style.color = '#137333';
    }

    // Save and apply settings
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const icalVal = inputIcal ? inputIcal.value.trim() : '';
            const geminiVal = inputGemini ? inputGemini.value.trim() : '';
            const dualisEmailVal = inputDualisEmail ? inputDualisEmail.value.trim() : '';
            const dualisPasswordVal = inputDualisPassword ? inputDualisPassword.value.trim() : '';

            if (icalVal) {
                localStorage.setItem('learnspace_ical_url', icalVal);
                window.USER_ICAL_URL = icalVal;
            }
            if (geminiVal) {
                localStorage.setItem('learnspace_gemini_key', geminiVal);
                window.USER_GEMINI_KEY = geminiVal;
            }
            if (dualisEmailVal) {
                localStorage.setItem('learnspace_dualis_email', dualisEmailVal);
                window.USER_DUALIS_EMAIL = dualisEmailVal;
            }
            if (dualisPasswordVal) {
                localStorage.setItem('learnspace_dualis_password', dualisPasswordVal);
                window.USER_DUALIS_PASSWORD = dualisPasswordVal;
            }

            // Visual feedback
            const originalText = saveBtn.textContent;
            saveBtn.textContent = 'Gespeichert! ✓';
            saveBtn.style.backgroundColor = '#10b981'; // Green

            setTimeout(() => {
                saveBtn.textContent = originalText;
                saveBtn.style.backgroundColor = '';
            }, 2000);

            // Trigger calendar reload
            window.dispatchEvent(new CustomEvent('setup-completed'));
        });
    }

    // ── Google Auth Button ──────────────────────────────
    // GSI might not be loaded yet – retry with polling
    if (googleBtn) {
        initGoogleAuth(googleBtn);
    }
}

function initGoogleAuth(btn) {
    // Wait for GSI library to be available
    let attempts = 0;
    const maxAttempts = 20; // ~10 seconds

    function tryInit() {
        attempts++;
        if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
            const client = google.accounts.oauth2.initTokenClient({
                client_id: GOOGLE_CLIENT_ID,
                scope: GOOGLE_SCOPES,
                callback: (tokenResponse) => {
                    if (tokenResponse && tokenResponse.access_token) {
                        localStorage.setItem('learnspace_google_token', tokenResponse.access_token);
                        window.USER_GOOGLE_TOKEN = tokenResponse.access_token;
                        btn.innerHTML = '✅ Erfolgreich verbunden';
                        btn.style.backgroundColor = '#e6f4ea';
                        btn.style.color = '#137333';
                    }
                },
            });

            btn.addEventListener('click', () => {
                client.requestAccessToken();
            });

            console.log('Google Auth initialized successfully.');
        } else if (attempts < maxAttempts) {
            setTimeout(tryInit, 500);
        } else {
            console.warn('Google Identity Services library could not be loaded after 10s.');
            btn.addEventListener('click', () => {
                alert('Google Identity Services konnte nicht geladen werden. Bitte prüfe deine Internetverbindung und lade die Seite neu.');
            });
        }
    }

    tryInit();
}

document.addEventListener('DOMContentLoaded', initSettings);
