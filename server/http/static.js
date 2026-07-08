"use strict";

const fs = require("fs");
const path = require("path");

function createStaticHandler({ publicDir } = {}) {
  if (!publicDir) throw new Error("publicDir is required");

  return function serveStatic(req, res, url) {
    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    filePath = decodeURIComponent(filePath);
    const absolute = path.resolve(publicDir, `.${filePath}`);
    if (!absolute.startsWith(publicDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.readFile(absolute, (error, data) => {
      if (error) {
        const fallback = path.join(publicDir, "index.html");
        fs.readFile(fallback, (fallbackError, fallbackData) => {
          if (fallbackError) {
            res.writeHead(404);
            res.end("Not found");
          } else {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(fallbackData);
          }
        });
        return;
      }
      res.writeHead(200, { "Content-Type": contentType(absolute) });
      res.end(data);
    });
  };
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".svg": "image/svg+xml; charset=utf-8",
      ".png": "image/png",
    }[ext] || "application/octet-stream"
  );
}

module.exports = {
  contentType,
  createStaticHandler,
};
