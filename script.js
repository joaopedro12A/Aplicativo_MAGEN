/* ============ CONFIGURAÇÃO (mexa só aqui) ============ */
const CONFIG = {
  // Tempo da tela de abertura (logo e círculo de carregamento), em milissegundos.
  // 2800 = 2,8 segundos. Abaixo de 1500 o círculo mal aparece.
  TEMPO_ABERTURA_MS: 5800,

  // true = o status (Normal/Atenção/Alerta) vem do processamento, via backend.
  // false = o app calcula sozinho com os limites abaixo.
  USAR_PROCESSAMENTO: true,

  // Endereço do backend. Vazio = automático: mesmo IP da página, porta 8080.
  // Backend hospedado (Render): "wss://seu-backend.onrender.com"
  WS_URL: "",
  WS_PORT: 8080,

  // true = dados simulados, sem ESP nem backend. Também funciona abrindo app.html?demo
  DEMO: false,

  // Se o ESP enviar aceleração em m/s² use 9.81. Se enviar em g, use 1.
  GRAVIDADE: 9.81,

  // Limites de vibração (m/s²) e inclinação (graus). Ajustem com testes reais.
  LIMITE_ATENCAO: 1.5,
  LIMITE_ALERTA: 3.0,
  LIMITE_INCLINACAO: 10,

  AMOSTRAS_GRAFICO: 120,   // pontos visíveis no gráfico
  INTERVALO_LEITURA_MS: 5000, // a cada quanto tempo registrar em "Últimas leituras"
  INTERVALO_ALERTA_MS: 3000   // intervalo mínimo entre alertas
};

/*
  Formato esperado de cada mensagem do backend (JSON):
  { "ax": 0.12, "ay": -0.05, "az": 9.81 }
  Opcionais: "tilt" (graus) e "status" ("normal" | "atencao" | "alerta").
  Se não vierem, o app calcula.
*/

/* ============ ESTADO ============ */
const $ = (id) => document.getElementById(id);
const STATUS = {
  normal: { label: "Normal",  cls: "ok",   msg: "Estrutura estável" },
  atencao:{ label: "Atenção", cls: "warn", msg: "Vibração acima do normal" },
  alerta: { label: "Alerta",  cls: "bad",  msg: "Possível anomalia detectada" }
};
const ICON = {
  ok: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5M12 17h.01"/></svg>',
  bad: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v6M12 17h.01"/></svg>'
};
const buf = { x: [], y: [], z: [] };
let readings = [], alerts = [];
let lastData = 0, lastReading = 0, lastAlert = 0, unseen = false, ws = null;
const demo = CONFIG.DEMO || location.search.includes("demo");

/* ============ CONEXÃO ============ */
function setConn(state, text) {
  $("conn").dataset.state = state;
  $("conn-text").textContent = text;
}

function wsUrl() {
  if (CONFIG.WS_URL) return CONFIG.WS_URL;
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  return proto + (location.hostname || "localhost") + ":" + CONFIG.WS_PORT;
}

function connect() {
  setConn("connecting", "Conectando ao servidor...");
  try { ws = new WebSocket(wsUrl()); }
  catch (e) { setConn("off", "Sem conexão. Verifique o Wi-Fi."); return setTimeout(connect, 2000); }

  ws.onopen = () => setConn("on", "Conectado ao servidor");
  ws.onmessage = (ev) => {
    try { const m = JSON.parse(ev.data); m.tipo === "resultado" ? handleResultado(m) : handleData(m); } catch (e) { /* ignora mensagem inválida */ }
  };
  ws.onclose = () => {
    setConn("off", "Sem conexão. Verifique o Wi-Fi.");
    $("live").hidden = true;
    setTimeout(connect, 2000);
  };
  ws.onerror = () => ws.close();
}

/* ============ DADOS ============ */
function handleData(m) {
  const ax = +m.ax, ay = +m.ay, az = +m.az;
  if ([ax, ay, az].some(Number.isNaN)) return;
  const now = Date.now();
  lastData = now;

  const mag = Math.sqrt(ax * ax + ay * ay + az * az);
  const vib = Math.abs(mag - CONFIG.GRAVIDADE);
  const tilt = m.tilt != null ? +m.tilt : Math.atan2(Math.sqrt(ax * ax + ay * ay), Math.abs(az)) * 180 / Math.PI;

  $("v-acc").textContent = vib.toFixed(2);
  $("v-tilt").textContent = tilt.toFixed(1);
  if (!CONFIG.USAR_PROCESSAMENTO || demo) {
    let st = String(m.status || "").toLowerCase();
    if (!STATUS[st]) st = vib >= CONFIG.LIMITE_ALERTA ? "alerta" : vib >= CONFIG.LIMITE_ATENCAO ? "atencao" : "normal";
    aplicarStatus(st, vib, tilt, now);
  }
  $("live").hidden = false;
  if ($("conn").dataset.state !== "off") setConn("on", demo ? "Modo demonstração" : "Conectado ao protótipo");

  // gráfico
  [["x", ax], ["y", ay], ["z", az]].forEach(([k, v]) => {
    buf[k].push(v);
    if (buf[k].length > CONFIG.AMOSTRAS_GRAFICO) buf[k].shift();
  });
  drawChart();
}

/* resultado do processamento (Python -> backend -> app) */
function handleResultado(m) {
  const st = String(m.status || "").toLowerCase();
  if (!STATUS[st]) return;
  aplicarStatus(st, +m.vib_max || 0, +m.inclinacao_max || 0, Date.now(), m.mensagem, true);
}

function aplicarStatus(st, vib, tilt, now, msg, forcar) {
  const s = STATUS[st], texto = msg || s.msg;
  $("v-status").textContent = s.label;
  $("v-status").className = s.cls;
  $("v-status-msg").textContent = texto;
  $("status-ico").className = "ico " + s.cls;

  // últimas leituras
  if (forcar || now - lastReading >= CONFIG.INTERVALO_LEITURA_MS) {
    lastReading = now;
    let text = "Leitura registrada", cls = s.cls, label = s.label;
    if (st === "alerta") text = "Vibração acima do limite";
    else if (st === "atencao") text = "Vibração moderada detectada";
    else if (tilt > CONFIG.LIMITE_INCLINACAO) { text = "Inclinação fora do padrão"; cls = "warn"; label = "Atenção"; }
    readings.unshift({ t: now, text, cls, label });
    readings = readings.slice(0, 3);
    renderList("readings", readings);
  }

  // alertas
  if (st !== "normal" && now - lastAlert >= CONFIG.INTERVALO_ALERTA_MS) {
    lastAlert = now;
    alerts.unshift({ t: now, text: texto + " (" + vib.toFixed(2) + " m/s²)", cls: s.cls, label: s.label });
    alerts = alerts.slice(0, 20);
    renderList("alerts", alerts);
    notify(s.label, texto);
    if (!$("view-alerts").classList.contains("active")) { unseen = true; $("bell-dot").hidden = false; }
  }
}

function renderList(id, items) {
  $(id).innerHTML = items.map((i) =>
    `<li class="item">
       <span class="ico ${i.cls}">${ICON[i.cls]}</span>
       <div class="txt"><b>${i.text}</b><span>${new Date(i.t).toLocaleTimeString("pt-BR")}</span></div>
       <span class="badge ${i.cls}">${i.label}</span>
     </li>`).join("");
  $(id + "-empty").hidden = items.length > 0;
}

/* ============ GRÁFICO ============ */
const canvas = $("chart"), ctx = canvas.getContext("2d");
const COLORS = { x: "#2F6FED", y: "#1FA971", z: "#E5484D" };

function drawChart() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const all = buf.x.concat(buf.y, buf.z);
  if (!all.length) return;
  let min = Math.min(...all), max = Math.max(...all);
  const pad = (max - min || 1) * 0.1; min -= pad; max += pad;
  const L = 34, R = 6, T = 8, B = 8, pw = w - L - R, ph = h - T - B;
  const Y = (v) => T + ph - ((v - min) / (max - min)) * ph;

  ctx.font = "10px sans-serif"; const cs = getComputedStyle(document.documentElement);
  ctx.fillStyle = cs.getPropertyValue("--muted"); ctx.strokeStyle = cs.getPropertyValue("--line"); ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const v = min + ((max - min) * i) / 3, y = Y(v);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
    ctx.fillText(v.toFixed(1), 2, y + 3);
  }
  ctx.lineWidth = 2; ctx.lineJoin = "round";
  ["x", "y", "z"].forEach((k) => {
    ctx.strokeStyle = COLORS[k]; ctx.beginPath();
    buf[k].forEach((v, i) => {
      const x = L + (i / (CONFIG.AMOSTRAS_GRAFICO - 1)) * pw;
      i ? ctx.lineTo(x, Y(v)) : ctx.moveTo(x, Y(v));
    });
    ctx.stroke();
  });
}
window.addEventListener("resize", drawChart);

/* ============ NAVEGAÇÃO ============ */
function show(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.querySelector(".tabs").style.setProperty("--i", [...document.querySelectorAll(".tab")].findIndex((t) => t.dataset.view === view));
  if (view === "alerts") { unseen = false; $("bell-dot").hidden = true; }
  if (view === "home") drawChart();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.view)));
$("bell").addEventListener("click", () => show("alerts"));

/* ============ MODO DEMONSTRAÇÃO ============ */
function startDemo() {
  let n = 0;
  setConn("on", "Modo demonstração");
  setInterval(() => {
    n++;
    const burst = (n % 250) > 220 ? ((n % 250) - 220) / 6 : 0; // pico a cada ~25 s
    const r = () => (Math.random() - 0.5) * 0.3;
    handleData({
      ax: r() + burst * Math.sin(n),
      ay: r() + burst * Math.cos(n),
      az: CONFIG.GRAVIDADE + r() + burst
    });
  }, 100);
}

/* ============ INÍCIO ============ */
renderList("readings", readings);
renderList("alerts", alerts);
setInterval(() => { // sem dados do sensor há 5 s
  if (!demo && $("conn").dataset.state === "on" && lastData && Date.now() - lastData > 5000) {
    setConn("connecting", "Servidor ok, sem dados do sensor");
    $("live").hidden = true;
  }
}, 1000);
let started = false;
function startData() { if (started) return; started = true; demo ? startDemo() : connect(); }

/* ============ FLUXO DO APP ============ */
const store = {
  get(k, d) { try { const v = localStorage.getItem("magen_" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("magen_" + k, JSON.stringify(v)); } catch (e) {} }
};
const me = { name: store.get("name", ""), onboarded: store.get("onboarded", false), session: store.get("session", false), notif: store.get("notif", false), theme: store.get("theme", "dark") };

function go(route) {
  document.body.dataset.route = route;
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("on", s.id === "s-" + route));
  if (route === "app") { startData(); show("home"); }
}
function applyTheme(t) {
  me.theme = t; store.set("theme", t); document.documentElement.dataset.theme = t;
  document.querySelectorAll("#seg-theme button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  document.querySelector('meta[name="theme-color"]').content = t === "dark" ? "#0B1220" : "#EEF3FC";
  drawChart();
}
function setName(n) {
  me.name = n; store.set("name", n);
  $("user-name").textContent = n; $("set-name").value = n; $("login-name").value = n;
  $("login-btn").disabled = !n;
}
function setNotif(v) { me.notif = v; store.set("notif", v); $("sw-notif").setAttribute("aria-checked", v); }
function enter() { me.onboarded = me.session = true; store.set("onboarded", true); store.set("session", true); go("app"); }
async function askPerm() {
  if (!("Notification" in window)) return "unsupported";
  try { return await Notification.requestPermission(); } catch (e) { return "denied"; }
}

/* toast e notificação */
let tt;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 3500);
}
function notify(title, body) {
  if (!me.notif || document.body.dataset.route !== "app") return;
  toast(title + ": " + body);
  if (navigator.vibrate) navigator.vibrate(200);
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification("MAGEN | " + title, { body }); } catch (e) {}
  }
}

/* onboarding */
let slide = 0; const N = 3, track = $("slides");
function setSlide(i) {
  slide = Math.max(0, Math.min(N - 1, i));
  track.style.transform = "translateX(-" + slide * 100 + "%)";
  document.querySelectorAll("#dots i").forEach((d, k) => d.classList.toggle("on", k === slide));
  document.querySelectorAll(".slide").forEach((s, k) => s.classList.toggle("act", k === slide));
  $("onb-next").firstElementChild.textContent = slide === N - 1 ? "Começar" : "Continuar";
}
$("onb-next").onclick = () => (slide === N - 1 ? go("name") : setSlide(slide + 1));
$("skip").onclick = () => go("name");
let x0 = null;
track.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
track.addEventListener("touchend", (e) => {
  if (x0 === null) return;
  const dx = e.changedTouches[0].clientX - x0;
  if (Math.abs(dx) > 40) setSlide(slide + (dx < 0 ? 1 : -1));
  x0 = null;
});

/* nome, notificações e login */
const enterKey = (input, btn) => input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !btn.disabled) btn.click(); });
$("name-in").addEventListener("input", (e) => { $("name-next").disabled = !e.target.value.trim(); });
$("name-next").onclick = () => { setName($("name-in").value.trim()); go("notif"); };
enterKey($("name-in"), $("name-next"));

$("notif-yes").onclick = async () => {
  const p = await askPerm(); setNotif(true);
  if (p === "granted") return enter();
  $("notif-msg").textContent = "O navegador não liberou notificações do sistema. Os alertas aparecerão dentro do app.";
  setTimeout(enter, 2400);
};
$("notif-no").onclick = () => { setNotif(false); enter(); };

$("login-name").addEventListener("input", (e) => { $("login-btn").disabled = !e.target.value.trim(); });
$("login-btn").onclick = () => { setName($("login-name").value.trim()); me.session = true; store.set("session", true); go("app"); };
enterKey($("login-name"), $("login-btn"));

/* ajustes */
$("save-name").onclick = () => { const v = $("set-name").value.trim(); if (v) { setName(v); toast("Nome atualizado"); } };
$("sw-notif").onclick = () => { const v = !me.notif; setNotif(v); if (v) askPerm(); };
document.querySelectorAll("#seg-theme button").forEach((b) => b.addEventListener("click", () => applyTheme(b.dataset.t)));
$("logout").onclick = () => { me.session = false; store.set("session", false); go("login"); };

/* início */
setName(me.name); setNotif(me.notif); applyTheme(me.theme);
setTimeout(() => go(!me.session ? (me.onboarded ? "login" : "onb") : "app"), CONFIG.TEMPO_ABERTURA_MS);
