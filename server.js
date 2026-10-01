const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();

const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, 'public');

const YTDLP_COMMAND =
  process.platform === 'win32'
    ? 'yt-dlp.exe'
    : 'yt-dlp';


// ============================================================
// YOUTUBE COOKIES
// ============================================================

function getCookiesPath() {
  const candidates = [
    '/etc/secrets/cookies.txt',
    path.join(__dirname, 'cookies.txt'),
  ];

  return candidates.find(file => fs.existsSync(file)) || null;
}


// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());

app.use(
  express.json({
    limit: '1mb',
  }),
);

app.use(express.static(PUBLIC_DIR));


// ============================================================
// FORMATS
// ============================================================

const FORMAT_MAP = {
  video360:
    'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best[height<=360]',

  video480:
    'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[height<=480]',

  video720:
    'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]',

  video1080:
    'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]',

  audio:
    'bestaudio[ext=m4a]/bestaudio',
};


// ============================================================
// JOBS
// ============================================================

const jobs = new Map();


// ============================================================
// YOUTUBE URL
// ============================================================

function isValidYouTubeUrl(value) {
  try {
    const u = new URL(value);

    return [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtu.be',
      'www.youtu.be',
    ].includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}


// ============================================================
// TEMP DIRECTORY
// ============================================================

function createTempDirectory() {
  const id = crypto.randomBytes(8).toString('hex');

  const dir = path.join(
    os.tmpdir(),
    `downloadflow-${Date.now()}-${id}`,
  );

  fs.mkdirSync(dir, {
    recursive: true,
  });

  return dir;
}


function cleanupDirectory(dir) {
  if (!dir) return;

  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  } catch (e) {
    console.error(
      'Nettoyage temporaire impossible:',
      e.message,
    );
  }
}


// ============================================================
// FILE NAME
// ============================================================

function safeName(title, audio) {
  let name = String(
    title || 'DownloadFlow',
  )
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name) {
    name = 'DownloadFlow';
  }

  if (name.length > 150) {
    name = name.slice(0, 150).trim();
  }

  if (
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(
      name,
    )
  ) {
    name = `download-${name}`;
  }

  return `${name}.${audio ? 'm4a' : 'mp4'}`;
}


// ============================================================
// TIME
// ============================================================

function formatSeconds(seconds) {
  if (
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return '--';
  }

  seconds = Math.round(seconds);

  const h = Math.floor(seconds / 3600);

  const m = Math.floor(
    (seconds % 3600) / 60,
  );

  const s = seconds % 60;

  if (h) {
    return `${h}h ${String(m).padStart(
      2,
      '0',
    )}m ${String(s).padStart(2, '0')}s`;
  }

  if (m) {
    return `${m}m ${String(s).padStart(
      2,
      '0',
    )}s`;
  }

  return `${s}s`;
}


// ============================================================
// PARSE YT-DLP PROGRESS
// ============================================================

function parseProgressLine(line) {
  const clean = String(line)
    .replace(
      /\x1b\[[0-?]*[ -/]*[@-~]/g,
      '',
    )
    .trim();

  if (!clean) {
    return null;
  }

  const p = clean.match(
    /(\d+(?:\.\d+)?)%/,
  );

  const s = clean.match(
    /\bat\s+([^\s]+\/s)/i,
  );

  const e = clean.match(
    /\bETA\s+([0-9:]+)/i,
  );

  if (!p && !s && !e) {
    return null;
  }

  let eta = null;

  if (e) {
    const parts = e[1]
      .split(':')
      .map(Number);

    let sec = 0;

    if (parts.length === 3) {
      sec =
        parts[0] * 3600 +
        parts[1] * 60 +
        parts[2];
    } else if (parts.length === 2) {
      sec =
        parts[0] * 60 +
        parts[1];
    } else {
      sec = parts[0];
    }

    eta = formatSeconds(sec);
  }

  return {
    percent: p
      ? Math.min(
          100,
          Math.max(
            0,
            Number(p[1]),
          ),
        )
      : null,

    speed: s
      ? s[1]
      : null,

    eta,
  };
}


// ============================================================
// SSE BROADCAST
// ============================================================

function broadcast(job) {
  let type = 'progress';

  if (job.stage === 'complete') {
    type = 'complete';
  }

  if (job.stage === 'error') {
    type = 'error';
  }

  const payload = JSON.stringify({
    type,
    stage: job.stage,
    percent: job.percent,
    speed: job.speed,
    eta: job.eta,
    message: job.message,
  });

  console.log(
    `[SSE] ${job.id} -> ${payload}`,
  );

  for (const client of [
    ...job.clients,
  ]) {
    try {
      client.write(
        `data: ${payload}\n\n`,
      );
    } catch {
      job.clients =
        job.clients.filter(
          c => c !== client,
        );
    }
  }
}


// ============================================================
// UPDATE JOB
// ============================================================

function updateJob(job, patch) {
  Object.assign(job, patch);

  broadcast(job);
}


// ============================================================
// FINAL FILE
// ============================================================

function findFinalFile(dir) {
  if (!fs.existsSync(dir)) {
    return null;
  }

  const files = fs
    .readdirSync(dir)
    .filter(
      f =>
        !f.endsWith('.part') &&
        !f.endsWith('.ytdl') &&
        !f.endsWith('.tmp'),
    );

  const mp4 = files.find(
    f => /\.mp4$/i.test(f),
  );

  if (mp4) {
    return path.join(dir, mp4);
  }

  const audio = files.find(
    f =>
      /\.(m4a|mp3|webm|opus)$/i.test(f),
  );

  return audio
    ? path.join(dir, audio)
    : null;
}


// ============================================================
// FRIENDLY ERROR
// ============================================================

function friendlyError(error) {
  const t = `${error.message || ''} ${
    error.stderr || ''
  }`.toLowerCase();

  if (
    t.includes('403') ||
    t.includes('forbidden')
  ) {
    return 'YouTube a refusé le téléchargement. Vérifiez que yt-dlp est à jour.';
  }

  if (t.includes('private')) {
    return 'Cette vidéo est privée.';
  }

  if (t.includes('unavailable')) {
    return 'Cette vidéo est indisponible.';
  }

  if (t.includes('sign in')) {
    return 'YouTube demande une connexion pour accéder à cette vidéo.';
  }

  if (t.includes('ffmpeg')) {
    return 'FFmpeg est nécessaire pour fusionner la vidéo et l’audio.';
  }

  return 'Impossible de télécharger cette vidéo.';
}


// ============================================================
// SIMPLE YT-DLP
// ============================================================

function spawnSimple(args) {
  return new Promise(
    (resolve, reject) => {
      const child = spawn(
        YTDLP_COMMAND,
        args,
        {
          windowsHide: true,
        },
      );

      let stdout = '';
      let stderr = '';

      child.stdout.on(
        'data',
        d => {
          stdout += d.toString();
        },
      );

      child.stderr.on(
        'data',
        d => {
          stderr += d.toString();
        },
      );

      child.on(
        'error',
        reject,
      );

      child.on(
        'close',
        code => {
          if (code === 0) {
            resolve({
              stdout,
              stderr,
            });
          } else {
            const e = new Error(
              stderr ||
                stdout ||
                `yt-dlp code ${code}`,
            );

            e.stdout = stdout;
            e.stderr = stderr;
            e.code = code;

            reject(e);
          }
        },
      );
    },
  );
}


// ============================================================
// YT-DLP DOWNLOAD
// ============================================================

function spawnYtdlp(job, args) {
  return new Promise(
    (resolve, reject) => {
      const child = spawn(
        YTDLP_COMMAND,
        args,
        {
          cwd: job.tempDirectory,
          windowsHide: true,
        },
      );

      job.child = child;

      let stdout = '';
      let stderr = '';

      let stdoutBuffer = '';
      let stderrBuffer = '';

      function handleLine(line) {
        const clean = String(line)
          .replace(
            /\x1b\[[0-?]*[ -/]*[@-~]/g,
            '',
          )
          .trim();

        if (!clean) {
          return;
        }

        console.log(
          '[yt-dlp]',
          clean,
        );

        // ----------------------------------------------------
        // FUSION
        // ----------------------------------------------------

        if (
          clean.includes('[Merger]') ||
          clean.includes('[ExtractAudio]') ||
          clean.includes('[ffmpeg]')
        ) {
          updateJob(job, {
            stage: 'fusion',

            percent: 100,

            speed: null,

            eta: null,

            message:
              'Fusion et préparation du fichier...',
          });

          return;
        }

        // ----------------------------------------------------
        // DOWNLOAD PROGRESS
        // ----------------------------------------------------

        const progress =
          parseProgressLine(clean);

        if (progress) {
          updateJob(job, {
            stage: 'download',

            percent:
              progress.percent ??
              job.percent,

            speed:
              progress.speed ??
              job.speed,

            eta:
              progress.eta ??
              job.eta,

            message:
              'Téléchargement en cours...',
          });
        }
      }

      function processChunk(
        chunk,
        bufferName,
      ) {
        let buffer =
          bufferName === 'stdout'
            ? stdoutBuffer
            : stderrBuffer;

        buffer += chunk.toString();

        const lines =
          buffer.split(/[\r\n]+/);

        buffer =
          lines.pop() || '';

        for (const line of lines) {
          handleLine(line);
        }

        if (
          bufferName === 'stdout'
        ) {
          stdoutBuffer = buffer;
        } else {
          stderrBuffer = buffer;
        }
      }

      child.stdout.on(
        'data',
        d => {
          const s = d.toString();

          stdout += s;

          processChunk(
            s,
            'stdout',
          );
        },
      );

      child.stderr.on(
        'data',
        d => {
          const s = d.toString();

          stderr += s;

          processChunk(
            s,
            'stderr',
          );
        },
      );

      child.on(
        'error',
        reject,
      );

      child.on(
        'close',
        code => {
          if (stdoutBuffer) {
            handleLine(
              stdoutBuffer,
            );
          }

          if (stderrBuffer) {
            handleLine(
              stderrBuffer,
            );
          }

          job.child = null;

          if (code === 0) {
            resolve({
              stdout,
              stderr,
            });
          } else {
            const e = new Error(
              stderr.trim() ||
                stdout.trim() ||
                `yt-dlp code ${code}`,
            );

            e.stdout = stdout;
            e.stderr = stderr;
            e.code = code;

            reject(e);
          }
        },
      );
    },
  );
}


// ============================================================
// ANALYZE
// ============================================================

app.post(
  '/api/analyze',
  async (req, res) => {
    const { url } =
      req.body || {};

    if (
      !url ||
      !isValidYouTubeUrl(url)
    ) {
      return res.status(400).json({
        error:
          'Veuillez fournir un lien YouTube valide.',
      });
    }

    try {
      const analyzeArgs = [
        '--dump-single-json',
        '--no-playlist',
        '--skip-download',
        '--no-warnings',
      ];

      // --------------------------------------------------------
      // COOKIES
      // --------------------------------------------------------

      const cookiesPath =
        getCookiesPath();

      if (cookiesPath) {
        console.log(
          `[COOKIES] Analyse avec: ${cookiesPath}`,
        );

        analyzeArgs.push(
          '--cookies',
          cookiesPath,
        );
      } else {
        console.log(
          '[COOKIES] Aucun fichier cookies trouvé.',
        );
      }

      analyzeArgs.push(url);

      const result =
        await spawnSimple(
          analyzeArgs,
        );

      const info = JSON.parse(
        result.stdout,
      );

      const durationSeconds =
        Number(info.duration) || 0;

      res.json({
        success: true,

        video: {
          id: info.id || null,

          title:
            info.title ||
            'Vidéo YouTube',

          thumbnail:
            info.thumbnail ||
            null,

          duration:
            durationSeconds
              ? formatSeconds(
                  durationSeconds,
                )
              : 'Inconnue',

          durationSeconds,

          uploader:
            info.uploader ||
            info.channel ||
            'YouTube',

          channel:
            info.channel ||
            info.uploader ||
            'YouTube',

          webpage_url:
            info.webpage_url ||
            url,
        },

        formats: [
          {
            id: 'video360',
            label: 'Vidéo 360p',
            type: 'video',
          },
          {
            id: 'video480',
            label: 'Vidéo 480p',
            type: 'video',
          },
          {
            id: 'video720',
            label: 'Vidéo 720p',
            type: 'video',
          },
          {
            id: 'video1080',
            label: 'Vidéo 1080p',
            type: 'video',
          },
          {
            id: 'audio',
            label: 'Audio',
            type: 'audio',
          },
        ],
      });
    } catch (error) {
      console.error(
        'Erreur analyse:',
        error.stderr ||
          error.message,
      );

      res.status(500).json({
        error:
          friendlyError(error),
      });
    }
  },
);


// ============================================================
// DOWNLOAD
// ============================================================

app.post(
  '/api/download',
  (req, res) => {
    const {
      url,
      format,
      title,
    } = req.body || {};

    if (
      !url ||
      !isValidYouTubeUrl(url)
    ) {
      return res.status(400).json({
        error:
          'Lien YouTube invalide.',
      });
    }

    if (
      !format ||
      !FORMAT_MAP[format]
    ) {
      return res.status(400).json({
        error:
          'Format invalide.',
      });
    }

    const job = {
      id: crypto.randomUUID(),

      url,

      format,

      title:
        title ||
        'DownloadFlow',

      audio:
        format === 'audio',

      tempDirectory:
        createTempDirectory(),

      stage: 'download',

      percent: 0,

      speed: null,

      eta: null,

      message:
        'Préparation du téléchargement...',

      clients: [],

      filePath: null,

      fileName: null,

      error: null,

      child: null,

      completed: false,
    };

    jobs.set(
      job.id,
      job,
    );

    console.log(
      `[JOB] Créé: ${job.id}`,
    );

    res.json({
      success: true,
      jobId: job.id,
    });

    // --------------------------------------------------------
    // DOWNLOAD PROCESS
    // --------------------------------------------------------

    (async () => {
      try {
        const outputTemplate =
          path.join(
            job.tempDirectory,
            'downloadflow.%(ext)s',
          );

        const args = [
          '--no-playlist',

          '--no-warnings',

          '--newline',

          '--progress',

          '--restrict-filenames',

          '--trim-filenames',
          '120',

          '-f',
          FORMAT_MAP[format],

          '-o',
          outputTemplate,
        ];

        // ----------------------------------------------------
        // COOKIES
        // ----------------------------------------------------

        const cookiesPath =
          getCookiesPath();

        if (cookiesPath) {
          console.log(
            `[COOKIES] Téléchargement avec: ${cookiesPath}`,
          );

          args.push(
            '--cookies',
            cookiesPath,
          );
        } else {
          console.log(
            '[COOKIES] Aucun fichier cookies trouvé.',
          );
        }

        // ----------------------------------------------------
        // AUDIO
        // ----------------------------------------------------

        if (job.audio) {
          args.push(
            '--extract-audio',
            '--audio-format',
            'm4a',
            '--audio-quality',
            '0',
          );
        }

        // ----------------------------------------------------
        // VIDEO
        // ----------------------------------------------------

        else {
          args.push(
            '--merge-output-format',
            'mp4',
          );
        }

        args.push(url);

        updateJob(job, {
          stage: 'download',

          percent: 0,

          speed: null,

          eta: null,

          message:
            'Téléchargement en cours...',
        });

        // ----------------------------------------------------
        // START YT-DLP
        // ----------------------------------------------------

        await spawnYtdlp(
          job,
          args,
        );

        // ----------------------------------------------------
        // FUSION
        // ----------------------------------------------------

        updateJob(job, {
          stage: 'fusion',

          percent: 100,

          speed: null,

          eta: null,

          message:
            'Préparation du fichier final...',
        });

        // Petite vérification pour laisser
        // le temps au système de finaliser le fichier.
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              250,
            ),
        );

        // ----------------------------------------------------
        // FIND FINAL FILE
        // ----------------------------------------------------

        const filePath =
          findFinalFile(
            job.tempDirectory,
          );

        if (!filePath) {
          throw new Error(
            'Aucun fichier final trouvé après téléchargement.',
          );
        }

        // ----------------------------------------------------
        // FILE VALIDATION
        // ----------------------------------------------------

        const stat =
          fs.statSync(filePath);

        if (
          !stat.isFile() ||
          stat.size === 0
        ) {
          throw new Error(
            'Le fichier final est vide.',
          );
        }

        // ----------------------------------------------------
        // SAVE JOB FILE
        // ----------------------------------------------------

        job.filePath =
          filePath;

        job.fileName =
          safeName(
            job.title,
            job.audio,
          );

        job.completed = true;

        console.log(
          `[JOB] Fichier prêt: ${filePath}`,
        );

        // ----------------------------------------------------
        // COMPLETE
        // ----------------------------------------------------

        updateJob(job, {
          stage: 'complete',

          percent: 100,

          speed: null,

          eta: '0s',

          message:
            'Téléchargement terminé.',
        });

        console.log(
          `[JOB] Terminé: ${job.id}`,
        );

        // ----------------------------------------------------
        // AUTO CLEANUP
        // ----------------------------------------------------

        setTimeout(() => {
          if (
            jobs.has(job.id)
          ) {
            console.log(
              `[JOB] Expiration: ${job.id}`,
            );

            cleanupDirectory(
              job.tempDirectory,
            );

            jobs.delete(
              job.id,
            );
          }
        }, 10 * 60 * 1000);

      } catch (error) {
        console.error(
          'Erreur téléchargement:',
          error.stderr ||
            error.message,
        );

        job.error =
          friendlyError(error);

        updateJob(job, {
          stage: 'error',

          percent: 0,

          speed: null,

          eta: null,

          message:
            job.error,
        });

        setTimeout(() => {
          if (
            jobs.has(job.id)
          ) {
            cleanupDirectory(
              job.tempDirectory,
            );

            jobs.delete(
              job.id,
            );
          }
        }, 60 * 1000);
      }
    })();
  },
);


// ============================================================
// SSE PROGRESS
// ============================================================

app.get(
  '/api/progress/:jobId',
  (req, res) => {
    const job =
      jobs.get(
        req.params.jobId,
      );

    if (!job) {
      return res.status(404).json({
        error:
          'Tâche introuvable ou expirée.',
      });
    }

    res.setHeader(
      'Content-Type',
      'text/event-stream; charset=utf-8',
    );

    res.setHeader(
      'Cache-Control',
      'no-cache, no-transform',
    );

    res.setHeader(
      'Connection',
      'keep-alive',
    );

    res.setHeader(
      'X-Accel-Buffering',
      'no',
    );

    res.flushHeaders();

    job.clients.push(res);

    // --------------------------------------------------------
    // SEND CURRENT STATE IMMEDIATELY
    // --------------------------------------------------------

    let currentType =
      'progress';

    if (
      job.stage === 'complete'
    ) {
      currentType =
        'complete';
    }

    if (
      job.stage === 'error'
    ) {
      currentType =
        'error';
    }

    res.write(
      `data: ${JSON.stringify({
        type: currentType,

        stage: job.stage,

        percent: job.percent,

        speed: job.speed,

        eta: job.eta,

        message: job.message,
      })}\n\n`,
    );

    // --------------------------------------------------------
    // HEARTBEAT
    // --------------------------------------------------------

    const heartbeat =
      setInterval(() => {
        try {
          res.write(
            ': heartbeat\n\n',
          );
        } catch {}
      }, 10000);

    // --------------------------------------------------------
    // CLIENT DISCONNECTED
    // --------------------------------------------------------

    req.on(
      'close',
      () => {
        clearInterval(
          heartbeat,
        );

        job.clients =
          job.clients.filter(
            c => c !== res,
          );
      },
    );
  },
);


// ============================================================
// DOWNLOAD FINAL FILE
// ============================================================

app.get(
  '/api/download/:jobId/file',
  (req, res) => {
    const job =
      jobs.get(
        req.params.jobId,
      );

    if (!job) {
      return res.status(404).json({
        error:
          'Tâche introuvable ou expirée.',
      });
    }

    if (job.error) {
      return res.status(400).json({
        error: job.error,
      });
    }

    if (
      !job.filePath ||
      !fs.existsSync(
        job.filePath,
      )
    ) {
      return res.status(404).json({
        error:
          'Le fichier n’est pas encore prêt.',
      });
    }

    console.log(
      `[FILE] Envoi: ${job.filePath}`,
    );

    res.download(
      job.filePath,

      job.fileName ||
        'DownloadFlow.mp4',

      {
        headers: {
          'Cache-Control':
            'no-store',

          'X-DownloadFlow':
            'true',
        },
      },

      error => {
        cleanupDirectory(
          job.tempDirectory,
        );

        jobs.delete(
          job.id,
        );

        if (error) {
          console.error(
            'Erreur envoi fichier:',
            error.message,
          );
        } else {
          console.log(
            `[FILE] Envoyé puis supprimé: ${job.id}`,
          );
        }
      },
    );
  },
);


// ============================================================
// HEALTH
// ============================================================

app.get(
  '/api/health',
  (req, res) => {
    res.json({
      ok: true,

      service:
        'DownloadFlow',

      version:
        'progress-sse-2.0',
    });
  },
);


// ============================================================
// API 404
// ============================================================

app.use(
  '/api',
  (req, res) => {
    res.status(404).json({
      error:
        'Route API introuvable.',
    });
  },
);


// ============================================================
// GENERAL 404
// ============================================================

app.use(
  (req, res) => {
    res.status(404).send(
      'Page introuvable.',
    );
  },
);


// ============================================================
// SERVER
// ============================================================

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log('');
    console.log(
      '========================================',
    );
    console.log(
      '       DownloadFlow started',
    );
    console.log(
      '========================================',
    );
    console.log(
      `Serveur : http://localhost:${PORT}`,
    );
    console.log(
      `Réseau : http://192.168.1.68:${PORT}`,
    );
    console.log(
      `Frontend: http://localhost:${PORT}`,
    );
    console.log(
      `yt-dlp  : ${YTDLP_COMMAND}`,
    );

    const cookiesPath =
      getCookiesPath();

    if (cookiesPath) {
      console.log(
        `Cookies : ${cookiesPath}`,
      );
    } else {
      console.log(
        'Cookies : aucun fichier trouvé',
      );
    }

    console.log('');
  },
);