import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = new URL("../../.output/integration/", import.meta.url).pathname;

const index = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><title>AWSM integration harness</title></head>
  <body><output id="result" aria-live="polite">running</output>
  <script type="module" src="/tests/integration/browser/harness.js"></script></body>
</html>`;

const types = {
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(index);
    return;
  }
  const relative = normalize(url.pathname).replace(/^[/\\]+/u, "");
  let path = join(root, relative);
  if (existsSync(path) && statSync(path).isDirectory()) {
    response.writeHead(302, { location: `${url.pathname.replace(/\/$/u, "")}/index.js` });
    response.end();
    return;
  } else if (!existsSync(path) && extname(path) === "") {
    path = `${path}.js`;
  }
  if (!path.startsWith(root) || !existsSync(path)) {
    response.writeHead(404);
    response.end("not found");
    return;
  }
  response.writeHead(200, {
    "content-type": types[extname(path)] ?? "application/octet-stream",
  });
  createReadStream(path).pipe(response);
}).listen(4173, "127.0.0.1");
