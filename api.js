/*
  MAGEN - ligação do app com o backend (script comum, sem import/export)
  Use com: <script src="api.js"></script>  (antes dos scripts da tela)

  1) Troque API_URL pelo endereço do backend (sem barra no final).
  2) Tela do nome:  usuarioSalvo()  e  cadastrarUsuario(nome)
  3) Home:          iniciarMonitoramento(aoAtualizar, aoFalhar)
*/
const API_URL = "https://expert-barnacle-q7vvxxqw55rq265w9-3000.app.github.dev"; // <- trocar
const DISPOSITIVO_ID = 126;
const CHAVE_USUARIO = "magen_usuario";

async function requisitar(caminho, opcoes) {
  const resp = await fetch(API_URL + caminho, opcoes);
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(corpo.erro || "erro " + resp.status);
  return corpo;
}

// ---------- usuário (cadastro só com o nome) ----------
function usuarioSalvo() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_USUARIO));
  } catch (e) {
    return null;
  }
}

async function cadastrarUsuario(nome) {
  const usuario = await requisitar("/api/usuarios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome: nome }),
  });
  try {
    localStorage.setItem(CHAVE_USUARIO, JSON.stringify(usuario)); // { id, nome }
  } catch (e) {}
  return usuario;
}

// ---------- monitoramento (Home) ----------
// Resposta de /api/status: { integridade, nivel, rms, freq_dominante_hz, data_hora, ... }
function buscarStatus() {
  return requisitar("/api/status/" + DISPOSITIVO_ID);
}

// Busca o status a cada intervalo e chama aoAtualizar(status). Devolve o id do timer.
function iniciarMonitoramento(aoAtualizar, aoFalhar, intervaloMs) {
  async function ciclo() {
    try {
      aoAtualizar(await buscarStatus());
    } catch (e) {
      if (aoFalhar) aoFalhar(e);
    }
  }
  ciclo();
  return setInterval(ciclo, intervaloMs || 3000); // para parar: clearInterval(id)
}

// 60 a 100% normal (verde), 30 a 60% atenção (amarelo), 0 a 30% alerta (vermelho)
function corDaIntegridade(porcentagem) {
  if (porcentagem >= 60) return "verde";
  if (porcentagem >= 30) return "amarelo";
  return "vermelho";
}
