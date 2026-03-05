// js/cloud.js — Firebase Firestore Cloud Sync
// Wird als normales Script geladen (kein ES Module)

(function() {
    'use strict';

    var FIREBASE_CONFIG = {
        apiKey:            "AIzaSyBiANf5gJ0uDlQ2POSo19SLwOGfRMJILdk",
        authDomain:        "learnspace-1c4d2.firebaseapp.com",
        projectId:         "learnspace-1c4d2",
        storageBucket:     "learnspace-1c4d2.firebasestorage.app",
        messagingSenderId: "699822836714",
        appId:             "1:699822836714:web:49e51e2ce2b0e116ad4093"
    };

    var SYNC_KEYS = [
        'learnspace_notes_v2',
        'learnspace_note_folders_v2',
        'learnspace_kanban_v2',
        'learnspace_habits_v2',
        'learnspace_habit_logs_v2',
        'learnspace_ical_url',
        'learnspace_gemini_key',
        'learnspace_dualis_email'
    ];

    var db = null;
    var userDocId = null;
    var syncActive = false;
    var _origSet = localStorage.setItem.bind(localStorage);
    var _timers = {};

    // Firebase initialisieren
    try {
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.firestore();
        console.log('☁️ Firebase + Firestore geladen!');
    } catch(e) {
        console.error('☁️ Firebase Init Fehler:', e);
    }

    function emailToId(email) {
        return email.replace(/[@.]/g, '_');
    }

    // Globale Funktion die auth.js aufrufen kann
    window.connectToCloud = function(email) {
        if (!db) {
            console.error('☁️ Firestore nicht verfügbar!');
            return;
        }

        userDocId = emailToId(email);
        console.log('☁️ Verbinde mit Cloud... DocID:', userDocId);

        // Daten aus Cloud laden
        db.collection('users').doc(userDocId).get()
            .then(function(snap) {
                if (!snap.exists) {
                    console.log('☁️ Erster Login – noch keine Cloud-Daten vorhanden');
                } else {
                    var data = snap.data();
                    var changed = false;
                    SYNC_KEYS.forEach(function(key) {
                        if (data[key] !== undefined && localStorage.getItem(key) !== data[key]) {
                            _origSet(key, data[key]);
                            changed = true;
                            console.log('☁️ Aus Cloud geladen:', key);
                        }
                    });

                    if (changed && !sessionStorage.getItem('cloud_synced')) {
                        sessionStorage.setItem('cloud_synced', '1');
                        console.log('☁️ Neue Cloud-Daten → Seite wird neu geladen');
                        window.location.reload();
                        return;
                    }
                }

                // Auto-Sync starten
                startAutoSync();
                console.log('☁️ Cloud-Sync aktiv! Änderungen werden automatisch gespeichert.');
            })
            .catch(function(err) {
                console.error('☁️ Cloud-Fehler:', err.code, err.message);
                // Trotzdem Auto-Sync starten falls nur Lesen fehlschlägt
                startAutoSync();
            });
    };

    function startAutoSync() {
        if (syncActive) return;
        syncActive = true;
        console.log('☁️ Auto-Sync gestartet');

        localStorage.setItem = function(key, value) {
            _origSet(key, value);
            if (!userDocId || SYNC_KEYS.indexOf(key) === -1) return;

            clearTimeout(_timers[key]);
            _timers[key] = setTimeout(function() {
                var update = {};
                update[key] = value;
                db.collection('users').doc(userDocId).set(update, { merge: true })
                    .then(function() {
                        console.log('☁️ In Cloud gespeichert:', key);
                    })
                    .catch(function(err) {
                        console.error('☁️ Speicher-Fehler:', key, err.code, err.message);
                    });
            }, 1500);
        };
    }

})();
