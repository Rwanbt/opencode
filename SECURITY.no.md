<p align="center"><a href="SECURITY.md">English</a> | <a href="SECURITY.zh.md">简体中文</a> | <a href="SECURITY.zht.md">繁體中文</a> | <a href="SECURITY.ko.md">한국어</a> | <a href="SECURITY.de.md">Deutsch</a> | <a href="SECURITY.es.md">Español</a> | <a href="SECURITY.fr.md">Français</a> | <a href="SECURITY.it.md">Italiano</a> | <a href="SECURITY.da.md">Dansk</a> | <a href="SECURITY.ja.md">日本語</a> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <b>Norsk</b> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

# Sikkerhet

## Viktig

Vi aksepterer ikke AI-genererte sikkerhetsrapporter. Vi mottar et stort antall av dem, og vi har absolutt ikke ressursene til å gjennomgå dem alle. Å sende inn en medfører automatisk utestengelse fra prosjektet.

## Trusselmodell

### Oversikt

OpenCode er en AI-drevet kodeassistent som kjører lokalt på maskinen din. Den tilbyr et agentsystem med tilgang til kraftige verktøy, inkludert shell-eksekvering, filoperasjoner og web-tilgang.

### Ingen sandkasse

OpenCode sandkasser **ikke** agenten. Tillatelsessystemet eksisterer som en UX-funksjon for å hjelpe brukere med å være klar over hva agenten gjør — det ber om bekreftelse før det kjører kommandoer, skriver filer osv. Det er imidlertid ikke designet for å gi sikkerhetsisolering.

Hvis du trenger ekte isolering, kjør OpenCode inne i en Docker-container eller VM.

### Servermodus

Servermodus er kun opt-in. Når aktivert, sett `OPENCODE_SERVER_PASSWORD` for å kreve HTTP Basic Auth. Uten dette kjører serveren uautentisert (med en advarsel). Det er sluttbrukerens ansvar å sikre serveren — enhver funksjonalitet den gir, er ikke en sårbarhet.

### Utenfor omfang

| Kategori | Begrunnelse |
| --- | --- |
| **Servertilgang ved opt-in** | Hvis du aktiverer servermodus, er API-tilgang forventet atferd |
| **Sandkasse-rømming** | Tillatelsessystemet er ikke en sandkasse (se over) |
| **LLM-leverandørs datahåndtering** | Data sendt til din konfigurerte LLM-leverandør er styrt av deres retningslinjer |
| **MCP-serveratferd** | Eksterne MCP-servere du konfigurerer, er utenfor vår tillitsgrense |
| **Ondsinnede konfigurasjonsfiler** | Brukere kontrollerer sin egen konfigurasjon; å endre den er ikke en angrepsvektor |

---

# Rapportere sikkerhetsproblemer

Vi setter pris på innsatsen din for ansvarlig å offentliggjøre funnene dine og vil gjøre alt for å anerkjenne bidragene dine.

For å rapportere et sikkerhetsproblem, bruk fanen GitHub Security Advisory ["Report a Vulnerability"](https://github.com/Rwanbt/opencode/security/advisories/new).

Teamet vil sende et svar med neste skritt. Etter det første svaret vil sikkerhetsteamet holde deg informert om fremgangen mot en løsning og full kunngjøring, og kan be om ytterligere informasjon.

## Eskalering

Hvis du ikke mottar en bekreftelse innen 6 virkedager, kan du sende en e-post til security@anoma.ly
