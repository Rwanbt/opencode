# License FAQ — Unifia Workbench

## License principale

### Unifia est-il sous quelle license ?

**Unifia Workbench** est sous **MIT License**. Voir [LICENSE](LICENSE) pour le texte complet.

### Quelles sont les obligations de la license MIT ?

- ✅ Vous pouvez : utiliser, copier, modifier, fusionner, publier, distribuer, sous-licencier, vendre
- ⚠️ Vous devez : inclure la notice de copyright et la license dans toute copie
- ❌ Vous ne pouvez pas : utiliser le nom "Unifia" pour endosser ou promouvoir des produits dérivés sans permission

### Puis-je utiliser Unifia commercialement ?

Oui, la license MIT le permet explicitement.

### Puis-je modifier Unifia et le redistribuer ?

Oui, à condition de :
1. Inclure la license MIT originale
2. Mentionner les modifications

## Dépendances

### Quelles licenses sont acceptées ?

**Tier 1** (idéal) : MIT, Apache-2.0, BSD-2/3-Clause, ISC, MPL-2.0, Unlicense
**Tier 2** (acceptable avec review) : LGPL-2.1+, LGPL-3.0
**Tier 3** (refusé) : GPL-3.0, AGPL-3.0, SSPL, BUSL-1.1 (sauf opt-in explicite)

### Pourquoi pas GPL ?

GPL est copyleft : si vous utilisez Unifia avec une dep GPL, votre code doit être GPL. Cela ne correspond pas à notre license MIT.

### Pourquoi pas AGPL ?

AGPL imposes les obligations GPL même sur les services réseau. Incompatible avec notre approche permissive.

### Pourquoi pas BUSL-1.1 partout ?

BUSL-1.1 (Business Source License) est source-available, pas open-source. Nous l'utiliserons pour Unifia Cloud (futur), pas pour le core.

## Upstream

### Unifia est-il un fork ?

Oui, Unifia est un fork de [Rwanbt/unifia](https://github.com/Rwanbt/unifia), qui est lui-même un fork d'[anomalyco/opencode](https://github.com/anomalyco/opencode).

### Puis-je contribuer en upstream ?

Oui. Si une amélioration est générique (pas spécifique Unifia), elle peut être proposée upstream.

### Que devient le code que je contribute ?

Votre contribution est sous MIT (compatible fork). Elle peut être rebrandée par le BDFL.

## Trademark

### Puis-je utiliser le nom "Unifia" ?

Le nom "Unifia" est libre pour :
- ✅ Contributions au projet
- ✅ Intégrations avec Unifia
- ✅ Articles, tutoriels, vidéos

Le nom "Unifia" est restreint pour :
- ❌ Produits forkés qui se prétendent "officiels"
- ❌ Logos Unifia pour des produits tiers

Pour plus d'clarifications, voir [TRADEMARK.md](TRADEMARK.md) (à venir).

## Capabilities

### Quelle license pour mes Capability Packs ?

Vous choisissez. Le format [skill-hub-manifest.schema.json](capability-packs/skill-hub-manifest.schema.json) supporte :
- MIT, Apache-2.0, BSD-2/3-Clause, ISC, MPL-2.0 (recommandé)
- LGPL-2.1+, LGPL-3.0 (acceptable)
- GPL-2.0+, GPL-3.0+ (refusé par défaut)
- BUSL-1.1 (opt-in, special)
- Propriétaire (Casino Royale, mais non-publiable)

### Mes Capabilities peuvent-elles être commerciales ?

Oui, sous BUSL-1.1 ou Propriétaire.

## Voir aussi

- [LICENSE](LICENSE) — texte complet MIT
- [THIRD-PARTY-NOTICES.md](docs/autonomy/THIRD-PARTY-NOTICES.md) — licenses des deps
- [LICENSE-AUDIT-UNIFIA.md](docs/autonomy/LICENSE-AUDIT-UNIFIA.md) — analyse détaillée
- [ADR-0023](docs/adr/0023-licensing-strategy.md) — décision de license
