<p align="center"><a href="SECURITY.md">English</a> | <a href="SECURITY.zh.md">简体中文</a> | <a href="SECURITY.zht.md">繁體中文</a> | <a href="SECURITY.ko.md">한국어</a> | <a href="SECURITY.de.md">Deutsch</a> | <a href="SECURITY.es.md">Español</a> | <a href="SECURITY.fr.md">Français</a> | <a href="SECURITY.it.md">Italiano</a> | <a href="SECURITY.da.md">Dansk</a> | <a href="SECURITY.ja.md">日本語</a> | <b>Polski</b> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

# Bezpieczeństwo

## Ważne

Nie akceptujemy raportów bezpieczeństwa generowanych przez SI. Otrzymujemy ich dużo i absolutnie nie mamy zasobów, by przejrzeć wszystkie. Zgłoszenie takiego raportu skutkuje automatycznym banem z projektu.

## Model zagrożeń

### Przegląd

OpenCode to asystent programowania oparty na SI, który działa lokalnie na Twoim komputerze. Oferuje system agentów z dostępem do potężnych narzędzi, w tym wykonywania powłoki, operacji na plikach i dostępu do sieci.

### Brak sandboxa

OpenCode **nie** umieszcza agenta w sandboxie. System uprawnień istnieje jako funkcja UX, aby pomóc użytkownikom być świadomymi działań agenta — prosi o potwierdzenie przed wykonaniem poleceń, zapisem plików itp. Nie jest jednak zaprojektowany do zapewniania izolacji bezpieczeństwa.

Jeśli potrzebujesz prawdziwej izolacji, uruchom OpenCode wewnątrz kontenera Docker lub maszyny wirtualnej.

### Tryb serwera

Tryb serwera jest wyłącznie opt-in. Po włączeniu ustaw `OPENCODE_SERVER_PASSWORD`, aby wymagać HTTP Basic Auth. Bez tego serwer działa bez uwierzytelniania (z ostrzeżeniem). Zabezpieczenie serwera jest obowiązkiem użytkownika końcowego — jakakolwiek funkcjonalność, którą oferuje, nie jest podatnością.

### Poza zakresem

| Kategoria | Uzasadnienie |
| --- | --- |
| **Dostęp do serwera po opt-in** | Jeśli włączysz tryb serwera, dostęp do API jest oczekiwanym zachowaniem |
| **Ucieczki z sandboxa** | System uprawnień nie jest sandboxem (patrz wyżej) |
| **Obsługa danych przez dostawcę LLM** | Dane wysyłane do skonfigurowanego dostawcy LLM podlegają jego polityce |
| **Zachowanie serwerów MCP** | Zewnętrzne serwery MCP, które konfigurujesz, znajdują się poza naszą granicą zaufania |
| **Złośliwe pliki konfiguracyjne** | Użytkownicy kontrolują własną konfigurację; jej modyfikacja nie jest wektorem ataku |

---

# Zgłaszanie problemów bezpieczeństwa

Doceniamy wysiłki odpowiedzialnego ujawniania znalezisk i dołożymy wszelkich starań, aby docenić Twój wkład.

Aby zgłosić problem bezpieczeństwa, użyj zakładki GitHub Security Advisory ["Report a Vulnerability"](https://github.com/Rwanbt/opencode/security/advisories/new).

Zespół prześle odpowiedź wskazującą kolejne kroki. Po pierwszej odpowiedzi zespół bezpieczeństwa będzie Cię informował o postępach w kierunku poprawki i pełnego ogłoszenia oraz może prosić o dodatkowe informacje.

## Eskalacja

Jeśli nie otrzymasz potwierdzenia w ciągu 6 dni roboczych, możesz wysłać e-mail na security@anoma.ly
