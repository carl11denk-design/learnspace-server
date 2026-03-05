// js/auth.js — Google Sign-In für LearnSpace

import { connectToCloud } from './cloud.js';

const CLIENT_ID   = '1075497087840-g6fj2olui0p5r4if1otan841n6hs8j0q.apps.googleusercontent.com';
const STORAGE_KEY = 'learnspace_user';

// Beim Laden der Seite prüfen ob User schon eingeloggt ist
document.addEventListener('DOMContentLoaded', () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            const user = JSON.parse(stored);
            showApp(user);
        } catch {
            localStorage.removeItem(STORAGE_KEY);
            showLoginScreen();
        }
    } else {
        showLoginScreen();
    }
});

function showLoginScreen() {
    const loginScreen   = document.getElementById('login-screen');
    const appContainer  = document.querySelector('.app-container');
    if (loginScreen)  loginScreen.style.display  = 'flex';
    if (appContainer) appContainer.style.display = 'none';

    // Warte bis Google GSI geladen ist, dann Button rendern
    let attempts = 0;
    function tryInit() {
        attempts++;
        if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
            google.accounts.id.initialize({
                client_id:   CLIENT_ID,
                callback:    handleCredential,
                auto_select: false,
            });
            google.accounts.id.renderButton(
                document.getElementById('g_id_btn'),
                { theme: 'filled_blue', size: 'large', text: 'signin_with', locale: 'de', width: 280 }
            );
        } else if (attempts < 30) {
            setTimeout(tryInit, 300);
        }
    }
    tryInit();
}

async function handleCredential(response) {
    // JWT-Payload dekodieren um Nutzerinfos zu erhalten
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    const user = {
        name:    payload.name,
        email:   payload.email,
        picture: payload.picture,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    showApp(user);

    // Mit Firebase verbinden und Daten aus Cloud laden
    await connectToCloud(response.credential);
}

function showApp(user) {
    const loginScreen  = document.getElementById('login-screen');
    const appContainer = document.querySelector('.app-container');
    if (loginScreen)  loginScreen.style.display  = 'none';
    if (appContainer) appContainer.style.display = '';
    updateSidebarUser(user);
}

function updateSidebarUser(user) {
    const el = document.getElementById('sidebar-user');
    if (!el) return;
    el.innerHTML = `
        <img src="${user.picture}" alt="${user.name}"
             style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;">
        <span style="font-size:0.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
            ${user.name.split(' ')[0]}
        </span>
        <button id="logout-btn" title="Abmelden"
                style="background:none;border:none;cursor:pointer;font-size:1.1rem;padding:2px 4px;
                       color:var(--text-muted,#888);flex-shrink:0;"
                aria-label="Abmelden">⏏</button>
    `;
    document.getElementById('logout-btn').addEventListener('click', logout);
}

function logout() {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem('cloud_synced');
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
        google.accounts.id.disableAutoSelect();
    }
    location.reload();
}
