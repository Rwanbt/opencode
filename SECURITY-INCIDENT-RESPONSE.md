# Security Incident Response — Unifia Workbench

**Version :** 1.0
**Date :** 2026-07-31

## Vue d'ensemble

Ce document décrit le **process de réponse** aux incidents de sécurité d'Unifia Workbench. Il s'applique aux incidents impliquant :
- Le code source Unifia
- Les binaires publiés
- Les utilisateurs
- Les données
- Les communications

## Classification des incidents

### SEV-1 (Critique) — réponse < 1h

- Vulnérabilité d'exécution de code à distance (RCE)
- Bypass de PolicyEngine (allow alors que should be deny)
- Fuite de secrets utilisateurs (SecretStore compromise)
- Computer use bypass (screenshot redaction cassée)
- Vol de credentials (supply chain attack)

### SEV-2 (Haute) — réponse < 4h

- Vulnérabilité d'élévation de privilèges
- Bypass partiel de PolicyEngine
- Sandbox escape détecté
- Phishing via Skill Hub
- Vulnérabilité dans une capability pack

### SEV-3 (Moyenne) — réponse < 24h

- Vulnérabilité XSS
- CSRF ou clickjacking
- Information disclosure
- Vulnérabilité dans une dépendance

### SEV-4 (Basse) — réponse < 1 semaine

- Bug UX
- Performance
- Documentation
- Deprecated feature exposing des données

## Process de réponse

### 1. Détection (0-15 min)

- **Sources** : audit interne, rapport utilisateur, CVE database, scanner
- **Action** : créer un ticket privé (NE PAS ouvrir d'issue publique)
- **Destinataires** : [signalement privé GitHub](https://github.com/Rwanbt/unifia/security/advisories/new) (le projet ne contrôle aucun domaine, donc aucune adresse e-mail)

### 2. Triage (15-60 min)

- Confirmer la vulnérabilité
- Classifier SEV
- Identifier les versions affectées
- Identifier les workarounds possibles
- **Décider** : pré-publier un fix ou attendre ?

### 3. Mitigation immédiate (1-4h)

- Selon SEV :
  - SEV-1 : désactiver la feature impactée temporairement
  - SEV-2 : déployer un patch hotfix
  - SEV-3 : préparer un patch
  - SEV-4 : ticket de roadmap

### 4. Fix (4h-2 jours)

- Branche privée `security/SECV-XXX-description`
- Patch minimal
- Tests (fonctionnel + security)
- Code review par 2 maintainers senior
- **SECURITY-CRITICAL** : pas d'auto-revue

### 5. Disclosure (1-7 jours)

- Patch released
- CVE créé (si applicable)
- GHSA advisory publié
- Notification aux utilisateurs (release notes, email)
- **Score CVSS** calculé
- **Timeline** de l'incident

### 6. Post-mortem (1-2 semaines)

- Document interne (`docs/security/INCIDENT-XXX.md`)
- **Blameless** : pas de blame personnel
- Root cause analysis
- Action items pour éviter la récurrence
- Mise à jour de ce document

## Communication

### Interne

- Slack #security-incidents
- PagerDuty (SEV-1, SEV-2)
- Signalement privé GitHub (aucune adresse e-mail : aucun domaine contrôlé)

### Externe

- GHSA (GitHub Security Advisory)
- release notes
- Email aux utilisateurs (SEV-1, SEV-2)
- Twitter/X (SEV-1 only)

## Templates

### Internal incident report

```markdown
# Incident SECV-XXX

## Summary
[One-line description]

## Severity
[SEV-1|SEV-2|SEV-3|SEV-4]

## Affected versions
[Versions]

## CVSS
[Score]

## Timeline
- [Date] : discovery
- [Date] : triage
- [Date] : fix
- [Date] : release

## Root cause
[Detailed analysis]

## Impact
[Affected users, data exposure]

## Mitigation
[Steps to mitigate]

## Follow-up
[Action items]
```

### GHSA advisory

```markdown
# [Title]

## Summary
[Brief description]

## Severity
[Score] [Level]

## Affected
- [Versions]

## Patches
- [Latest version]

## Workarounds
[If applicable]

## References
- CVE-XXX-XXXX
- [Commit fix]
```

## Coordinated disclosure

Nous suivons **90 days** comme standard depuis la découverte :
- Day 0 : discovery
- Day 30 : confirmation
- Day 60 : patch ready
- Day 90 : public disclosure

## Security contacts

- **Signalement privé** : https://github.com/Rwanbt/unifia/security/advisories/new
- **Mainteneur** : [@Rwanbt](https://github.com/Rwanbt)

Le projet ne contrôle ni nom de domaine ni compte de réseau social ; il n'expose
donc ni adresse e-mail ni handle. Tout canal en `@unifia.ai` ou `@Unifia` serait
usurpable par un tiers.

## Hall of Fame

Nous remercions les chercheurs qui reportent des vulnérabilités de manière responsable.
Kudos publics dans les release notes.

## Voir aussi

- [SECURITY.md](SECURITY.md) — politique de sécurité public
- [SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md) — checklist de vérification
- [threat model](docs/security/THREAT-MODEL.md) — modèle de menace
- [ADR-0006](docs/adr/0006-policy-engine.md) — PolicyEngine (default deny)
- [ADR-0012](docs/adr/0012-provenance-ee-exclusion.md) — provenance /ee/
