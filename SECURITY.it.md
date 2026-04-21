<p align="center"><a href="SECURITY.md">English</a> | <a href="SECURITY.zh.md">简体中文</a> | <a href="SECURITY.zht.md">繁體中文</a> | <a href="SECURITY.ko.md">한국어</a> | <a href="SECURITY.de.md">Deutsch</a> | <a href="SECURITY.es.md">Español</a> | <a href="SECURITY.fr.md">Français</a> | <b>Italiano</b> | <a href="SECURITY.da.md">Dansk</a> | <a href="SECURITY.ja.md">日本語</a> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

# Sicurezza

## Importante

Non accettiamo report di sicurezza generati da IA. Ne riceviamo un gran numero e non abbiamo assolutamente le risorse per esaminarli tutti. Inviarne uno comporta un ban automatico dal progetto.

## Modello di minaccia

### Panoramica

OpenCode è un assistente di codifica basato su IA che gira localmente sulla tua macchina. Fornisce un sistema di agenti con accesso a strumenti potenti tra cui esecuzione shell, operazioni sui file e accesso web.

### Nessun sandbox

OpenCode **non** mette l'agente in un sandbox. Il sistema di permessi esiste come funzionalità di UX per tenere l'utente consapevole delle azioni dell'agente — chiede conferma prima di eseguire comandi, scrivere file, ecc. Tuttavia non è progettato per fornire isolamento di sicurezza.

Se hai bisogno di un vero isolamento, esegui OpenCode all'interno di un contenitore Docker o di una VM.

### Modalità server

La modalità server è opt-in. Quando attiva, imposta `OPENCODE_SERVER_PASSWORD` per richiedere HTTP Basic Auth. Senza, il server gira non autenticato (con avviso). È responsabilità dell'utente finale proteggere il server — qualsiasi funzionalità offerta non è una vulnerabilità.

### Fuori ambito

| Categoria | Motivazione |
| --- | --- |
| **Accesso al server quando attivato** | Se abiliti la modalità server, l'accesso API è comportamento previsto |
| **Fuga da sandbox** | Il sistema di permessi non è un sandbox (vedi sopra) |
| **Gestione dati del provider LLM** | I dati inviati al provider LLM configurato sono regolati dalle sue policy |
| **Comportamento dei server MCP** | I server MCP esterni che configuri sono fuori dal nostro confine di fiducia |
| **File di configurazione malevoli** | Gli utenti controllano la propria configurazione; modificarla non è un vettore di attacco |

---

# Segnalare problemi di sicurezza

Apprezziamo gli sforzi per divulgare responsabilmente le scoperte e faremo ogni sforzo per riconoscere il contributo.

Per segnalare un problema, usa la scheda ["Report a Vulnerability"](https://github.com/Rwanbt/opencode/security/advisories/new) di GitHub Security Advisory.

Il team invierà una risposta con i prossimi passi. Dopo la risposta iniziale, il team di sicurezza ti terrà informato sui progressi verso una correzione e annuncio completo, e può richiedere informazioni aggiuntive.

## Escalation

Se non ricevi una conferma entro 6 giorni lavorativi, puoi inviare un'email a security@anoma.ly
