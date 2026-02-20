# Mesh Explorer Graph Devtools JSON (v1)

`Export Graph` produit un payload JSON canonique minimal (sans layout UI local):

```json
{
  "version": 1,
  "nodes": [{ "id": "A", "label": "Alpha", "level": 1, "metadata": { "env": "dev" } }],
  "links": [{ "id": "L1", "source": "A", "target": "B", "type": "related", "label": "depends-on" }]
}
```

Limites:

- Le format n'embarque pas les positions/zoom/layout (données UI-locales).
- `Import Graph` exécute les créations en ordre strict: nodes puis links.
- `Clear Graph` supprime les nodes une par une via API canonique; les links incidentes sont supprimées par cascade des reducers de projection.
