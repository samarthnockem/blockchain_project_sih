const { createReadStream } = require("node:fs");
const { stat } = require("node:fs/promises");
const { createServer } = require("node:http");
const { extname, isAbsolute, join, normalize, relative, resolve } = require("node:path");

const PORT = Number(process.env.PORT || 8000);
const ROOT = resolve(process.cwd());
const SERVER_ENV = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const REQUESTED_MODE = String(process.env.KRYPTO_FRONTEND_MODE || process.env.FRONTEND_MODE || "REAL_MODE").trim().toUpperCase();
const RUNTIME_MODE = SERVER_ENV !== "production" && REQUESTED_MODE === "DEMO_MODE" ? "DEMO_MODE" : "REAL_MODE";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

function resolveRequestPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = normalize(join(ROOT, requestedPath));
  const relativePath = relative(ROOT, filePath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return null;
  }

  return filePath;
}

createServer(async (req, res) => {
  try {
    if ((req.url || "").split("?")[0] === "/runtime-config.js") {
      res.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/javascript; charset=utf-8"
      });
      res.end(
        `window.KRYPTO_APP_MODE=${JSON.stringify(RUNTIME_MODE)};\n` +
        `window.KRYPTO_ALLOW_DEMO_MODE=${JSON.stringify(RUNTIME_MODE === "DEMO_MODE")};\n`
      );
      return;
    }

    const filePath = resolveRequestPath(req.url || "/");
    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(PORT, () => {
  console.log(`KryptoVault frontend running at http://localhost:${PORT} in ${RUNTIME_MODE}`);
});
