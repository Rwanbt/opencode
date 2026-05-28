# RFC Process — OpenCode Fork

Un RFC (Request for Comments) est requis avant toute modification architecturale majeure.

## Quand créer un RFC

- Nouveau pattern d'architecture central (ex: remplacement du système de sessions)
- Changement de format de données persistées (SQLite schema, config JSON)
- Migration technologique (remplacement d'une lib majeure)
- Modification d'API publique du SDK
- Tout changement qui affecte > 3 packages simultanément

## Format

Créer `docs/rfcs/RFC-NNNN-titre-court.md` :

```markdown
# RFC-NNNN : [Titre]
**Auteur** : @pseudo | **Date** : YYYY-MM-DD | **Statut** : Draft / Review / Accepted / Rejected

## Motivation
Problème actuel que ce RFC résout.

## Proposition détaillée
Description précise de la solution proposée.

## Alternatives considérées
Ce qui a été évalué et pourquoi rejeté.

## Questions ouvertes
Points non résolus à la date du RFC.

## Délai de review : YYYY-MM-DD
```

## Processus

1. Ouvrir le RFC en tant que PR (branch `rfc/NNNN-titre`)
2. Review par les mainteneurs du projet pendant 7 jours minimum
3. Statut → `Accepted` ou `Rejected` après consensus
4. Implémenter dans une PR séparée référençant le RFC

## RFCs actifs

Aucun RFC actif pour le moment.
