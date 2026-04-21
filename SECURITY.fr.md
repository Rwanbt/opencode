<p align="center"><a href="SECURITY.md">English</a> | <a href="SECURITY.zh.md">简体中文</a> | <a href="SECURITY.zht.md">繁體中文</a> | <a href="SECURITY.ko.md">한국어</a> | <a href="SECURITY.de.md">Deutsch</a> | <a href="SECURITY.es.md">Español</a> | <b>Français</b> | <a href="SECURITY.it.md">Italiano</a> | <a href="SECURITY.da.md">Dansk</a> | <a href="SECURITY.ja.md">日本語</a> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

# Sécurité

## Important

Nous n'acceptons pas les rapports de sécurité générés par IA. Nous en recevons beaucoup et n'avons absolument pas les ressources pour tous les examiner. En soumettre un entraîne un bannissement automatique du projet.

## Modèle de menaces

### Vue d'ensemble

OpenCode est un assistant de codage assisté par IA qui s'exécute localement sur votre machine. Il fournit un système d'agents avec accès à des outils puissants incluant exécution shell, opérations sur fichiers et accès web.

### Pas de sandbox

OpenCode ne met **pas** l'agent en sandbox. Le système de permissions existe comme fonctionnalité d'UX pour tenir l'utilisateur informé des actions de l'agent — il demande confirmation avant d'exécuter des commandes, d'écrire des fichiers, etc. Cependant, il n'est pas conçu pour fournir une isolation de sécurité.

Si vous avez besoin d'une isolation réelle, exécutez OpenCode dans un conteneur Docker ou une VM.

### Mode serveur

Le mode serveur est opt-in uniquement. Lorsqu'activé, définissez `OPENCODE_SERVER_PASSWORD` pour imposer HTTP Basic Auth. Sans cela, le serveur tourne non authentifié (avec un avertissement). C'est à l'utilisateur final de sécuriser le serveur — toute fonctionnalité qu'il offre n'est pas une vulnérabilité.

### Hors périmètre

| Catégorie | Justification |
| --- | --- |
| **Accès au serveur lorsqu'activé** | Si vous activez le mode serveur, l'accès à l'API est un comportement attendu |
| **Évasion de sandbox** | Le système de permissions n'est pas un sandbox (voir ci-dessus) |
| **Traitement des données par le fournisseur LLM** | Les données envoyées à votre fournisseur LLM configuré sont régies par ses politiques |
| **Comportement des serveurs MCP** | Les serveurs MCP externes que vous configurez sont hors de notre frontière de confiance |
| **Fichiers de configuration malveillants** | Les utilisateurs contrôlent leur propre configuration ; la modifier n'est pas un vecteur d'attaque |

---

# Signaler des problèmes de sécurité

Nous apprécions vos efforts pour divulguer vos découvertes de manière responsable et ferons tout notre possible pour reconnaître vos contributions.

Pour signaler un problème, utilisez l'onglet GitHub Security Advisory ["Report a Vulnerability"](https://github.com/Rwanbt/opencode/security/advisories/new).

L'équipe enverra une réponse indiquant les prochaines étapes. Après la réponse initiale, l'équipe sécurité vous tiendra informé de la progression vers un correctif et l'annonce complète, et pourra demander des informations supplémentaires.

## Escalade

Si vous ne recevez pas d'accusé de réception sous 6 jours ouvrés, vous pouvez envoyer un e-mail à security@anoma.ly
