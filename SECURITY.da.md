<p align="center"><a href="SECURITY.md">English</a> | <a href="SECURITY.zh.md">简体中文</a> | <a href="SECURITY.zht.md">繁體中文</a> | <a href="SECURITY.ko.md">한국어</a> | <a href="SECURITY.de.md">Deutsch</a> | <a href="SECURITY.es.md">Español</a> | <a href="SECURITY.fr.md">Français</a> | <a href="SECURITY.it.md">Italiano</a> | <b>Dansk</b> | <a href="SECURITY.ja.md">日本語</a> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

# Sikkerhed

## Vigtigt

Vi accepterer ikke AI-genererede sikkerhedsrapporter. Vi modtager et stort antal af dem, og vi har absolut ikke ressourcerne til at gennemgå dem alle. Indsender du én, medfører det en automatisk udelukkelse fra projektet.

## Trusselsmodel

### Oversigt

OpenCode er en AI-drevet kodeassistent, der kører lokalt på din maskine. Den tilbyder et agentsystem med adgang til kraftfulde værktøjer, herunder shell-eksekvering, filoperationer og web-adgang.

### Ingen sandbox

OpenCode sandboxer **ikke** agenten. Tilladelsessystemet findes som en UX-funktion for at hjælpe brugere med at være opmærksomme på, hvad agenten gør — det beder om bekræftelse, før der udføres kommandoer, skrives filer osv. Det er dog ikke designet til at give sikkerhedsisolation.

Hvis du har brug for ægte isolation, så kør OpenCode inde i en Docker-container eller VM.

### Servertilstand

Servertilstand er kun opt-in. Når den er aktiveret, skal du sætte `OPENCODE_SERVER_PASSWORD` for at kræve HTTP Basic Auth. Uden dette kører serveren uautentificeret (med en advarsel). Det er slutbrugerens ansvar at sikre serveren — enhver funktionalitet, den tilbyder, er ikke en sårbarhed.

### Uden for rammerne

| Kategori | Begrundelse |
| --- | --- |
| **Serveradgang når aktiveret** | Hvis du aktiverer servertilstand, er API-adgang forventet adfærd |
| **Sandbox-undslippelser** | Tilladelsessystemet er ikke en sandbox (se ovenfor) |
| **LLM-udbyders datahåndtering** | Data sendt til din konfigurerede LLM-udbyder er underlagt deres politikker |
| **MCP-serveradfærd** | Eksterne MCP-servere, du konfigurerer, er uden for vores tillidsgrænse |
| **Ondsindede konfigurationsfiler** | Brugere kontrollerer deres egen konfiguration; at ændre den er ikke en angrebsvektor |

---

# Rapportering af sikkerhedsproblemer

Vi sætter pris på din indsats for ansvarligt at offentliggøre dine fund og vil gøre alt for at anerkende dine bidrag.

For at rapportere et sikkerhedsproblem, brug fanen GitHub Security Advisory ["Report a Vulnerability"](https://github.com/Rwanbt/opencode/security/advisories/new).

Teamet sender et svar med de næste skridt. Efter det første svar holder sikkerhedsteamet dig informeret om fremskridtene mod en rettelse og fuld meddelelse og kan bede om yderligere oplysninger.

## Eskalering

Hvis du ikke modtager en bekræftelse inden 6 hverdage, kan du sende en e-mail til security@anoma.ly
