// /api/save-content.js
// Vercel Serverless Function — jelszóval védett olvasás/írás a repo content.json fájljára,
// a GitHub Contents API-n keresztül. Így a Vercel automatikusan újra is publikálja az oldalt.
//
// Szükséges környezeti változók (Vercel projekt Settings → Environment Variables):
//   GITHUB_TOKEN     - GitHub Personal Access Token, "repo" (contents) írási joggal
//   GITHUB_REPO      - pl. "felhasznalonev/repo-nev"
//   GITHUB_BRANCH    - pl. "main" (opcionális, alapértelmezett: main)
//   ADMIN_PASSWORD   - az admin.html-en megadandó jelszó

const GITHUB_API = 'https://api.github.com';

function checkPassword(req) {
  const provided = req.headers['x-admin-password'];
  const expected = process.env.ADMIN_PASSWORD;
  return expected && provided && provided === expected;
}

async function githubRequest(path, options = {}) {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`${GITHUB_API}/repos/${repo}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  return res;
}

module.exports = async (req, res) => {
  if (!checkPassword(req)) {
    res.status(401).send('Érvénytelen jelszó.');
    return;
  }

  const branch = process.env.GITHUB_BRANCH || 'main';

  if (req.method === 'GET') {
    // Aktuális content.json visszaadása az admin felület kitöltéséhez
    try {
      const ghRes = await githubRequest(`/contents/content.json?ref=${branch}`);
      if (!ghRes.ok) {
        res.status(502).send('Nem sikerült beolvasni a content.json fájlt a GitHub-ról.');
        return;
      }
      const ghData = await ghRes.json();
      const decoded = Buffer.from(ghData.content, 'base64').toString('utf-8');
      res.status(200).json(JSON.parse(decoded));
    } catch (e) {
      res.status(500).send('Szerverhiba: ' + e.message);
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      // 1) Lekérjük a fájl jelenlegi SHA-ját (ez kell a GitHub API frissítéshez)
      const getRes = await githubRequest(`/contents/content.json?ref=${branch}`);
      if (!getRes.ok) {
        res.status(502).send('Nem sikerült lekérni a fájl jelenlegi verzióját.');
        return;
      }
      const current = await getRes.json();

      // 2) Új tartalom base64-re kódolva
      const newContent = JSON.stringify(req.body, null, 2);
      const encoded = Buffer.from(newContent, 'utf-8').toString('base64');

      // 3) Commit a GitHub API-n keresztül
      const putRes = await githubRequest('/contents/content.json', {
        method: 'PUT',
        body: JSON.stringify({
          message: 'Tartalom frissítése az admin felületről',
          content: encoded,
          sha: current.sha,
          branch: branch
        })
      });

      if (!putRes.ok) {
        const errBody = await putRes.text();
        res.status(502).send('GitHub commit sikertelen: ' + errBody);
        return;
      }

      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).send('Szerverhiba: ' + e.message);
    }
    return;
  }

  res.status(405).send('Nem támogatott metódus.');
};
