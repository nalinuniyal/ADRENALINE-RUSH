// Minimal SMTP server for tests: STARTTLS + AUTH (accepts anything), writes each
// message as one JSON line to mail.jsonl. Never use outside local testing.
import net from "node:net";
import tls from "node:tls";
import { appendFileSync, readFileSync } from "node:fs";
const dir = new URL(".", import.meta.url).pathname;
const key = readFileSync(dir + "smtp-key.pem");
const cert = readFileSync(dir + "smtp-cert.pem");
const PORT = Number(process.env.SMTP_SINK_PORT ?? 2587);

function session(socket, secured) {
  let buf = "";
  let mode = "cmd";
  let msg = { from: "", to: [], data: "" };
  const say = (l) => socket.write(l + "\r\n");
  if (!secured) say("220 localhost ESMTP sink");
  socket.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let i;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (mode === "data") {
        if (line === ".") {
          appendFileSync(dir + "mail.jsonl", JSON.stringify({ ...msg, at: new Date().toISOString() }) + "\n");
          msg = { from: "", to: [], data: "" };
          mode = "cmd";
          say("250 OK queued");
        } else msg.data += (line.startsWith("..") ? line.slice(1) : line) + "\n";
        continue;
      }
      if (mode === "auth-login") { mode = "auth-login2"; say("334 UGFzc3dvcmQ6"); continue; }
      if (mode === "auth-login2") { mode = "cmd"; say("235 Authenticated"); continue; }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === "EHLO" || cmd === "HELO") {
        socket.write(`250-localhost\r\n${secured ? "" : "250-STARTTLS\r\n"}250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n`);
      } else if (line.toUpperCase() === "STARTTLS") {
        say("220 Ready to start TLS");
        socket.removeAllListeners("data");
        const secure = new tls.TLSSocket(socket, { isServer: true, key, cert });
        session(secure, true);
        return;
      } else if (cmd === "AUTH") {
        if (/^AUTH LOGIN/i.test(line)) { mode = "auth-login"; say("334 VXNlcm5hbWU6"); } else say("235 Authenticated");
      } else if (cmd === "MAIL") { msg.from = line.replace(/^MAIL FROM:\s*/i, ""); say("250 OK"); }
      else if (cmd === "RCPT") { msg.to.push(line.replace(/^RCPT TO:\s*/i, "")); say("250 OK"); }
      else if (cmd === "DATA") { mode = "data"; say("354 End data with <CR><LF>.<CR><LF>"); }
      else if (cmd === "QUIT") { say("221 Bye"); socket.end(); }
      else if (cmd === "RSET" || cmd === "NOOP") say("250 OK");
      else say("502 Command not implemented");
    }
  });
  socket.on("error", () => {});
}

net.createServer((s) => session(s, false)).listen(PORT, "127.0.0.1", () => console.log("smtp sink on " + PORT));
