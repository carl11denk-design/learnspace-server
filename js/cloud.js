// js/cloud.js — Firebase Firestore Cloud Sync

import { initializeApp }             from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
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

let app, db;
try {
    app = initializeApp(FIREBASE_CONFIG);
    db  = getFirestore(app);
    console.log('☁️ Firebase geladen');
} catch(e) {
    console.error('☁️ Firebase Init Fehler:', e);
}

let userDocId   = null;
let syncActive  = false;
const _origSet  = localStorage.setItem.bind(localStorage);

// E-Mail → sicherer Firestore-Dokument-Name (kein @ oder .)
function emailToId(email) {
    return email.replace(/[@.]/g, '_');
}

export async function connectToCloud(email) {
    if (!db) { console.error('☁️ Firestore nicht verfügbar'); return; }

    userDocId = emailToId(email);
    console.log('☁️ Verbinde... DocID:', userDocId);

    try {
        const changed = await loadFromCloud();
        startAutoSync();

        if (changed && !sessionStorage.getItem('cloud_synced')) {
            sessionStorage.setItem('cloud_synced', '1');
            console.log('☁️ Neue Cloud-Daten → Seite lädt neu');
            window.location.reload();
        } else {
            console.log('☁️ Cloud-Sync aktiv! Bereit zum Speichern.');
        }
    } catch (e) {
        console.error('☁️ connectToCloud Fehler:', e.code, e.message);
    }
}

async function loadFromCloud() {
    console.log('☁️ Lese Daten aus Firestore...');
    const ref  = doc(db, 'users', userDocId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
        console.log('☁️ Erster Login – noch keine Cloud-Daten');
        return false;
    }

    const data    = snap.data();
    let   changed = false;
    for (const key of SYNC_KEYS) {
        if (data[key] !== undefined && localStorage.getItem(key) !== data[key]) {
            _origSet(key, data[key]);
            changed = true;
            console.log('☁️ Aus Cloud geladen:', key);
        }
    }
    return changed;
}

let _timers = {};
function startAutoSync() {
    if (syncActive) return;
    syncActive = true;
    console.log('☁️ Auto-Sync gestartet');

    localStorage.setItem = function(key, value) {
        _origSet(key, value);
        if (!userDocId || !SYNC_KEYS.includes(key)) return;

        clearTimeout(_timers[key]);
        _timers[key] = setTimeout(async () => {
            try {
                await setDoc(doc(db, 'users', userDocId), { [key]: value }, { merge: true });
                console.log('☁️ In Cloud gespeichert:', key);
            } catch (e) {
                console.error('☁️ Speicher-Fehler:', key, e.code, e.message);
            }
        }, 1500);
    };
}
