# Replica Sync Boundary (Phase 17, Pass 1)

## Canonique (traverse la frontière Source -> Sink)

- Unité de réplication: **transaction complète** (`TxBundle`) uniquement.
- Métadonnées strictement nécessaires à la sécurité et à l’idempotence: identifiants tx, idempotency context de réplication, hash canonique, curseur principal filtré.
- Réceptions (`TransactionReceipt`) conservées comme preuve d’application idempotente côté sink.

## Dérivable (ne traverse pas la frontière canonique)

- Projections applicatives.
- Caches de lecture.
- Snapshots / compactages non-canoniques.

Ces états sont reconstructibles par replay déterministe depuis les transactions canoniques.

## Filtrage & sécurité

- Toute lecture/pull “user-safe” est **filtrée par principal**.
- Le curseur de réplication exposé est un curseur **principal-visible** (pas de head global observable).
- La frontière de sync ne révèle pas de signal distinguant “absent” vs “masked”.
