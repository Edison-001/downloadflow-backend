# DownloadFlow

Version responsive de ton site + backend réel pour analyser et télécharger des vidéos YouTube.

## 1. Pré-requis

- Node.js 18+
- yt-dlp
- FFmpeg (recommandé pour fusionner vidéo + audio)

Le backend utilise yt-dlp. La documentation officielle montre notamment l'extraction des métadonnées via `YoutubeDL` et la sélection de formats vidéo/audio. 

## 2. Installation

Dans ce dossier :

```powershell
npm install
```

Installe ensuite `yt-dlp` et `FFmpeg` sur ton PC et vérifie :

```powershell
yt-dlp --version
ffmpeg -version
```

Si Windows ne trouve pas `yt-dlp`, tu peux soit l'ajouter au PATH, soit définir :

```powershell
$env:YTDLP_PATH="C:\chemin\vers\yt-dlp.exe"
```

## 3. Démarrage

```powershell
npm start
```

Puis ouvre :

http://localhost:3000

## 4. Ce qui a été amélioré

- Interface qui s'adapte automatiquement aux téléphones, tablettes et ordinateurs.
- Largeur du panneau augmentée sur les grands écrans au lieu de rester bloquée à 600px.
- Textes et espacements avec `clamp()` pour mieux s'adapter.
- Champ + bouton empilés automatiquement sur petit écran.
- Résultat vidéo en deux colonnes sur écran large et une colonne sur téléphone.
- Téléchargement réel côté serveur.
- Formats contrôlés côté backend.
- Barre de progression basée sur la réponse téléchargée par le navigateur.

## Important

Utilise le service uniquement pour les contenus que tu as le droit de télécharger et dans le respect des conditions applicables aux plateformes et des droits d'auteur.
