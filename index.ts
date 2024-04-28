#!/usr/bin/env bun

import type { ServerWebSocket } from "bun";
import fs from "fs";
import path from "path";
import { parseArgs } from "util";

const { positionals } = parseArgs({ args: Bun.argv, allowPositionals: true });

const socketConnections: ServerWebSocket<unknown>[] = [];

const servePath = positionals[2] || "app";

const stat = fs.statSync(servePath);

if (!stat.isDirectory()) {
  throw new Error("UNIMPLEMENTED: The path provided is not a directory");
}

const PORT = Math.floor(Math.random() * 1000) + 6000;

console.log("Serving", servePath + " on http://localhost:" + PORT);

Bun.serve({
  port: PORT,
  fetch: async (req, server) => {
    if (server.upgrade(req)) {
      // Websocket request
      return;
    }

    let filePath = new URL(req.url).pathname;

    if (filePath === "/") {
      filePath = "/index.html";
    }

    const file = Bun.file(path.join(servePath, filePath));

    if (filePath.endsWith(".html")) {
      // edit file content

      const content = await file.text();
      const newContent = content.replace(
        /<head>/,
        `<head><script>
        const ws = new WebSocket('ws://localhost:${PORT}');
        ws.onmessage = (event) => {
          if(event.data === 'reload') {
            location.reload();
          }
        }
      </script>`
      );

      return new Response(newContent, {
        headers: {
          "Content-Type": getFileContentType(filePath),
        },
      });
    }

    return new Response(file);
  },
  error: (err) => {
    if (err.code === "ENOENT") {
      return new Response("Not Found", { status: 404 });
    }

    return new Response("Internal Server Error", { status: 500 });
  },
  websocket: {
    message(ws, message) {
      socketConnections.forEach((socket) => {
        socket.send(message);
      });
    },
    open(ws) {
      socketConnections.push(ws);
      ws.send("Hello from server");
    },
  },
});

// Watch for file changes
const watcher = fs.watch(
  path.join(servePath),
  { recursive: true },
  (event, filename) => {
    socketConnections.forEach((socket) => {
      socket.send("reload");
    });
  }
);

const getFileContentType = (filePath: string) => {
  const extname = path.extname(filePath);
  switch (extname) {
    case ".js":
      return "text/javascript";
    case ".css":
      return "text/css";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
      return "image/jpg";
    default:
      return "text/html";
  }
};
