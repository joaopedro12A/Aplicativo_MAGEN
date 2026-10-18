/* ============ CONFIGURAÇÃO (mexa só aqui) ============ */
const CONFIG = {
  // Tempo da tela de abertura (logo e círculo de carregamento), em milissegundos.
  // 2800 = 2,8 segundos. Abaixo de 1500 o círculo mal aparece.
  TEMPO_ABERTURA_MS: 5800,

  // true = o status (Normal/Atenção/Alerta) vem do processamento, via backend.
  // false = o app calcula sozinho com os limites abaixo.
  USAR_PROCESSAMENTO: true,

  // O endereço do backend fica no api.js (API_URL). Aqui só o ritmo da consulta.
  INTERVALO_BACKEND_MS: 3000,  // a cada quanto tempo perguntar o status ao backend
  SEM_DADOS_MS: 120000,        // sem coleta nova por esse tempo = "sem dados do sensor"

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
  O app consulta o backend (api.js -> GET /api/status/:id) e recebe o resultado do processamento:
  integridade (0 a 100) e nivel (normal | atencao | alerta). Se o nivel não for reconhecido,
  o status é decidido pela porcentagem.
  Faixas: 60-100 normal (verde) | 30-59 atenção (amarelo) | 0-29 alerta (vermelho).

  Modo demonstração (?demo) ainda aceita mensagens no formato { "ax": 0.12, "ay": -0.05, "az": 9.81 }
  com opcionais "tilt" (graus) e "status" ("normal" | "atencao" | "alerta").
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
let readings = [], alerts = [];
let lastData = 0, lastReading = 0, lastAlert = 0, lastGauge = 0, unseen = false;
const sim = location.search.includes("sim");   // index.html?sim = controle manual do círculo
const demo = CONFIG.DEMO || location.search.includes("demo") || sim;

/* ============ CONEXÃO ============ */
function setConn(state, text) {
  $("conn").dataset.state = state;
  $("conn-text").textContent = text;
}

/* Backend: consulta o status por HTTP (api.js) em vez de WebSocket */
const NIVEL_PARA_STATUS = { normal: "normal", atencao: "atencao", "atenção": "atencao", alerta: "alerta", critico: "alerta", "crítico": "alerta" };
let ultimaColeta = null, timerBackend = 0;

async function consultarBackend() {
  try {
    const s = await buscarStatus();
    if (s.id_coleta === ultimaColeta) return;   // nada novo desde a última consulta
    ultimaColeta = s.id_coleta;
    lastData = Date.now();
    setConn("on", "Conectado ao servidor");
    handleResultado({
      status: NIVEL_PARA_STATUS[String(s.nivel || "").toLowerCase()] || statusPorPct(s.integridade),
      integridade: s.integridade,
      vib_max: s.rms,
      inclinacao_max: 0
    });
  } catch (e) {
    ultimaColeta = null;   // ao voltar a conexão, reaplica o último status
    if (e.message && e.message.includes("sem coletas")) {
      setConn("on", "Servidor ok, sem dados do sensor");
      setGauge(null, null, "Aguardando leituras");
    } else {
      setConn("off", "Sem conexão. Verifique o Wi-Fi.");
      setGauge(null, null, "Sem conexão");
    }
  }
}

function connect() {
  setConn("connecting", "Conectando ao servidor...");
  consultarBackend();
  clearInterval(timerBackend);
  timerBackend = setInterval(consultarBackend, CONFIG.INTERVALO_BACKEND_MS);
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

  if (!CONFIG.USAR_PROCESSAMENTO || demo) {
    let st = String(m.status || "").toLowerCase();
    const pct = m.integridade != null ? +m.integridade : calcIntegridade(vib, tilt);
    if (!STATUS[st]) st = statusPorPct(pct);
    const msg = st !== "normal" && vib < CONFIG.LIMITE_ATENCAO && tilt > CONFIG.LIMITE_INCLINACAO ? "Inclinação fora do padrão" : undefined;
    aplicarStatus(st, vib, tilt, now, msg, false, pct);
  }
  if ($("conn").dataset.state !== "off") setConn("on", demo ? "Modo demonstração" : "Conectado ao protótipo");
}

/* resultado do processamento (Python -> backend -> app) */
function handleResultado(m) {
  const st = String(m.status || "").toLowerCase();
  if (!STATUS[st]) return;
  let pct = m.integridade != null ? +m.integridade : (m.detalhes && m.detalhes.integridade != null ? +m.detalhes.integridade : null);
  if (pct == null || Number.isNaN(pct)) pct = m.vib_max != null ? calcIntegridade(+m.vib_max || 0, +m.inclinacao_max || 0) : TIPICO[st];
  aplicarStatus(st, +m.vib_max || 0, +m.inclinacao_max || 0, Date.now(), m.mensagem, true, pct);
}

/* ============ INTEGRIDADE (0 a 100%) ============ */
const FAIXA = { normal: [60, 100], atencao: [30, 59], alerta: [0, 29] };
const TIPICO = { normal: 90, atencao: 45, alerta: 15 };   // usado se o processamento não enviar percentual
const statusPorPct = (p) => (p >= 60 ? "normal" : p >= 30 ? "atencao" : "alerta");

// 100% = parado. Ao chegar no limite de atenção cai para 60%; no dobro desse limite, para 30%; no triplo, 0%.
function calcIntegridade(vib, tilt) {
  const r = Math.max(vib / CONFIG.LIMITE_ATENCAO, tilt / CONFIG.LIMITE_INCLINACAO);
  let p = r <= 1 ? 100 - 40 * r : r <= 2 ? 60 - 30 * (r - 1) : 30 - 30 * (r - 2);
  if (r >= 1) p = Math.min(p, 59);
  if (r >= 2) p = Math.min(p, 29);
  return Math.max(0, Math.min(100, Math.round(p)));
}

let gaugeShown = null, tween = 0;
const reduzMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function setGauge(pct, st, msg) {
  const card = $("gauge"), arc = $("g-arc");
  if (pct == null) {            // sem dados: círculo neutro
    card.dataset.state = "idle";
    arc.style.opacity = 0; arc.style.strokeDashoffset = 100;
    cancelAnimationFrame(tween); gaugeShown = null;
    $("g-num").textContent = "--"; $("g-pct").hidden = true;
    $("g-label").textContent = "Sem leitura"; $("g-msg").textContent = msg || "Aguardando leituras";
    $("g-ico").innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>';
    $("g-ring").setAttribute("aria-label", "Integridade estrutural: " + (msg || "aguardando leituras"));
    return;
  }
  const s = STATUS[st];
  card.dataset.state = s.cls;
  arc.style.opacity = pct > 0 ? 1 : 0;
  arc.style.strokeDashoffset = 100 - pct;
  $("g-pct").hidden = false;
  $("g-label").textContent = s.label; $("g-msg").textContent = msg || s.msg;
  $("g-ico").innerHTML = ICON[s.cls];
  $("g-ring").setAttribute("aria-label", "Integridade estrutural: " + pct + " por cento, " + s.label);
  const de = gaugeShown == null ? 0 : gaugeShown;
  gaugeShown = pct;
  cancelAnimationFrame(tween);
  if (reduzMovimento || de === pct) { $("g-num").textContent = pct; return; }
  const t0 = performance.now();
  const passo = (t) => {
    const k = Math.min(1, (t - t0) / 800), e = 1 - Math.pow(1 - k, 3);
    $("g-num").textContent = Math.round(de + (pct - de) * e);
    if (k < 1) tween = requestAnimationFrame(passo);
  };
  tween = requestAnimationFrame(passo);
}

function aplicarStatus(st, vib, tilt, now, msg, forcar, pct) {
  const s = STATUS[st], texto = msg || s.msg;
  const [min, max] = FAIXA[st];
  pct = Math.max(min, Math.min(max, Math.round(pct == null || Number.isNaN(pct) ? TIPICO[st] : pct)));  // a cor sempre combina com o status
  if (forcar || now - lastGauge >= 500) { lastGauge = now; setGauge(pct, st, msg); }

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

/* ============ NAVEGAÇÃO ============ */
function show(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.querySelector(".tabs").style.setProperty("--i", [...document.querySelectorAll(".tab")].findIndex((t) => t.dataset.view === view));
  if (view === "alerts") { unseen = false; $("bell-dot").hidden = true; }
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

/* ============ MODO SIMULAÇÃO ============ */
function startSim() {
  setConn("on", "Modo simulação");
  $("sim").hidden = false;
  const range = $("sim-range"), out = $("sim-val"), auto = $("sim-auto");
  let timer = 0, dir = -1;
  const vibDe = (p) => CONFIG.LIMITE_ATENCAO * (p >= 60 ? (100 - p) / 40 : p >= 30 ? 1 + (60 - p) / 30 : 2 + (30 - p) / 30);
  const aplicar = (p) => {
    p = Math.max(0, Math.min(100, Math.round(p)));
    range.value = p; out.textContent = p + "%";
    aplicarStatus(statusPorPct(p), vibDe(p), 0, Date.now(), undefined, true, p);
  };
  const parar = () => { clearInterval(timer); timer = 0; auto.setAttribute("aria-pressed", "false"); };
  range.addEventListener("input", () => { parar(); aplicar(+range.value); });
  document.querySelectorAll("#sim [data-v]").forEach((b) => b.addEventListener("click", () => { parar(); aplicar(+b.dataset.v); }));
  auto.addEventListener("click", () => {
    if (timer) return parar();
    auto.setAttribute("aria-pressed", "true");
    timer = setInterval(() => {   // 100 -> 0 -> 100, ~14 s por volta
      let p = +range.value + dir * 2;
      if (p <= 0) { p = 0; dir = 1; } else if (p >= 100) { p = 100; dir = -1; }
      aplicar(p);
    }, 140);
  });
  aplicar(100);
}

/* ============ INÍCIO ============ */
renderList("readings", readings);
renderList("alerts", alerts);
setInterval(() => { // sem coleta nova do sensor por um bom tempo
  if (!demo && $("conn").dataset.state === "on" && lastData && Date.now() - lastData > CONFIG.SEM_DADOS_MS) {
    setConn("connecting", "Servidor ok, sem dados do sensor");
    setGauge(null, null, "Sem dados do sensor");
  }
}, 1000);
let started = false;
function startData() { if (started) return; started = true; sim ? startSim() : demo ? startDemo() : connect(); }

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
$("name-next").onclick = () => {
  const nome = $("name-in").value.trim();
  setName(nome);
  cadastrarUsuario(nome).catch((e) => console.warn("Cadastro no backend falhou:", e.message)); // o app segue mesmo se falhar
  go("notif");
};
enterKey($("name-in"), $("name-next"));

$("notif-yes").onclick = async () => {
  const p = await askPerm(); setNotif(true);
  if (p === "granted") return enter();
  $("notif-msg").textContent = "O navegador não liberou notificações do sistema. Os alertas aparecerão dentro do app.";
  setTimeout(enter, 2400);
};
$("notif-no").onclick = () => { setNotif(false); enter(); };

$("login-name").addEventListener("input", (e) => { $("login-btn").disabled = !e.target.value.trim(); });
$("login-btn").onclick = () => {
  const nome = $("login-name").value.trim();
  setName(nome);
  if (!usuarioSalvo()) cadastrarUsuario(nome).catch((e) => console.warn("Cadastro no backend falhou:", e.message));
  me.session = true; store.set("session", true); go("app");
};
enterKey($("login-name"), $("login-btn"));

/* ajustes */
$("save-name").onclick = () => { const v = $("set-name").value.trim(); if (v) { setName(v); toast("Nome atualizado"); } };
$("sw-notif").onclick = () => { const v = !me.notif; setNotif(v); if (v) askPerm(); };
document.querySelectorAll("#seg-theme button").forEach((b) => b.addEventListener("click", () => applyTheme(b.dataset.t)));
$("logout").onclick = () => { me.session = false; store.set("session", false); go("login"); };

/* início */
setName(me.name); setNotif(me.notif); applyTheme(me.theme);
setTimeout(() => go(!me.session ? (me.onboarded ? "login" : "onb") : "app"), CONFIG.TEMPO_ABERTURA_MS);
