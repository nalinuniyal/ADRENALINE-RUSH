// Routes /rest/v1 -> PostgREST, /auth/v1 -> GoTrue, like the Supabase gateway.
import http from "node:http";
const routes = [["/rest/v1", 54330], ["/auth/v1", 54331]];
http.createServer((req, res) => {
  const r = routes.find(([p]) => req.url.startsWith(p));
  if (!r) { res.writeHead(404); return res.end("no route"); }
  const path = req.url.slice(r[0].length) || "/";
  const headers = { ...req.headers, host: `127.0.0.1:${r[1]}` };
  const up = http.request({ host: "127.0.0.1", port: r[1], method: req.method, path, headers }, (u) => {
    res.writeHead(u.statusCode, u.headers); u.pipe(res);
  });
  up.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(up);
}).listen(54321, () => console.log("gateway on 54321"));
