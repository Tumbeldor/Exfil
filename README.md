# Extraction Looter

Ein **Top-Down Extraction Shooter** im Stil von *Escape from Tarkov* und *DMZ* – spielbar im Browser auf **PC und iPhone**, **solo** oder im **Coop** (bis zu 4 Spieler).

### ▶ Jetzt spielen: **https://tumbeldor.github.io/ExtractionLooter/**

Einfach den Link teilen – Solo und Coop laufen direkt im Browser, ohne Installation und ohne eigenen Server. Für Coop erstellt einer unter **Coop → Lobby erstellen** eine Lobby und schickt den **Einladungslink**; wer ihn öffnet, landet direkt in der Lobby.

Rüste dich im Versteck aus, betritt eine Zone voller Bots, plündere Behälter und Leichen und erreiche eine Extraktion, bevor die Zeit abläuft. Wer stirbt, verliert alles, was er dabeihatte – bis auf den sicheren Behälter.

## Features

- **Zwei Karten**
  - *Grenzstadt* (ab Level 1): Wohnviertel, Rathaus, Supermarkt, Apotheke, Polizei, Industriegebiet und eine Militärbasis mit Boss.
  - *Industriehafen* (ab Level 5): Containerlabyrinth, Lagerhallen, Zollamt mit Tresorraum und ein Frachter mit Boss.
- **Extraktionen wie in Tarkov/DMZ**: immer offen, zufällig verfügbar, zeitgesteuert, bezahlt (Bargeld), mit Schlüssel und **Heli-Exfil** (per Funk rufen, landen lassen, einsteigen – lockt Gegner an).
- **12 Waffen** (Pistolen, MPs, Sturmgewehre, Flinten, Präzisions- und Scharfschützengewehre, MG), **5 Kaliber mit je 2–3 Munitionssorten** (Durchschlag vs. Schutzklasse), Streuung, Rückstoß, Zielen über Kimme/Optik.
- **Panzerung** (Westen Klasse 2–6, Helme Klasse 1–5) mit Haltbarkeit, Kopftreffer, Blutungen, Medizin, Adrenalin, Granaten, Selbstwiederbelebung.
- **Bots** mit Sichtkegel, Gehör, Reaktionszeit, Deckungssuche, Granaten und Squads: *Plünderer*, *Söldner*, *Wachen* und **Bosse** (*Der Kommandant*, *Kapitän Volkov*). Gegnerwellen im Raid.
- **Sichtlinie / Fog of War**: Du siehst Gegner nur in deinem Sichtfeld; Wände blockieren die Sicht, Büsche verbergen. Schritte und Schüsse sind räumlich hörbar.
- **Lager (Vault)** mit Kapazität, Ausrüstungs- und Taschenverwaltung, sicherer Behälter.
- **Plünderer-Einsatz** (wie der Scav-Run): zufällige Gratis-Ausrüstung, Plünderer-Bots bleiben neutral, solange du nicht auf sie schießt – kein Risiko, Beute geht ins Lager (Abklingzeit 10 Min.).
- **Versicherung**: Waffen und Schutzausrüstung gegen Gebühr versichern – nach dem Tod kommen sie (entladen) ins Lager zurück.
- **Progression**: XP & Level (bis 40), **3 Händler** mit Loyalitätsstufen (Major Brandt, Dr. Weiss, Kowalski), **20 Aufträge** (Eliminieren, Erkunden, Extrahieren, Übergeben, Bosse), **Versteck-Ausbau** (Lagerraum, sicherer Behälter, Sanitätsraum, Händlernetz), Reparaturen, Statistiken.
- **Coop**: Lobby mit 4-stelligem Code, gemeinsamer Spawn, Wiederbeleben am Boden liegender Teamkameraden, Markierungen (Ping), Teamanzeige, Reconnect bei Verbindungsabbruch. Jeder behält seine eigene Beute.
- **Steuerung**: Tastatur & Maus, **Touch mit zwei virtuellen Sticks** (iPhone), Gamepad.
- **Komplett prozedural**: Grafik (Canvas) und Sound (WebAudio) werden live erzeugt – keine Asset-Dateien nötig. Als PWA installierbar.

## Schnellstart

Voraussetzung: [Node.js](https://nodejs.org) ≥ 20.

```bash
npm install
npm run build
npm start
```

Dann im Browser **http://localhost:3000** öffnen.

### Auf dem iPhone spielen

1. Server auf dem PC starten (`npm start`).
2. iPhone ins selbe WLAN, in Safari `http://<IP-des-PCs>:3000` öffnen (die IP zeigt z. B. `ipconfig` / `ip addr`).
3. Für Vollbild: **Teilen → „Zum Home-Bildschirm“**, dann über das neue Icon starten.
4. Im Querformat spielen.

### Coop mit Freunden

Es gibt zwei Wege:

**1. Online (direkt, ohne Server)** – Standard auf GitHub Pages
- Einer erstellt unter **Coop → Lobby erstellen** eine Lobby und tippt auf **Einladungslink teilen** (auf dem iPhone öffnet sich das Teilen-Menü, z. B. für WhatsApp).
- Freunde öffnen den Link (oder geben den 4-stelligen Code ein), alle klicken **Bereit**, der Host startet den Raid.
- Die Verbindung läuft per WebRTC direkt zwischen den Browsern ([PeerJS](https://peerjs.com) übernimmt nur das Zusammenbringen und stellt bei Bedarf Relay-Server bereit). Der **Host betreibt den Raid in seinem Browser**: Er muss die Seite geöffnet und – besonders auf dem iPhone – im Vordergrund lassen. Schließt der Host, endet die Lobby für alle.

**2. Eigener Server** – stabiler, unabhängig von einem Host-Gerät
- `npm start` auf einem PC oder einem Server (z. B. per Docker, siehe unten). Der Server liefert Spiel und Coop über **einen Port** (HTTP + WebSocket unter `/ws`).
- Alle öffnen dessen Adresse; der Coop-Bildschirm erkennt den Server automatisch. Im selben WLAN genügt die LAN-Adresse des PCs.
- In den Einstellungen kann auch eine andere Server-Adresse eingetragen werden.

### GitHub Pages einrichten (einmalig)

Das Spiel wird bei jedem Push automatisch gebaut und veröffentlicht (`.github/workflows/pages.yml`). Damit das klappt, muss GitHub Pages einmal aktiviert werden:

**Repository → Settings → Pages → Build and deployment → Source: „GitHub Actions“**

Danach unter **Actions → GitHub Pages → Run workflow** einmal starten (oder einfach etwas pushen). Die Adresse lautet `https://<benutzername>.github.io/ExtractionLooter/`.

### Docker

```bash
docker build -t extraction-looter .
docker run -p 3000:3000 extraction-looter
```

## Steuerung

| Aktion | PC | iPhone / Touch | Gamepad |
| --- | --- | --- | --- |
| Bewegen | WASD | linker Stick | linker Stick |
| Sprinten | Shift | Stick über den Rand ziehen / Sprint-Knopf | L3 / LB |
| Zielen | Maus | rechter Stick | rechter Stick |
| Feuern | Linksklick | rechten Stick weit auslenken (oder Feuerknopf) | RT |
| Genau zielen (Optik) | Rechtsklick halten | Zielfernrohr-Knopf | LT |
| Nachladen | R | ⟳ | X |
| Waffe wechseln | Q / 1 / 2 / Mausrad | ⇄ | Y |
| Interagieren / Durchsuchen | E | Kontext-Knopf | A |
| Inventar | Tab / I | Tasche | Steuerkreuz ↑ |
| Heilen | H (4 Verband, 6 Adrenalin) | ✚ | B |
| Granate | G | Granate | RB |
| Markieren | Z / mittlere Maustaste | Pin / Karte antippen | Steuerkreuz ↓ |
| Karte / Extraktionen | M / O | Karte / Timer antippen | Select / ← |
| Menü | Esc | ❚❚ | Start |

## Entwicklung

```bash
npm run dev        # Vite (Client, Port 5173) + Server (Port 3000) mit Hot-Reload
npm test           # Unit-Tests (Vitest): Inventar, Karten, Pfadfindung, Simulation, Progression
npm run typecheck  # TypeScript-Prüfung
```

### Architektur

```
src/shared/        Gemeinsamer Code für Client und Server
  items.ts         Gegenstandskatalog (Waffen, Munition, Panzerung, Medizin, Beute)
  inventory.ts     Inventar- und Kapazitätslogik
  loot.ts          Beutetabellen, Bot-Ausrüstung
  map/             Kacheln, Kartengenerator (Gebäude mit prozeduralen Räumen), A*-Pfadfindung
  sim/             Simulation: World (Spieler, Kugeln, Granaten, Behälter, Extraktion), Bot-KI, Kampf
  net/             RaidHost (betreibt eine Raid-Instanz) und Netzwerkprotokoll
  profile.ts …     Profil, Händler, Aufträge, Progression
src/client/        Browser: Renderer (Canvas, Fog of War), Eingabe, HUD, Menüs, Audio
src/server/        Node.js: HTTP + WebSocket, Lobbys, Coop-Raids
```

Die Simulation läuft mit festen 30 Ticks/s. **Solo** betreibt den `RaidHost` direkt im Browser, im **Coop** läuft derselbe Code auf dem Server. Die eigene Bewegung und das eigene Schießen werden lokal vorhergesagt (kein Input-Lag), der Host prüft Bewegungen auf Plausibilität und berechnet Treffer, Bots und Beute autoritativ. Andere Spieler und Bots werden zwischen Snapshots interpoliert.

Der Spielstand liegt im `localStorage` des Browsers. Unter **Versteck → Profil** lässt er sich als Code exportieren/importieren (z. B. vom PC aufs iPhone).
