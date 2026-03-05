// js/cloud.js — Firebase Firestore Cloud Sync
// Speichert alle Nutzerdaten in der Cloud → überall verfügbar

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc }
    from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, GoogleAuthProvider, signInWithCredential, onAuthStateChanged }
    from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

// ── Firebase Config ────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyBiANf5gJ0uDlQ2POSo19SLwOGfRMJILdk",
    authDomain:        "learnspace-1c4d2.firebaseapp.com",
    projectId:         "learnspace-1c4d2",
    storageBucket:     "learnspace-1c4d2.firebasestorage.app",
    messagingSenderId: "699822836714",
    appId:             "1:699822836714:web:49e51e2ce2b0e116ad4093"
};

// ── Welche Daten werden synchronisiert ────────────────────────────────────
// Passwörter werden NIEMALS in die Cloud gespeichert (Sicherheit)
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

// ── Firebase initialisieren ────────────────────────────────────────────────
const app  = initializeApp(FIREBASE_CONFIG);
const db   = getFirestore(app);
const auth = getAuth(app);

let currentUid   = null;
let syncActive   = false;
const _origSet   = localStorage.setItem.bind(localStorage); // Originale Funktion sichern

// ── Neuer Login: Google-Credential → Firebase Auth → Cloud laden ───────────
export async function connectToCloud(idToken) {
    try {
        const cred    = GoogleAuthProvider.credential(idToken);
        const result  = await signInWithCredential(auth, cred);
        currentUid    = result.user.uid;
        const changed = await loadFromCloud(currentUid);
        startAutoSync();
        // Wenn neue Daten aus Cloud → Seite neu laden damit alle Module aktuell sind
        if (changed && !sessionStorage.getItem('cloud_synced')) {
            sessionStorage.setItem('cloud_synced', '1');
            window.location.reload();
        }
        console.log('☁️ Cloud-Sync aktiv für:', result.user.email);
    } catch (e) {
        console.warn('☁️ Cloud-Verbindung fehlgeschlagen:', e.message);
    }
}

// ── Bestehende Session: Firebase Auth stellt sich automatisch wieder her ───
onAuthStateChanged(auth, async (user) => {
    if (user && !syncActive) {
        currentUid = user.uid;
        const changed = await loadFromCloud(currentUid);
        startAutoSync();
        if (changed && !sessionStorage.getItem('cloud_synced')) {
            sessionStorage.setItem('cloud_synced', '1');
            window.location.reload();
        }
        console.log('☁️ Cloud-Sync wiederhergestellt für:', user.email);
    }
});

// ── Daten aus Firestore → localStorage laden ───────────────────────────────
async function loadFromCloud(uid) {
    try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (!snap.exists()) return false;
        const data    = snap.data();
        let   changed = false;
        for (const key of SYNC_KEYS) {
            if (data[key] !== undefined) {
                const current = localStorage.getItem(key);
                if (current !== data[key]) {
                    _origSet(key, data[key]); // Originale Funktion nutzen (kein Ping-Pong)
                    changed = true;
                }
            }
        }
        if (changed) console.log('☁️ Neuere Daten aus Cloud geladen');
        return changed;
    } catch (e) {
        console.warn('☁️ Laden aus Cloud fehlgeschlagen:', e.message);
        return false;
    }
}

// ── Auto-Sync: localStorage.setItem abfangen → automatisch in Cloud speichern
let _syncTimers = {};
function startAutoSync() {
    if (syncActive) return; // Nur einmal starten
    syncActive = true;

    localStorage.setItem = function(key, value) {
        _origSet(key, value); // Erst lokal speichern
        if (currentUid && SYNC_KEYS.includes(key)) {
            // Debounce: 1,5 Sek nach letzter Änderung in Cloud speichern
            clearTimeout(_syncTimers[key]);
            _syncTimers[key] = setTimeout(async () => {
                try {
                    await setDoc(
                        doc(db, 'users', currentUid),
                        { [key]: value },
                        { merge: true }
                    );
                    console.log('☁️ Gespeichert:', key);
                } catch (e) {
                    console.warn('☁️ Sync-Fehler:', key, e.message);
                }
            }, 1500);
        }
    };
}
