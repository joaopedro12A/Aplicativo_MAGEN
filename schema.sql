-- Rode uma vez no MySQL (5.7 ou mais novo). Guarda o resultado de cada processamento.
CREATE TABLE IF NOT EXISTS resultados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('normal','atencao','alerta') NOT NULL,
  amostras INT NULL,
  vib_media DOUBLE NULL,
  vib_max DOUBLE NULL,
  inclinacao_max DOUBLE NULL,
  mensagem VARCHAR(200) NULL,
  detalhes JSON NULL   -- qualquer campo extra que o Python enviar
);
