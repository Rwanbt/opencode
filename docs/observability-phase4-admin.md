# Observabilité native — administration Phase 4 (exporters)

**Date** : 2026-07-12 | **Statut** : Phase 4 partielle — voir limites connues en bas de page.

Ce document couvre uniquement la Phase 4 (exporters optionnels). Pour le fonctionnement local (Phase 1-3 : capture, stockage, UI, opt-in contenu), voir `docs/observability-phase0-report.md` et `docs/security/observability-threat-model.md`.

## Ce que fait la Phase 4

Par défaut, l'observabilité native reste 100% locale : aucun exporter n'est configuré, aucun appel réseau n'est jamais fait depuis le module `observability/*`. La Phase 4 ajoute la possibilité — strictement opt-in, jamais activée par défaut — d'envoyer une **projection redacted** (`ExportProjection`, ADR-1026) de chaque event terminé vers un service tiers.

## Configurer l'exporter Langfuse

Dans `opencode.json` / `opencode.jsonc` :

```json
{
  "experimental": {
    "observability": {
      "enabled": true,
      "exporters": [
        {
          "type": "langfuse",
          "host": "https://cloud.langfuse.com",
          "publicKey": "pk-lf-...",
          "secretKey": "sk-lf-..."
        }
      ]
    }
  }
}
```

- `host` : URL de base de l'instance Langfuse (cloud ou self-hosted).
- `publicKey`/`secretKey` : clés de projet Langfuse (Project Settings → API Keys).
- Sans le bloc `exporters`, ou avec `exporters: []`, le comportement est identique à la Phase 1-3 : zéro réseau.

## Ce qui est envoyé — et ce qui ne l'est jamais

`ExportProjection` (`observability/export-projection.ts`) est un schéma Zod `.strict()` séparé du schéma d'event interne. Champs envoyés : type/statut d'event, timestamps, durée, tokens, coût (`cost_nano_usd`), modèle/provider, classes de redaction détectées (`secret`/`path`/`email`/...), et des HMAC-SHA256 (jamais l'identifiant brut) pour session/projet/workspace/outil/skill/chemin/serveur MCP.

**Jamais envoyé, sous aucune condition** :
- le contenu opt-in Phase 3 (`local_content_redacted`/`local_full`, ADR-1032), même si un opt-in actif existe pour la session — l'opt-in Phase 3 couvre uniquement le stockage local, jamais l'export réseau ;
- un identifiant interne en clair (session/projet/workspace) ;
- un message d'erreur brut, une stack trace, un chemin de fichier.

Voir `docs/security/observability-threat-model.md` (addendum Phase 4) pour le détail des menaces et mitigations.

## Fonctionnement interne

- Un job périodique (5s, `runtime.ts`) interroge les events insérés depuis le dernier tick (`ObservabilityRepository.since`), les filtre (`shouldExportSpan` : un event `started` sans terminal n'est pas encore exporté), les traduit en `ExportProjection`, puis appelle `.export()` sur chaque exporter configuré.
- Le curseur d'export est **en mémoire, par processus** — pas persisté en DB. Un redémarrage repart du plus récent event au moment du boot. **Aucun rattrapage de l'historique** n'est fait quand un exporter est configuré après coup sur une instance qui a déjà des events.
- Un échec d'un exporter (timeout, 4xx/5xx, DNS) est loggé (`log.warn`) et n'affecte jamais le flux produit ni les autres exporters. Il n'y a **pas de retry** en Phase 4 — un batch en échec est perdu, pas réessayé.
- Le mapping vers Langfuse cible l'API d'ingestion publique (`POST /api/public/ingestion`, Basic Auth), documentée par Langfuse comme "legacy" au profit d'un futur endpoint OpenTelemetry. **Ce mapping n'a jamais été exercé contre une instance Langfuse réelle** (pas d'identifiants disponibles dans cet environnement) — à valider manuellement avant un premier usage en production.

## Limites connues (à lire avant d'activer en production)

1. **Pas de test contre une vraie instance Langfuse.** Le format des événements envoyés (`trace-create`/`span-create`/`generation-create`) est basé sur la documentation publique Langfuse, jamais vérifié en conditions réelles. Premier test recommandé : activer sur un projet Langfuse de test, envoyer quelques events, vérifier qu'ils apparaissent correctement dans l'UI Langfuse.
2. **Pas de backfill.** Configurer un exporter n'exporte jamais les events déjà en base — seulement ceux insérés après le démarrage du processus avec l'exporter actif.
3. **Pas de retry.** Un batch qui échoue au réseau est perdu, pas réessayé au tick suivant.
4. **Pas de soak test 24h exécuté.** Le harness existe (`script/observability-soak-test.ts`) et a été vérifié en smoke-test (quelques secondes, comportement correct : queue drainée, `PRAGMA integrity_check` propre, pas de croissance mémoire suspecte sur cette courte fenêtre) — mais un run réel de 24h, qui est la seule façon de détecter une fuite mémoire lente ou une dérive de la queue, n'a jamais été exécuté. Voir §"Lancer le soak test" ci-dessous.
5. **Fuzz du sanitizer limité à cette session.** `test/observability/sanitizer-fuzz.test.ts` couvre 120 itérations par propriété avec un PRNG seedé (reproductible) — c'est une preuve de robustesse structurelle (jamais de throw, jamais de dépassement de borne, jamais de temps pathologique), pas une preuve d'absence totale de contre-exemple. Un fuzzing plus long/continu (ex. intégré à un job CI nightly) resterait utile.

## Lancer le soak test

```bash
# Smoke test rapide (10s) pour vérifier que le harness tourne toujours après un changement de code :
bun run script/observability-soak-test.ts --duration-ms=10000 --rate-per-sec=50

# Run réel 24h (à lancer manuellement, en arrière-plan, sur une machine qui ne va pas s'éteindre) :
bun run script/observability-soak-test.ts --duration-ms=86400000 --rate-per-sec=20 > soak-24h.log 2>&1 &
```

Le script isole automatiquement son `XDG_*_HOME` dans un répertoire temporaire dédié — il ne touche jamais le profil OpenCode réel de la machine qui l'exécute. À la fin (ou sur `Ctrl+C`), il flush la queue, exécute `PRAGMA integrity_check`, et sort en erreur (`exit 1`) si le circuit breaker est resté ouvert. Pendant le run, `soak-24h.log` contient un point de mesure (`rssMb`, `queueSize`, `circuitOpen`, compteurs d'erreur) toutes les 60s — à examiner a posteriori pour une tendance mémoire ou une dérive de queue, ce que le script lui-même ne juge pas automatiquement.

## Ce qu'il resterait à faire avant de retirer les limites ci-dessus

- Exécuter le soak test 24h réel et documenter le résultat dans un nouveau §"Résultat soak test" de ce document.
- Tester le mapping Langfuse contre une vraie instance (cloud ou self-hosted) et corriger le mapping si le format observé diverge de la documentation.
- Ajouter un retry borné (même politique que `flush()` du service — backoff, compteur, jamais bloquant) si les échecs d'export s'avèrent fréquents en usage réel.
- Décider si le backfill (exporter l'historique existant à la première configuration) est une fonctionnalité désirée, et si oui l'implémenter avec un curseur persisté plutôt qu'en mémoire.
