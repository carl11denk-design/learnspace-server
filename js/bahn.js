// js/bahn.js — DB Verbindungen Tab
// Verwendet die öffentliche transport.rest Hafas API (kein lokaler Server nötig)

// Läuft lokal: Anfragen gehen über server.py (kein CORS-Problem)
// Läuft online: Anfragen gehen direkt zur Hafas-API
const LOCAL_API    = 'http://localhost:8082/api/bahn';
const RAILWAY_API  = 'https://jan-manganous-lashunda.ngrok-free.dev/api/bahn';
const REMOTE_API   = 'https://v6.db.transport.rest'; // Direkter Fallback

// Exit direction rules per station and platform
const EXIT_RULES = {
    'Stuttgart Hbf': {
        defaultSide: 'links',
        exceptions: {}
    },
    'Mannheim Hbf': {
        defaultSide: 'rechts',
        exceptions: {}
    }
};

function getExitSide(station, gleisText) {
    if (!gleisText) return null;
    const gleisNum = parseInt(gleisText.replace(/[^\d]/g, ''));
    if (isNaN(gleisNum)) return null;
    const rule = EXIT_RULES[station];
    if (!rule) return null;
    if (rule.exceptions[gleisNum]) return rule.exceptions[gleisNum];
    return rule.defaultSide;
}

// Bahnhof-Name → Hafas Station ID
async function lookupStation(name) {
    const url = `${TRANSPORT_API}/locations?query=${encodeURIComponent(name)}&results=1&stops=true&addresses=false&poi=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Station-Suche fehlgeschlagen (${res.status})`);
    const data = await res.json();
    if (!data || data.length === 0) throw new Error(`Bahnhof nicht gefunden: "${name}"`);
    return { id: data[0].id, name: data[0].name };
}

// Verbindungen von Hafas holen
async function fetchJourneys(fromId, toId, results = 6) {
    const url = `${TRANSPORT_API}/journeys?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}&results=${results}&language=de&stopovers=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Verbindungssuche fehlgeschlagen (${res.status})`);
    return await res.json();
}

// ISO-Zeitstring → "HH:MM"
function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toTimeString().slice(0, 5);
}

// Dauer zwischen zwei ISO-Zeitstrings berechnen
function formatDuration(depIso, arrIso) {
    if (!depIso || !arrIso) return '';
    const diff = Math.round((new Date(arrIso) - new Date(depIso)) / 60000);
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return h > 0 ? `${h}h ${m}min` : `${m} Minuten`;
}

// Hafas-Auslastung → lesbaren Text umwandeln
function parseLoadFactor(lf) {
    const map = {
        'low-to-medium': 'Geringe Auslastung',
        'high':          'Hohe Auslastung',
        'very-high':     'Sehr hohe Auslastung',
        'exceptionally-high': 'Sehr hohe Auslastung'
    };
    return map[lf] || '';
}

// Hafas-Response ins Format umwandeln das renderConnections erwartet
function transformJourneys(journeysData, originName, destName) {
    const connections = [];

    for (const journey of journeysData.journeys || []) {
        const legs = journey.legs || [];
        if (legs.length === 0) continue;

        const firstLeg = legs[0];
        const lastLeg  = legs[legs.length - 1];

        // Hauptzug (erstes Leg mit Linie)
        const trainLeg  = legs.find(l => l.line) || firstLeg;
        const trainName = trainLeg.line ? trainLeg.line.name : '';

        const depPlanned = formatTime(firstLeg.plannedDeparture);
        const dep        = formatTime(firstLeg.departure) || depPlanned;
        const arrPlanned = formatTime(lastLeg.plannedArrival);
        const arr        = formatTime(lastLeg.arrival) || arrPlanned;

        const duration = formatDuration(
            firstLeg.departure || firstLeg.plannedDeparture,
            lastLeg.arrival    || lastLeg.plannedArrival
        );

        const depPlatform = firstLeg.departurePlatform        || firstLeg.plannedDeparturePlatform || '';
        const arrPlatform = lastLeg.arrivalPlatform           || lastLeg.plannedArrivalPlatform    || '';
        const loadFactor  = parseLoadFactor(trainLeg.loadFactor);

        // Warnungen (Ausfall, Verspätung etc.)
        let warning = '';
        if (firstLeg.cancelled) {
            warning = 'Fahrt fällt aus';
        } else if (journey.remarks) {
            const w = journey.remarks.find(r => r.type === 'warning' || r.type === 'hint');
            if (w) warning = w.text || '';
        }

        connections.push({
            departure:          dep,
            departure_planned:  depPlanned,
            arrival:            arr,
            arrival_planned:    arrPlanned,
            duration,
            train:              trainName,
            dep_platform:       depPlatform,
            arr_platform:       arrPlatform,
            load:               loadFactor,
            price:              '',
            warning
        });
    }

    return { success: true, connections, origin: originName, destination: destName };
}

export function initBahn() {
    const searchBtn  = document.getElementById('bahn-search-btn');
    const container  = document.getElementById('bahn-results');
    const originInput = document.getElementById('bahn-origin');
    const destInput  = document.getElementById('bahn-destination');
    const swapBtn    = document.getElementById('bahn-swap');

    if (!searchBtn || !container) return;

    // Gecachte Ergebnisse laden
    const cached = localStorage.getItem('learnspace_bahn_cache');
    if (cached) {
        try { renderConnections(JSON.parse(cached), container); } catch (e) { /* ignorieren */ }
    }

    // Tauschen-Button
    if (swapBtn) {
        swapBtn.addEventListener('click', () => {
            const tmp = originInput.value;
            originInput.value = destInput.value;
            destInput.value   = tmp;
        });
    }

    searchBtn.addEventListener('click', async () => {
        const origin      = originInput ? originInput.value.trim() : 'Stuttgart Hbf';
        const destination = destInput   ? destInput.value.trim()   : 'Mannheim Hbf';

        if (!origin || !destination) {
            alert('Bitte Start und Ziel eingeben.');
            return;
        }

        container.innerHTML = `
            <div class="bahn-loading">
                <div class="bahn-spinner"></div>
                <p>Suche Verbindungen…</p>
                <small>Normalerweise fertig in 1–2 Sekunden</small>
            </div>`;
        searchBtn.disabled    = true;
        searchBtn.textContent = '⏳ Suche…';

        try {
            let data;

            // 1. Lokalen Server versuchen → 2. Railway → 3. Direkt zur Hafas-API
            const postOpts = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ origin, destination })
            };
            try {
                const res = await fetch(LOCAL_API, postOpts);
                data = await res.json();
            } catch (_) {
                try {
                    const res = await fetch(RAILWAY_API, postOpts);
                    data = await res.json();
                } catch (__) {
                    // Letzter Fallback: direkt zur Hafas-API
                    const [fromStation, toStation] = await Promise.all([
                        lookupStation(origin),
                        lookupStation(destination)
                    ]);
                    const journeysData = await fetchJourneys(fromStation.id, toStation.id);
                    data = transformJourneys(journeysData, fromStation.name, toStation.name);
                }
            }

            if (data.error) {
                container.innerHTML = `<div class="bahn-error">Fehler: ${data.error}</div>`;
            } else if (data.connections && data.connections.length === 0) {
                container.innerHTML = '<div class="bahn-empty">Keine Verbindungen gefunden.</div>';
            } else {
                localStorage.setItem('learnspace_bahn_cache', JSON.stringify(data));
                renderConnections(data, container);
            }

        } catch (err) {
            container.innerHTML = `<div class="bahn-error">Fehler: ${err.message}<br><small>Bitte Bahnhofsnamen prüfen und erneut versuchen.</small></div>`;
            console.error('Bahn API Fehler:', err);
        } finally {
            searchBtn.disabled    = false;
            searchBtn.textContent = 'Verbindung suchen';
        }
    });
}

function renderConnections(data, container) {
    const connections = data.connections || [];
    const origin      = data.origin      || '';
    const destination = data.destination || '';

    if (connections.length === 0) {
        container.innerHTML = '<div class="bahn-empty">Keine Verbindungen gefunden.</div>';
        return;
    }

    container.innerHTML = '';

    // Datumsheader
    const now        = new Date();
    const dayNames   = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                        'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    const dateStr    = `${dayNames[now.getDay()]}. ${now.getDate()}. ${monthNames[now.getMonth()]} ${now.getFullYear()}`;

    const dateHeader = document.createElement('div');
    dateHeader.className   = 'bahn-date-header';
    dateHeader.innerHTML   = `<strong>Einfache Fahrt</strong>&nbsp; ${dateStr}`;
    container.appendChild(dateHeader);

    connections.forEach(c => {
        const card = document.createElement('div');
        card.className = 'bahn-card';

        const hasDepDelay = c.departure !== c.departure_planned;
        const hasArrDelay = c.arrival   !== c.arrival_planned;

        const depPlannedClass = hasDepDelay ? 'bahn-time-planned has-delay' : 'bahn-time-planned';
        const arrPlannedClass = hasArrDelay ? 'bahn-time-planned has-delay' : 'bahn-time-planned';

        const depActualHtml = hasDepDelay
            ? `<div class="bahn-time-actual delayed">${c.departure}</div>`
            : `<div class="bahn-time-actual ontime">${c.departure}</div>`;

        const arrActualHtml = hasArrDelay
            ? `<div class="bahn-time-actual delayed">${c.arrival}</div>`
            : `<div class="bahn-time-actual ontime">${c.arrival}</div>`;

        const timeGrid = `
            <div class="bahn-times-grid">
                <div class="bahn-time-col">
                    <div class="${depPlannedClass}">${c.departure_planned}</div>
                    ${depActualHtml}
                </div>
                <div class="bahn-time-separator">–</div>
                <div class="bahn-time-col">
                    <div class="${arrPlannedClass}">${c.arrival_planned}</div>
                    ${arrActualHtml}
                </div>
                <div class="bahn-time-duration">|&nbsp; ${c.duration || ''}</div>
            </div>`;

        let loadHtml = '';
        if (c.load) {
            let loadClass = 'low';
            if (c.load.toLowerCase().includes('mittle')) loadClass = 'medium';
            else if (c.load.toLowerCase().includes('hoh'))  loadClass = 'high';
            loadHtml = `<span class="bahn-load bahn-load--${loadClass}">${c.load} 🧑‍🤝‍🧑</span>`;
        }

        const trainBar = `
            <div class="bahn-train-bar">
                <span class="bahn-train-name">${c.train || 'Zug'}</span>
            </div>
            <div class="bahn-stations">
                <span>${origin}</span>
                <span>${destination}</span>
            </div>`;

        const depGleis = c.dep_platform || '–';
        const arrGleis = c.arr_platform || '–';
        const depExit  = c.dep_platform ? getExitSide(origin, c.dep_platform)      : null;
        const arrExit  = c.arr_platform ? getExitSide(destination, c.arr_platform) : null;

        const depExitHtml = depExit
            ? `<span class="bahn-exit bahn-exit--${depExit}">🚪 ${depExit === 'links' ? '⬅ Links' : '➡ Rechts'} aussteigen</span>`
            : '';
        const arrExitHtml = arrExit
            ? `<span class="bahn-exit bahn-exit--${arrExit}">🚪 ${arrExit === 'links' ? '⬅ Links' : '➡ Rechts'} aussteigen</span>`
            : '';

        const platformHtml = `
            <div class="bahn-card-details" style="display: none;">
                <div class="bahn-platforms">
                    <div class="bahn-platform-item">
                        <span class="bahn-station-detail">${origin}:</span>
                        <span class="bahn-gleis-badge">${depGleis !== '–' ? 'Gl. ' + depGleis : 'Gl. unbekannt'}</span>
                        ${depExitHtml}
                    </div>
                    <div class="bahn-platform-item">
                        <span class="bahn-station-detail">${destination}:</span>
                        <span class="bahn-gleis-badge">${arrGleis !== '–' ? 'Gl. ' + arrGleis : 'Gl. unbekannt'}</span>
                        ${arrExitHtml}
                    </div>
                </div>
            </div>`;

        let warningHtml = '';
        if (c.warning) {
            warningHtml = `<div class="bahn-warning">⚠ ${c.warning}</div>`;
        }

        const priceHtml = c.price
            ? `<div class="bahn-price-section">
                   <div class="bahn-price-label">ab</div>
                   <div class="bahn-price-value">${c.price.replace('ab ', '')}</div>
               </div>`
            : '';

        card.innerHTML = `
            <div class="bahn-card-main">
                <div class="bahn-card-left">
                    <div class="bahn-time-row">
                        ${timeGrid}
                        <div class="bahn-load-area">${loadHtml}</div>
                    </div>
                    ${trainBar}
                    ${warningHtml}
                </div>
                <div class="bahn-card-right">
                    <div class="bahn-expand-icon">⋁</div>
                    ${priceHtml}
                </div>
            </div>
            ${platformHtml}
        `;

        card.style.cursor = 'pointer';
        card.addEventListener('click', () => {
            const details = card.querySelector('.bahn-card-details');
            if (details) {
                const isHidden = details.style.display === 'none';
                details.style.display = isHidden ? 'block' : 'none';
                card.classList.toggle('expanded', isHidden);
                const icon = card.querySelector('.bahn-expand-icon');
                if (icon) icon.textContent = isHidden ? '⋀' : '⋁';
            }
        });

        container.appendChild(card);
    });
}

document.addEventListener('DOMContentLoaded', initBahn);
