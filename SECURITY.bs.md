<p align="center"><a href="SECURITY.md">English</a> | <a href="SECURITY.zh.md">简体中文</a> | <a href="SECURITY.zht.md">繁體中文</a> | <a href="SECURITY.ko.md">한국어</a> | <a href="SECURITY.de.md">Deutsch</a> | <a href="SECURITY.es.md">Español</a> | <a href="SECURITY.fr.md">Français</a> | <a href="SECURITY.it.md">Italiano</a> | <a href="SECURITY.da.md">Dansk</a> | <a href="SECURITY.ja.md">日本語</a> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <b>Bosanski</b> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

# Sigurnost

## Važno

Ne prihvatamo izvještaje o sigurnosti generisane pomoću AI. Primamo ih veliki broj i apsolutno nemamo resurse da ih sve pregledamo. Slanje takvog izvještaja rezultira automatskom zabranom pristupa projektu.

## Model prijetnji

### Pregled

OpenCode je AI-pokretani asistent za kodiranje koji se izvršava lokalno na vašoj mašini. Pruža agentski sistem s pristupom moćnim alatima uključujući izvršavanje shell-a, operacije nad datotekama i web pristup.

### Bez sandboxa

OpenCode **ne** stavlja agenta u sandbox. Sistem dozvola postoji kao UX funkcija da pomogne korisnicima da budu svjesni šta agent radi — traži potvrdu prije izvršavanja naredbi, pisanja datoteka itd. Međutim, nije dizajniran da pruži sigurnosnu izolaciju.

Ako trebate stvarnu izolaciju, pokrenite OpenCode unutar Docker kontejnera ili VM-a.

### Serverski režim

Serverski režim je isključivo opt-in. Kad je omogućen, postavite `OPENCODE_SERVER_PASSWORD` kako biste zahtijevali HTTP Basic Auth. Bez toga server radi bez autentifikacije (uz upozorenje). Odgovornost je krajnjeg korisnika da zaštiti server — bilo koja funkcionalnost koju pruža nije ranjivost.

### Izvan opsega

| Kategorija | Obrazloženje |
| --- | --- |
| **Serverski pristup kad je omogućen** | Ako omogućite serverski režim, API pristup je očekivano ponašanje |
| **Bijeg iz sandboxa** | Sistem dozvola nije sandbox (vidi iznad) |
| **Obrada podataka od LLM pružaoca** | Podaci poslani vašem konfigurisanom LLM pružaocu regulisani su njegovim politikama |
| **Ponašanje MCP servera** | Eksterni MCP serveri koje konfigurišete su izvan naše granice povjerenja |
| **Zlonamjerne konfiguracijske datoteke** | Korisnici kontrolišu vlastitu konfiguraciju; njezina izmjena nije vektor napada |

---

# Prijavljivanje sigurnosnih problema

Cijenimo vaše napore da odgovorno otkrijete svoje nalaze i učinit ćemo sve što možemo da prepoznamo vaše doprinose.

Za prijavu sigurnosnog problema, koristite karticu GitHub Security Advisory ["Report a Vulnerability"](https://github.com/Rwanbt/opencode/security/advisories/new).

Tim će poslati odgovor s opisom sljedećih koraka. Nakon prvog odgovora, sigurnosni tim će vas obavještavati o napretku prema popravku i punoj objavi i može tražiti dodatne informacije.

## Eskalacija

Ako ne primite potvrdu unutar 6 radnih dana, možete poslati e-mail na security@anoma.ly
