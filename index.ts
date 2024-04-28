#!/usr/bin/env bun

import type { ServerWebSocket } from "bun";
import fs from "fs";
import path from "path";
import { parseArgs } from "util";

const { positionals, values } = parseArgs({
  args: Bun.argv,

  options: {
    port: {
      type: "string",
      alias: "p",
      description: "Port to serve on",
      default: "5100",
    },
  },

  allowPositionals: true,
});

const socketConnections: ServerWebSocket<unknown>[] = [];

const servePath = positionals[2] || ".";

const printUsage = () => {
  console.log("Usage: bunx spark <path> [--port <port>]");
};

if (!fs.existsSync(servePath)) {
  console.error("Path does not exist");
  printUsage();
  process.exit(1);
}

if (servePath === "--help") {
  printUsage();
  process.exit(0);
}

const isFile = fs.statSync(servePath).isFile();

const serverDir = isFile ? path.dirname(servePath) : servePath;

const PORT = values.port;

try {
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

      const file = Bun.file(path.join(serverDir, filePath));

      if (filePath.endsWith(".html")) {
        // edit file content

        const content = await file.text();
        const newContent = content.replace(
          /<head>/,
          `<head><script defer>
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

      console.error(err);

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

  console.log("Serving", servePath + " on http://localhost:" + PORT);
} catch (error: any) {
  if (error?.code === "EADDRINUSE") {
    console.error("Port already in use");
    printUsage();
    process.exit(1);
  }

  console.error(error);
  printUsage();
}

// Watch for file changes
const watcher = fs.watch(
  path.join(serverDir),
  { recursive: true },
  (event, filename) => {
    if (filename?.startsWith(".") || filename?.startsWith("node_modules")) {
      return;
    }

    console.log(`File ${event}d: ${filename}`);

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
