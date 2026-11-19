// Ancienne tâche de fond de la veille d'annonces — retirée en v1.15.
// La recherche est synchrone (annonces.mjs). Cette route restait appelable sans connexion et
// lançait une recherche payante : elle ne fait plus rien.
export const handler = async () => ({
  statusCode: 410,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ error: "Route retirée. Utiliser POST /api/annonces (connexion requise)." }),
});
