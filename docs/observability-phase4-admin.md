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

- Un job périodique (5s, `runtime.ts`) interroge les events insérés depuis le dernier tick (`ObservabilityRepository.since`), les filtre (`shouldExportSpan` : un event `started` sans terminal n'est pas encore exporté), les traduit en `ExportProjection`, puis appelle `.export()` sur chaque exporter configuré via `exportToAll`/`exportWithRetry` (`observability/export-runner.ts`).
- Le curseur d'export est **en mémoire, par processus** — pas persisté en DB. Par défaut il repart du plus récent event au moment du premier tick qui trouve au moins un exporter configuré (pas nécessairement le boot du process, si un exporter est ajouté plus tard par rechargement de config à chaud). Activer `experimental.observability.backfillOnStart: true` (ou le switch "Backfill on start" du panneau Exporters) fait repartir ce curseur de zéro à la place — **l'intégralité de l'historique local existant** est alors exportée. À utiliser avec précaution sur une base ancienne : ça peut représenter un gros volume d'appels réseau.
- Un échec d'un exporter (timeout, 4xx/5xx, DNS) est **retenté avec un backoff borné** (50ms/250ms/1000ms, 4 tentatives au total — même politique que le retry de la queue interne Phase 1). Après épuisement des tentatives, le batch est abandonné (loggé `log.warn`) et le curseur avance quand même, pour qu'un batch bloqué ne puisse jamais stopper l'export des events suivants indéfiniment. Un échec d'exporter n'affecte jamais le flux produit ni les autres exporters configurés.
- Le mapping vers Langfuse cible l'API d'ingestion publique (`POST /api/public/ingestion`, Basic Auth), documentée par Langfuse comme "legacy" au profit d'un futur endpoint OpenTelemetry. Le format exact (noms de champs, enum `type`, forme de `Usage`/`ObservationLevel`, enveloppe `id`/`type`/`timestamp`/`body`) a été **vérifié le 2026-07-12 directement contre le fichier OpenAPI brut** de Langfuse (`https://cloud.langfuse.com/generated/api/openapi.yml`, schémas `IngestionEvent`/`BaseEvent`/`TraceBody`/`CreateSpanBody`/`CreateGenerationBody`), pas seulement contre la documentation résumée — voir le commentaire d'en-tête de `observability/exporters/langfuse.ts`. **Ce mapping n'a en revanche jamais été exercé contre une instance Langfuse réelle** (pas d'identifiants disponibles dans cet environnement) : l'acceptation serveur et l'authentification restent à confirmer manuellement.

## Configurer/tester depuis l'UI

Le panneau "Exporters" de Settings → Observability permet, sans toucher au fichier de config :
- lister les exporters configurés (host + clé publique seulement — la clé secrète n'est jamais renvoyée par l'API une fois enregistrée) et en retirer un ;
- ajouter/mettre à jour l'exporter Langfuse (host, clé publique, clé secrète) ;
- activer/désactiver `backfillOnStart` ;
- envoyer un **event de test synthétique** (aucune donnée réelle) à travers tous les exporters configurés et voir le résultat par exporter (`GET/POST /observability/exporters/*`) ;
- **prévisualiser** l'`ExportProjection` exacte qui serait envoyée pour un event réel de la session courante, sans jamais l'envoyer nulle part.

## Limites connues (à lire avant d'activer en production)

1. **Mapping Langfuse jamais exercé contre une instance réelle.** Le format est vérifié contre le schéma OpenAPI officiel (ci-dessus), mais aucun appel n'a jamais atteint un vrai serveur Langfuse dans cet environnement. Premier test recommandé : configurer un projet Langfuse de test dans le panneau Exporters, cliquer "Send test event", vérifier qu'il apparaît dans l'UI Langfuse.
2. **Pas de soak test 24h exécuté.** Le harness existe (`script/observability-soak-test.ts`) et a été vérifié en smoke-test (quelques secondes, comportement correct : queue drainée, `PRAGMA integrity_check` propre, pas de croissance mémoire suspecte sur cette courte fenêtre) — mais un run réel de 24h, qui est la seule façon de détecter une fuite mémoire lente ou une dérive de la queue, n'a jamais été exécuté. Voir §"Lancer le soak test" ci-dessous.
3. **Fuzz du sanitizer limité à cette session.** `test/observability/sanitizer-fuzz.test.ts` couvre 120 itérations par propriété avec un PRNG seedé (reproductible) — c'est une preuve de robustesse structurelle (jamais de throw, jamais de dépassement de borne, jamais de temps pathologique), pas une preuve d'absence totale de contre-exemple. Un fuzzing plus long/continu (ex. intégré à un job CI nightly) resterait utile.
4. **Le retry est borné, pas une file persistante.** Un batch qui échoue après ses 4 tentatives est définitivement perdu (loggé) — il n'y a pas de rejouabilité après redémarrage du process.

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
- Tester le mapping Langfuse contre une vraie instance (cloud ou self-hosted) via le bouton "Send test event" du panneau Exporters, et corriger le mapping si un comportement serveur réel diverge du schéma OpenAPI vérifié statiquement.
- Si le retry borné (4 tentatives, ~1.3s max) s'avère insuffisant en usage réel (réseau très instable), évaluer une file persistée avec rejouabilité après redémarrage — actuellement hors scope Phase 4.
- Si le backfill à froid s'avère trop grossier (tout ou rien), évaluer un backfill borné par fenêtre de temps plutôt que l'historique complet.
