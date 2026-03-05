// js/cloud.js — Firebase Firestore Cloud Sync (vereinfacht, kein Firebase Auth nötig)

import { initializeApp }          from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc }
    from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyBiANf5gJ0uDlQ2POSo19SLwOGfRMJILdk",
    authDomain:        "learnspace-1c4d2.firebaseapp.com",
    projectId:         "learnspace-1c4d2",
    storageBucket:     "learnspace-1c4d2.firebasestorage.app",
    messagingSenderId: "699822836714",
    appId:             "1:699822836714:web:49e51e2ce2b0e116ad4093"
};

// Welche Daten werden synchronisiert (Passwörter NIEMALS!)
const SYNC_KEYS = [
    'learnspace_notes_v2',
    'learnspace_note_folders_v2',
    'learnspace_kanban_v2',
    'learnspace_habits_v2',
    'learnspace_habit_logs_v2',
    'learnspace_ical_url',
    'learnspace_gemini_key',
    'learnspace_dualis_email',
];

const app = initializeApp(FIREBASE_CONFIG);
const db  = getFirestore(app);

let userEmail  = null;
let syncActive = false;
const _origSet = localStorage.setItem.bind(localStorage);

// Wird von auth.js nach dem Login aufgerufen
export async function connectToCloud(email) {
    userEmail = email.replace(/\./g, '_'); // Punkte ersetzen (Firestore mag keine Punkte in IDs)
    console.log('☁️ Verbinde mit Cloud für:', email);

    try {
        const changed = await loadFromCloud();
        startAutoSync();

        if (changed && !sessionStorage.getItem('cloud_synced')) {
            sessionStorage.setItem('cloud_synced', '1');
            console.log('☁️ Neue Daten gefunden – Seite wird neu geladen...');
            window.location.reload();
        } else {
            console.log('☁️ Cloud-Sync aktiv!');
        }
    } catch (e) {
        console.warn('☁️ Fehler beim Cloud-Connect:', e.message);
    }
}

// Daten aus Firestore → localStorage
async function loadFromCloud() {
    const snap = await getDoc(doc(db, 'users', userEmail));
    if (!snap.exists()) {
        console.log('☁️ Noch keine Cloud-Daten vorhanden (erster Login)');
        return false;
    }
    const data    = snap.data();
    let   changed = false;
    for (const key of SYNC_KEYS) {
        if (data[key] !== undefined && localStorage.getItem(key) !== data[key]) {
            _origSet(key, data[key]);
            changed = true;
        }
    }
    return changed;
}

// Auto-Sync: Jede localStorage-Änderung automatisch in Cloud speichern
let _syncTimers = {};
function startAutoSync() {
    if (syncActive) return;
    syncActive = true;

    localStorage.setItem = function(key, value) {
        _origSet(key, value);
        if (userEmail && SYNC_KEYS.includes(key)) {
            clearTimeout(_syncTimers[key]);
            _syncTimers[key] = setTimeout(async () => {
                try {
                    await setDoc(doc(db, 'users', userEmail), { [key]: value }, { merge: true });
                    console.log('☁️ Gespeichert:', key);
                } catch (e) {
                    console.warn('☁️ Sync-Fehler:', key, e.message);
                }
            }, 1500);
        }
    };
}
