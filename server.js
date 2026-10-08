/*
  MAGEN | Backend geral (JavaScript)

  ESP32 --ws /esp--> [backend] --HTTP POST--> Python (processamento, parte do colega)
                        |  <------ resultado (JSON) ------'
                        |--> MySQL (guarda o resultado)
                        '--ws--> app e site (leitura ao vivo + resultado)

  Rodar:  npm install  e  node server.js
  Variáveis (todas opcionais):
    PROCESSAMENTO_URL   ex.: http://localhost:5000/processar  (sem ela, usa um cálculo local simples)
    DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT   (sem elas, não grava no banco)
    PORT (padrão 8080)
*/
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const PROCESSAMENTO_URL = process.env.PROCESSAMENTO_URL || "";
const INTERVALO_MS = 5000;   // de quanto em quanto tempo as leituras vão para processamento
const GRAVIDADE = 9.81, LIMITE_ATENCAO = 1.5, LIMITE_ALERTA = 3.0;  // só para o cálculo local
const STATUS_OK = ["normal", "atencao", "alerta"];

/* ---------- banco (opcional) ---------- */
let pool = null;
if (process.env.DB_HOST) {
  pool = require("mysql2/promise").createPool({
    host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, connectionLimit: 3
  });
  console.log("[banco] MySQL configurado");
} else console.log("[banco] sem DB_HOST: resultados só ficam na memória");

const recentes = [];  // últimos 50, usados quando não há banco
async function salvar(r) {
  recentes.unshift({ ...r, criado_em: new Date().toISOString() });
  recentes.length = Math.min(recentes.length, 50);
  if (!pool) return;
  try {
    await pool.execute(
      "INSERT INTO resultados (status, amostras, vib_media, vib_max, inclinacao_max, mensagem, detalhes) VALUES (?,?,?,?,?,?,?)",
      [r.status, r.amostras, r.vib_media, r.vib_max, r.inclinacao_max, r.mensagem, r.detalhes ? JSON.stringify(r.detalhes) : null]);
  } catch (e) { console.error("[banco] erro ao salvar:", e.message); }
}
async function historico(limite) {
  if (!pool) return recentes.slice(0, limite);
  const [rows] = await pool.query("SELECT * FROM resultados ORDER BY id DESC LIMIT ?", [limite]);
  return rows;
}

/* ---------- servidor ---------- */
const esps = new Set(), apps = new Set();
const json = (res, obj, code = 200) => {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(obj));
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/saude") return json(res, { ok: true, esp: esps.size > 0, apps: apps.size, processamento: !!PROCESSAMENTO_URL });
  if (url.pathname === "/resultados") {
    const limite = Math.min(Math.max(parseInt(url.searchParams.get("limite")) || 20, 1), 200);
    try { return json(res, await historico(limite)); } catch (e) { return json(res, { erro: e.message }, 500); }
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server });
const enviar = (obj) => { const m = JSON.stringify(obj); for (const c of apps) if (c.readyState === 1) c.send(m); };

wss.on("connection", (ws, req) => {
  const ehEsp = (req.url || "").startsWith("/esp");
  (ehEsp ? esps : apps).add(ws);
  ws.vivo = true; ws.on("pong", () => { ws.vivo = true; });
  console.log(`[conexão] ${ehEsp ? "ESP32" : "app/site"} | esp: ${esps.size} | apps: ${apps.size}`);
  ws.on("message", (raw) => { if (ehEsp) receber(raw); });
  ws.on("close", () => { (ehEsp ? esps : apps).delete(ws); console.log(`[saiu] ${ehEsp ? "ESP32" : "app/site"}`); });
  ws.on("error", () => ws.terminate());
});

/* ---------- leituras e processamento ---------- */
let janela = [], processando = false;
function receber(raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  const a = { ax: +m.ax, ay: +m.ay, az: +m.az, t: Date.now() };
  if ([a.ax, a.ay, a.az].some(Number.isNaN)) return;
  janela.push(a);
  enviar(a);   // leitura ao vivo para o gráfico do app
}

function calcularLocal(am) {  // plano B enquanto o Python não está ligado
  const vib = am.map((a) => Math.abs(Math.hypot(a.ax, a.ay, a.az) - GRAVIDADE));
  const inc = am.map((a) => Math.atan2(Math.hypot(a.ax, a.ay), Math.abs(a.az)) * 180 / Math.PI);
  const max = (v) => v.reduce((x, y) => (y > x ? y : x), 0);
  return {
    status: max(vib) >= LIMITE_ALERTA ? "alerta" : max(vib) >= LIMITE_ATENCAO ? "atencao" : "normal",
    vib_media: vib.reduce((s, v) => s + v, 0) / vib.length, vib_max: max(vib), inclinacao_max: max(inc)
  };
}

async function processar() {
  if (processando || !janela.length) return;
  processando = true;
  const amostras = janela; janela = [];
  try {
    let r = null;
    if (PROCESSAMENTO_URL) {
      try {
        const resp = await fetch(PROCESSAMENTO_URL, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amostras, intervalo_ms: INTERVALO_MS }),
          signal: AbortSignal.timeout(4000)
        });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        r = await resp.json();
        if (!STATUS_OK.includes(r.status)) throw new Error("resposta sem 'status' válido");
      } catch (e) { console.error("[processamento] falhou (" + e.message + "), usando cálculo local"); r = null; }
    }
    if (!r) r = calcularLocal(amostras);

    const { status, mensagem, vib_media, vib_max, inclinacao_max, amostras: n, ...extras } = r;
    const num = (v) => (v == null || Number.isNaN(+v) ? null : +(+v).toFixed(3));
    const resultado = {
      status, amostras: n ?? amostras.length, vib_media: num(vib_media), vib_max: num(vib_max),
      inclinacao_max: num(inclinacao_max), mensagem: mensagem ? String(mensagem).slice(0, 200) : null,
      detalhes: Object.keys(extras).length ? extras : null
    };
    await salvar(resultado);
    enviar({ tipo: "resultado", ...resultado, t: Date.now() });
  } finally { processando = false; }
}
setInterval(processar, INTERVALO_MS);

setInterval(() => {  // derruba conexões mortas
  for (const ws of [...esps, ...apps]) { if (!ws.vivo) { ws.terminate(); continue; } ws.vivo = false; ws.ping(); }
}, 15000);

server.listen(PORT, "0.0.0.0", () => console.log(`MAGEN backend na porta ${PORT} | processamento: ${PROCESSAMENTO_URL || "cálculo local"}`));
