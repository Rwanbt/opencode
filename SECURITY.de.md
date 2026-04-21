<p align="center"><a href="SECURITY.md">English</a> | <a href="SECURITY.zh.md">简体中文</a> | <a href="SECURITY.zht.md">繁體中文</a> | <a href="SECURITY.ko.md">한국어</a> | <b>Deutsch</b> | <a href="SECURITY.es.md">Español</a> | <a href="SECURITY.fr.md">Français</a> | <a href="SECURITY.it.md">Italiano</a> | <a href="SECURITY.da.md">Dansk</a> | <a href="SECURITY.ja.md">日本語</a> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

# Sicherheit

## Wichtig

Wir akzeptieren keine KI-generierten Sicherheitsberichte. Wir erhalten eine große Anzahl davon und haben absolut nicht die Ressourcen, alle zu prüfen. Eine Einreichung führt zur automatischen Sperre vom Projekt.

## Bedrohungsmodell

### Überblick

OpenCode ist ein KI-gestützter Coding-Assistent, der lokal auf Ihrem Rechner läuft. Er bietet ein Agenten-System mit Zugriff auf leistungsstarke Werkzeuge, darunter Shell-Ausführung, Datei-Operationen und Web-Zugriff.

### Keine Sandbox

OpenCode **sandboxt** den Agenten **nicht**. Das Berechtigungssystem existiert als UX-Funktion, die Nutzer über Aktionen des Agenten auf dem Laufenden hält — es fragt vor dem Ausführen von Befehlen, Schreiben von Dateien usw. nach Bestätigung. Es ist jedoch nicht auf Sicherheitsisolation ausgelegt.

Für echte Isolation führen Sie OpenCode in einem Docker-Container oder einer VM aus.

### Server-Modus

Der Server-Modus ist Opt-in. Bei Aktivierung `OPENCODE_SERVER_PASSWORD` setzen, um HTTP Basic Auth zu verlangen. Ohne diese Variable läuft der Server nicht authentifiziert (mit Warnung). Die Absicherung des Servers liegt in der Verantwortung des Endnutzers — jede Funktionalität, die er bereitstellt, ist keine Schwachstelle.

### Außerhalb des Geltungsbereichs

| Kategorie | Begründung |
| --- | --- |
| **Server-Zugriff bei Opt-in** | Wenn Sie den Server-Modus aktivieren, ist API-Zugriff erwartetes Verhalten |
| **Sandbox-Ausbrüche** | Das Berechtigungssystem ist keine Sandbox (siehe oben) |
| **Datenverarbeitung durch LLM-Anbieter** | An den konfigurierten LLM-Anbieter gesendete Daten unterliegen dessen Richtlinien |
| **MCP-Server-Verhalten** | Externe MCP-Server, die Sie konfigurieren, liegen außerhalb unserer Vertrauensgrenze |
| **Bösartige Konfigurationsdateien** | Nutzer kontrollieren ihre eigene Konfiguration; deren Änderung ist kein Angriffsvektor |

---

# Sicherheitsprobleme melden

Wir schätzen Ihre Bemühungen um eine verantwortungsvolle Offenlegung und werden alles tun, um Ihre Beiträge zu würdigen.

Nutzen Sie den Tab ["Report a Vulnerability"](https://github.com/Rwanbt/opencode/security/advisories/new) in GitHub Security Advisories.

Das Team antwortet mit den nächsten Schritten. Nach der ersten Antwort hält Sie das Sicherheitsteam über den Fortschritt der Behebung und Veröffentlichung auf dem Laufenden und kann zusätzliche Informationen erbitten.

## Eskalation

Erhalten Sie innerhalb von 6 Werktagen keine Bestätigung, können Sie eine E-Mail an security@anoma.ly senden
