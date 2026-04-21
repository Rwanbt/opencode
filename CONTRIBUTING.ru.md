<p align="center"><a href="CONTRIBUTING.md">English</a> | <a href="CONTRIBUTING.zh.md">简体中文</a> | <a href="CONTRIBUTING.zht.md">繁體中文</a> | <a href="CONTRIBUTING.ko.md">한국어</a> | <a href="CONTRIBUTING.de.md">Deutsch</a> | <a href="CONTRIBUTING.es.md">Español</a> | <a href="CONTRIBUTING.fr.md">Français</a> | <a href="CONTRIBUTING.it.md">Italiano</a> | <a href="CONTRIBUTING.da.md">Dansk</a> | <a href="CONTRIBUTING.ja.md">日本語</a> | <a href="CONTRIBUTING.pl.md">Polski</a> | <b>Русский</b> | <a href="CONTRIBUTING.bs.md">Bosanski</a> | <a href="CONTRIBUTING.ar.md">العربية</a> | <a href="CONTRIBUTING.no.md">Norsk</a> | <a href="CONTRIBUTING.br.md">Português (Brasil)</a> | <a href="CONTRIBUTING.th.md">ไทย</a> | <a href="CONTRIBUTING.tr.md">Türkçe</a> | <a href="CONTRIBUTING.uk.md">Українська</a> | <a href="CONTRIBUTING.bn.md">বাংলা</a> | <a href="CONTRIBUTING.gr.md">Ελληνικά</a> | <a href="CONTRIBUTING.vi.md">Tiếng Việt</a></p>

# Вклад в OpenCode

Мы хотим упростить вам внесение вклада в OpenCode. Вот самые часто мержируемые типы изменений:

- Исправления багов
- Дополнительные LSP / форматтеры
- Улучшения производительности LLM
- Поддержка новых провайдеров
- Исправления особенностей среды
- Отсутствующее стандартное поведение
- Улучшения документации

Однако любая функция UI или основная функциональность продукта должны пройти проверку дизайна с основной командой до реализации.

## Ожидания от Pull Request

### Политика «Issue сначала»

**Все PR должны ссылаться на существующий issue.** Прежде чем открывать PR, создайте issue с описанием бага или функции. Это помогает сопровождающим в triage и предотвращает дублирование работы. PR без связанного issue могут быть закрыты без рассмотрения.

### Никаких стен текста от ИИ

Длинные описания PR и issues, сгенерированные ИИ, неприемлемы и могут игнорироваться. Уважайте время сопровождающих:

- Пишите короткие, сфокусированные описания
- Объясняйте, что изменилось и почему, своими словами
- Если вы не можете объяснить это кратко, ваш PR может быть слишком большим

### Заголовки PR

Заголовки PR должны следовать стандарту conventional commit: `feat:` новая функция, `fix:` исправление бага, `docs:` документация, `chore:` обслуживание, `refactor:` рефакторинг, `test:` тесты.

---

Полные детали настройки среды разработки, команд сборки и настройки отладчика смотрите в оригинале на английском [CONTRIBUTING.md](CONTRIBUTING.md).
