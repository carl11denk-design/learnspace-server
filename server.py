"""
LearnSpace – Lokaler Server
Zuständig für: Dualis-Noten & DB Bahn-Verbindungen
Starten mit:   python3 server.py
Browser:       http://localhost:8082
"""

import http.server
import socketserver
import json
import os
import requests
from bs4 import BeautifulSoup
from functools import partial
from datetime import datetime

# Lokal: Port 8082 | Railway setzt PORT automatisch als Umgebungsvariable
PORT = int(os.environ.get('PORT', 8082))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
TRANSPORT_API = 'https://v6.db.transport.rest'


# ── Dualis ────────────────────────────────────────────────────────────────────

def scrape_dualis(usrname, password):
    session = requests.Session()
    session.headers.update({'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'})

    session.get('https://dualis.dhbw.de/')

    payload = {
        'usrname': usrname, 'pass': password,
        'APPNAME': 'CampusNet', 'PRGNAME': 'LOGINCHECK',
        'ARGUMENTS': 'clino,usrname,pass,menuno,menu_type,browser,platform',
        'clino': '000000000000001', 'menuno': '000324',
        'menu_type': 'classic', 'browser': '', 'platform': ''
    }
    res_post = session.post(
        "https://dualis.dhbw.de/scripts/mgrqispi.dll",
        data=payload, allow_redirects=False
    )

    if 'REFRESH' not in res_post.headers:
        return {"error": "Login fehlgeschlagen. Bitte E-Mail und Passwort prüfen."}

    url_refresh = "https://dualis.dhbw.de" + res_post.headers['REFRESH'].split('URL=')[1].strip()
    res_refresh = session.get(url_refresh)
    res_refresh.encoding = 'utf-8'
    soup_refresh = BeautifulSoup(res_refresh.text, 'html.parser')

    start_link = soup_refresh.find('a', string="Startseite")
    if not start_link:
        return {"error": "Startseite nach Login nicht gefunden."}

    res_main = session.get("https://dualis.dhbw.de" + start_link['href'])
    res_main.encoding = 'utf-8'
    soup_main = BeautifulSoup(res_main.text, 'html.parser')

    grades_link = None
    for a in soup_main.find_all('a'):
        if "prüfung" in a.text.strip().lower() or "ergebnis" in a.text.strip().lower():
            grades_link = a.get('href')
            break

    if not grades_link:
        return {"error": "Link zu 'Prüfungsergebnisse' nicht gefunden."}

    res_grades_init = session.get("https://dualis.dhbw.de" + grades_link)
    res_grades_init.encoding = 'utf-8'
    soup_grades_init = BeautifulSoup(res_grades_init.text, 'html.parser')

    semesters = []
    select = soup_grades_init.find('select', id='semester')
    if select:
        for option in select.find_all('option'):
            semesters.append({'name': option.text.strip(), 'value': option.get('value')})
    else:
        h1 = soup_grades_init.find('h1')
        sem_name = h1.text.strip() if h1 else "Aktuelles Semester"
        semesters.append({'name': sem_name, 'value': 'CURRENT', 'html': res_grades_init.text})

    modules = []
    base_args = grades_link.split('ARGUMENTS=')[1].split(',')

    for sem in semesters:
        if sem['value'] == 'CURRENT':
            soup_grades = BeautifulSoup(sem['html'], 'html.parser')
        else:
            sem_url = (
                f"https://dualis.dhbw.de/scripts/mgrqispi.dll"
                f"?APPNAME=CampusNet&PRGNAME=COURSERESULTS"
                f"&ARGUMENTS={base_args[0]},{base_args[1]},-N{sem['value']}"
            )
            res_sem = session.get(sem_url)
            res_sem.encoding = 'utf-8'
            soup_grades = BeautifulSoup(res_sem.text, 'html.parser')

        rows = soup_grades.select('table.nb.list tbody tr')
        for row in rows:
            tds = row.find_all(['td', 'th'])
            if len(tds) >= 6 and not row.find('th'):
                sub_grades = []
                link_tag = tds[5].find('a')
                if link_tag:
                    details_url = "https://dualis.dhbw.de" + link_tag['href']
                    res_details = session.get(details_url)
                    res_details.encoding = 'utf-8'
                    soup_details = BeautifulSoup(res_details.text, 'html.parser')
                    for d_row in soup_details.select('table.tb tr'):
                        d_tds = d_row.find_all('td')
                        if (len(d_tds) >= 4
                                and d_tds[0].get('colspan') == '2'
                                and d_tds[0].text.strip() == ''):
                            sub_name = d_tds[1].text.strip()
                            if sub_name:
                                sub_grades.append({"name": sub_name, "points": d_tds[3].text.strip()})

                modules.append({
                    "semester":   sem['name'],
                    "module_id":  tds[0].text.strip(),
                    "name":       tds[1].text.strip(),
                    "grade":      tds[2].text.strip(),
                    "credits":    tds[3].text.strip(),
                    "status":     tds[4].text.strip(),
                    "sub_grades": sub_grades
                })

    return {"success": True, "modules": modules}


# ── DB Bahn (via Hafas API – kein Playwright nötig) ───────────────────────────

def fetch_bahn_connections(origin, destination, results=6):
    hdrs = {'User-Agent': 'Mozilla/5.0 (compatible; LearnSpace/1.0)'}

    def lookup(name):
        url = (f"{TRANSPORT_API}/locations"
               f"?query={requests.utils.quote(name)}"
               f"&results=1&stops=true&addresses=false&poi=false")
        r = requests.get(url, headers=hdrs, timeout=25)
        r.raise_for_status()
        data = r.json()
        if not data:
            raise ValueError(f'Bahnhof nicht gefunden: "{name}"')
        return data[0]['id'], data[0]['name']

    from_id, from_name = lookup(origin)
    to_id,   to_name   = lookup(destination)

    url = (f"{TRANSPORT_API}/journeys"
           f"?from={requests.utils.quote(from_id)}"
           f"&to={requests.utils.quote(to_id)}"
           f"&results={results}&language=de&stopovers=false")
    r = requests.get(url, headers=hdrs, timeout=30)
    r.raise_for_status()
    journeys_data = r.json()

    def fmt_time(iso):
        if not iso: return ''
        try:
            dt = datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone()
            return dt.strftime('%H:%M')
        except Exception:
            return iso[11:16] if len(iso) >= 16 else ''

    def fmt_dur(dep_iso, arr_iso):
        if not dep_iso or not arr_iso: return ''
        try:
            dep = datetime.fromisoformat(dep_iso.replace('Z', '+00:00'))
            arr = datetime.fromisoformat(arr_iso.replace('Z', '+00:00'))
            diff = int((arr - dep).total_seconds() / 60)
            h, m = divmod(diff, 60)
            return f'{h}h {m}min' if h else f'{m} Minuten'
        except Exception:
            return ''

    load_map = {
        'low-to-medium': 'Geringe Auslastung',
        'high':          'Hohe Auslastung',
        'very-high':     'Sehr hohe Auslastung',
        'exceptionally-high': 'Sehr hohe Auslastung'
    }

    connections = []
    for journey in journeys_data.get('journeys', []):
        legs = journey.get('legs', [])
        if not legs: continue
        first, last = legs[0], legs[-1]
        train_leg = next((l for l in legs if l.get('line')), first)

        dep_planned = fmt_time(first.get('plannedDeparture'))
        dep         = fmt_time(first.get('departure')) or dep_planned
        arr_planned = fmt_time(last.get('plannedArrival'))
        arr         = fmt_time(last.get('arrival')) or arr_planned
        duration    = fmt_dur(
            first.get('departure') or first.get('plannedDeparture'),
            last.get('arrival')    or last.get('plannedArrival')
        )
        train    = train_leg.get('line', {}).get('name', '') if train_leg.get('line') else ''
        dep_plat = first.get('departurePlatform') or first.get('plannedDeparturePlatform') or ''
        arr_plat = last.get('arrivalPlatform')    or last.get('plannedArrivalPlatform')    or ''
        load     = load_map.get(train_leg.get('loadFactor', ''), '')

        warning = ''
        if first.get('cancelled'):
            warning = 'Fahrt fällt aus'
        else:
            for remark in journey.get('remarks', []):
                if remark.get('type') in ('warning', 'hint'):
                    warning = remark.get('text', '')
                    break

        connections.append({
            'departure': dep, 'departure_planned': dep_planned,
            'arrival':   arr, 'arrival_planned':   arr_planned,
            'duration': duration, 'train': train,
            'dep_platform': dep_plat, 'arr_platform': arr_plat,
            'load': load, 'price': '', 'warning': warning
        })

    return {'success': True, 'connections': connections,
            'origin': from_name, 'destination': to_name}


# ── HTTP Server ───────────────────────────────────────────────────────────────

class APIHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"  → {self.command} {self.path}")

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)

        def send_error_json(code, msg):
            self.send_response(code)
            self.end_headers()
            self.wfile.write(json.dumps({"error": msg}).encode('utf-8'))

        try:
            data = json.loads(post_data.decode('utf-8'))
        except json.JSONDecodeError:
            send_error_json(400, "Ungültiges JSON")
            return

        if self.path == '/api/dualis':
            email    = data.get('email')
            password = data.get('password')
            if not email or not password:
                send_error_json(400, "E-Mail oder Passwort fehlt")
                return
            print(f"  Dualis-Abruf fuer {email}...")
            result = scrape_dualis(email, password)

        elif self.path == '/api/bahn':
            origin      = data.get('origin', 'Stuttgart Hbf')
            destination = data.get('destination', 'Mannheim Hbf')
            print(f"  Bahn-Suche: {origin} -> {destination}...")
            try:
                result = fetch_bahn_connections(origin, destination)
            except Exception as e:
                result = {'error': str(e)}

        else:
            send_error_json(404, "Endpoint nicht gefunden")
            return

        self.send_response(200)
        self.send_header('Content-type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(result, ensure_ascii=False).encode('utf-8'))


if __name__ == "__main__":
    os.chdir(DIRECTORY)
    handler = partial(APIHandler, directory=DIRECTORY)

    print("=" * 50)
    print("  LearnSpace – Lokaler Server")
    print(f"  Läuft auf: http://localhost:{PORT}")
    print("  Stoppen mit: Ctrl + C")
    print("=" * 50)

    with socketserver.TCPServer(("0.0.0.0", PORT), handler) as httpd:
        httpd.serve_forever()
