// js/grades.js

export function initGrades() {
    const syncBtn = document.getElementById('sync-grades-btn');
    const container = document.getElementById('grades-container');

    if (!syncBtn || !container) return;

    const cachedGrades = localStorage.getItem('learnspace_dualis_cache');
    if (cachedGrades) {
        try {
            const data = JSON.parse(cachedGrades);
            renderGrades(data, container);
        } catch (e) {
            console.error("Cached grades error", e);
        }
    }

    syncBtn.addEventListener('click', async () => {
        const email = localStorage.getItem('learnspace_dualis_email');
        const password = localStorage.getItem('learnspace_dualis_password');

        if (!email || !password) {
            alert('Bitte trage zuerst deine Dualis E-Mail und Passwort in den Einstellungen ein.');
            const settingsBtn = document.querySelector('button[data-target="settings"]');
            if (settingsBtn) settingsBtn.click();
            return;
        }

        container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:2rem;">Synchronisiere mit DHBW CampusNet... Bitte warten.</p>';
        syncBtn.disabled = true;
        syncBtn.textContent = 'Lädt...';

        // Lokal zuerst versuchen, dann Railway als Fallback
        const LOCAL_URL  = 'http://localhost:8082/api/dualis';
        const REMOTE_URL = 'https://jan-manganous-lashunda.ngrok-free.dev/api/dualis';

        try {
            let res;
            try {
                res = await fetch(LOCAL_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
            } catch (_) {
                // Lokaler Server nicht erreichbar → Railway verwenden
                res = await fetch(REMOTE_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
            }

            if (!res.ok) throw new Error('Netzwerkfehler');

            const data = await res.json();

            if (data.error) {
                container.innerHTML = `<p style="color:var(--accent-red); text-align:center; padding:2rem;">Fehler: ${data.error}</p>`;
            } else if (data.success) {
                localStorage.setItem('learnspace_dualis_cache', JSON.stringify(data.modules));
                renderGrades(data.modules, container);
            }
        } catch (err) {
            container.innerHTML = `<p style="color:var(--accent-red); text-align:center; padding:2rem;">Verbindungsfehler. Bitte erneut versuchen.</p>`;
            console.error("Grades fetch error:", err);
        } finally {
            syncBtn.disabled = false;
            syncBtn.textContent = 'Noten synchronisieren';
        }
    });
}

function parsePointsString(val) {
    if (!val) return null;
    let m = val.match(/^(\d+)(?:,(\d+))?$/);
    if (m) {
        return parseFloat(`${m[1]}.${m[2] || '0'}`);
    }
    return null;
}

function formatGrade(num) {
    if (num === null || isNaN(num)) return '-';
    // Single decimal place, German format
    return num.toFixed(1).replace('.', ',');
}

// Map a module name to a nice color
function getThemeColor(name) {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

// Score parsing logic to DHBW German grade mapping
function convertPointsToGrade(points, subName) {
    if (points <= 5.0) return points; // Already a grade

    let maxPoints = 100;

    // Check if max points in name like "- 60" or "- 20"
    let mTrailing = subName.match(/-\s*(\d+)\s*$/);
    let mPercent = subName.match(/(\d+)\s*%/);

    if (mTrailing) {
        maxPoints = parseFloat(mTrailing[1]);
    } else if (mPercent) {
        // Percentage often out of 120 total max
        maxPoints = 120 * (parseFloat(mPercent[1]) / 100);
    } else {
        // Heuristic fallback if not specified
        if (points <= 20) maxPoints = 20;
        else if (points <= 60) maxPoints = 60;
        else if (points <= 90) maxPoints = 90;
        else if (points <= 100) maxPoints = 100;
        else maxPoints = 120;
    }

    let percent = points / maxPoints;
    let grade = 4.0 - 3.0 * ((percent - 0.5) / 0.5);
    if (grade < 1.0) grade = 1.0;
    if (grade > 5.0) grade = 5.0;

    return Math.round(grade * 10) / 10;
}

// Convert "WiSe 2025/26" to chronological score
function getSemesterScore(name) {
    let m = name.match(/(WiSe|SoSe)\s+(\d{4})/);
    if (!m) return -1; // Unrecognized
    let term = m[1] === 'WiSe' ? 2 : 1;
    let year = parseInt(m[2]);
    return year * 10 + term;
}

function renderGrades(modules, container) {
    if (!modules || modules.length === 0) {
        container.innerHTML = '<p style="text-align:center;">Keine Noten gefunden.</p>';
        return;
    }

    container.innerHTML = '';

    // Filter to WiSe 2025/26 and newer only
    const CUTOFF_SCORE = 20252; // WiSe 2025/26 is year 2025, term 2

    const filteredModules = modules.filter(mod => {
        let score = getSemesterScore(mod.semester || '');
        return score >= CUTOFF_SCORE;
    });

    if (filteredModules.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Alle deine Noten sind älter als WiSe 2025/26. Nichts anzuzeigen.</p>';
        return;
    }

    // Group by semester
    const semestersMap = new Map();
    filteredModules.forEach(mod => {
        const semName = mod.semester || 'Unbekanntes Semester';
        if (!semestersMap.has(semName)) {
            semestersMap.set(semName, []);
        }
        semestersMap.get(semName).push(mod);
    });

    let overallSum = 0;
    let overallCount = 0;

    for (const [semester, mods] of semestersMap.entries()) {

        // Wrap semester in a collapsible <details> HTML5 element
        const detailsEl = document.createElement('details');
        detailsEl.open = true; // Open by default
        detailsEl.style.marginBottom = '1.5rem';

        const summaryEl = document.createElement('summary');
        summaryEl.style.fontSize = '1.2rem';
        summaryEl.style.fontWeight = 'bold';
        summaryEl.style.cursor = 'pointer';
        summaryEl.style.padding = '0.5rem 0';
        summaryEl.style.borderBottom = '1px solid var(--border-color)';
        summaryEl.style.marginBottom = '1rem';
        summaryEl.style.color = 'var(--text-main)';
        summaryEl.style.outline = 'none';
        summaryEl.textContent = semester;

        detailsEl.appendChild(summaryEl);

        const listContainer = document.createElement('div');
        listContainer.style.display = 'flex';
        listContainer.style.flexDirection = 'column';
        listContainer.style.gap = '1rem';

        let semSum = 0;
        let semCount = 0;

        mods.forEach(mod => {
            let finalGradeNum = parsePointsString(mod.grade);
            let isProvisional = false;

            // If main grade missing, sum up and average subgrade equivalents
            if (finalGradeNum === null && mod.sub_grades && mod.sub_grades.length > 0) {
                let subsum = 0;
                let subcount = 0;
                mod.sub_grades.forEach(sg => {
                    let pts = parsePointsString(sg.points);
                    if (pts !== null && !isNaN(pts)) {
                        let gradeVal = convertPointsToGrade(pts, sg.name);
                        subsum += gradeVal;
                        subcount++;
                    }
                });
                if (subcount > 0) {
                    finalGradeNum = subsum / subcount;
                    isProvisional = true;
                }
            }

            if (finalGradeNum !== null) {
                semSum += finalGradeNum;
                semCount++;
                overallSum += finalGradeNum;
                overallCount++;
            }

            let displayGrade = finalGradeNum !== null ? formatGrade(finalGradeNum) : '-';

            // Re-map statuses appropriately
            let statusText = mod.status || '';
            let rawGradeLower = (mod.grade || '').toLowerCase();

            if (rawGradeLower.includes('noch nicht gesetzt') && !isProvisional) {
                statusText = 'noch nicht gesetzt';
            } else if (isProvisional) {
                statusText = 'noch ausstehend'; // Short and concise for provisional UI
            } else if (statusText.trim() === '' && finalGradeNum !== null) {
                statusText = finalGradeNum <= 4.0 ? 'bestanden' : 'nicht bestanden';
            } else if (statusText.trim() === '') {
                statusText = 'ausstehend';
            }

            const isPassed = statusText.toLowerCase().includes('bestanden') || (!statusText.toLowerCase().includes('nicht') && finalGradeNum !== null && finalGradeNum <= 4.0);
            const isMissing = statusText.includes('nicht gesetzt') || statusText.includes('ausstehend') || displayGrade === '-';

            const badgeColor = isMissing ? 'var(--text-muted)' : (isPassed ? '#10b981' : '#ef4444');
            const badgeBg = isMissing ? 'var(--bg-main)' : (isPassed ? '#ecfdf5' : '#fef2f2');

            // Subgrades UI
            let subGradesHtml = '';
            if (mod.sub_grades && mod.sub_grades.length > 0) {
                subGradesHtml = `
                <div style="margin-top: 0.8rem; padding-top: 0.8rem; border-top: 1px dashed var(--border-color);">
                    <span style="font-size:0.85rem; color:var(--text-muted); margin-bottom: 0.5rem; display:block;">Teilleistungen</span>
                    <ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.4rem;">
                        ${mod.sub_grades.map(sg => {
                    let sgPts = parsePointsString(sg.points);
                    let sgGradeStr = "";
                    if (sgPts !== null && sgPts > 5.0) {
                        // Add small provisional grade bubble next to points
                        let conv = convertPointsToGrade(sgPts, sg.name);
                        sgGradeStr = `<span style="font-size:0.8rem; opacity:0.6; margin-left:8px;">(~${formatGrade(conv)})</span>`;
                    }
                    return `
                            <li style="display:flex; justify-content:space-between; font-size:0.9rem;">
                                <span>${sg.name}</span>
                                <div><span style="font-weight:600;">${sg.points}</span>${sgGradeStr}</div>
                            </li>`;
                }).join('')}
                    </ul>
                </div>`;
            }

            const tColor = getThemeColor(mod.name);
            const card = document.createElement('div');
            card.style.background = 'var(--bg-panel)';
            card.style.borderRadius = 'var(--radius-lg)';
            card.style.border = '1px solid var(--border-color)';
            card.style.borderLeft = `6px solid ${tColor}`;
            card.style.padding = '1.2rem';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.gap = '0.5rem';

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <div style="font-size:0.85rem; color:var(--text-muted); display:flex; align-items:center; gap:8px;">
                            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${tColor};"></span>
                            ${mod.module_id} • ${mod.credits} ECTS
                        </div>
                        <h3 style="margin: 0.4rem 0 0.2rem 0; font-size:1.1rem; color:var(--text-main);">${mod.name}</h3>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:1.4rem; font-weight:700; color:var(--text-main);">${displayGrade}</div>
                        <div style="font-size:0.75rem; padding:2px 8px; border-radius:4px; background:${badgeBg}; color:${badgeColor}; display:inline-block; margin-top:4px;">
                            ${statusText}
                        </div>
                    </div>
                </div>
                ${subGradesHtml}
            `;

            listContainer.appendChild(card);
        });

        detailsEl.appendChild(listContainer);

        if (semCount > 0) {
            const semAvg = semSum / semCount;
            const avgDiv = document.createElement('div');
            avgDiv.style.textAlign = 'right';
            avgDiv.style.fontSize = '0.9rem';
            avgDiv.style.color = 'var(--text-muted)';
            avgDiv.style.marginTop = '0.8rem';
            avgDiv.innerHTML = `<strong>Schnitt (${semester}): ${formatGrade(semAvg)}</strong>`;
            detailsEl.appendChild(avgDiv);
        }

        container.appendChild(detailsEl);
    }

    if (overallCount > 0) {
        const overallAvg = overallSum / overallCount;
        const totalDiv = document.createElement('div');
        totalDiv.style.marginTop = '2rem';
        totalDiv.style.padding = '1.5rem';
        totalDiv.style.background = 'linear-gradient(135deg, #3b82f6, #8b5cf6)';
        totalDiv.style.color = 'white';
        totalDiv.style.borderRadius = 'var(--radius-lg)';
        totalDiv.style.display = 'flex';
        totalDiv.style.justifyContent = 'space-between';
        totalDiv.style.alignItems = 'center';
        totalDiv.style.boxShadow = '0 10px 25px -5px rgba(59, 130, 246, 0.4)';

        totalDiv.innerHTML = `
            <div>
                <h3 style="margin:0; font-size:1.2rem;">Gesamtdurchschnitt</h3>
                <span style="font-size:0.85rem; opacity:0.9;">Basiert auf ${overallCount} Modulen/Teilleistungen seit WiSe 2025/26</span>
            </div>
            <div style="font-size:2rem; font-weight:bold; background:rgba(255,255,255,0.2); padding: 5px 15px; border-radius:12px;">
                Ø ${formatGrade(overallAvg)}
            </div>
        `;
        container.appendChild(totalDiv);
    }
}

document.addEventListener('DOMContentLoaded', initGrades);
