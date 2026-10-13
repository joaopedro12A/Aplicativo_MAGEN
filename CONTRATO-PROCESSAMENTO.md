# Contrato entre o backend (JavaScript) e o processamento (Python)

O backend junta as leituras do ESP32 e, a cada 5 segundos, faz um **POST** para `PROCESSAMENTO_URL`
(ex.: `http://localhost:5000/processar`).

**Envia (JSON):**
```json
{ "intervalo_ms": 5000,
  "amostras": [ { "ax": 0.12, "ay": -0.05, "az": 9.81, "t": 1791372861563 }, ... ] }
```
`ax`, `ay`, `az` em m/s² (cerca de 100 amostras por envio). `t` é o horário em milissegundos.

**Espera de volta (JSON):**
```json
{ "status": "normal", "integridade": 92, "vib_media": 0.21, "vib_max": 0.48, "inclinacao_max": 1.8, "mensagem": "Estrutura estável" }
```
- `status` é **obrigatório**: `"normal"`, `"atencao"` ou `"alerta"` (sem acento).
- `integridade` (opcional, número de 0 a 100) é o percentual mostrado no círculo do app. Faixas: **60 a 100 = normal** (verde), **30 a 59 = atencao** (amarelo), **0 a 29 = alerta** (vermelho). Se não vier, o app calcula a partir de `vib_max` e `inclinacao_max`. Se o valor não bater com o `status`, o app ajusta para a faixa do `status`.
- Os outros campos são opcionais. Qualquer campo extra (ex.: `frequencia_dominante`) vai para a coluna `detalhes` do banco.
- Responder em até 4 segundos. Se falhar, o backend usa um cálculo local e avisa no console.

O resultado é guardado no MySQL e enviado ao app. Para testar: rode `exemplo_processamento.py`.
