// =====================================================================
// Validação da justificativa obrigatória para edição de um registro CIP
// =====================================================================
// Regras (requisito 5 do projeto):
//  - não pode ser vazia
//  - não pode conter só números, espaços ou símbolos
//  - não pode ser uma resposta genérica ("erro", "corrigir", "arrumar",
//    "alteração" etc.)
//  - exige uma explicação mínima, sem obrigar texto longo

const PALAVRAS_GENERICAS = [
  "erro", "erros", "corrigir", "correcao", "correção", "corrigido", "corrigida",
  "arrumar", "arrumado", "arrumada", "alteracao", "alteração", "alterado", "alterada",
  "ajuste", "ajustado", "ajustada", "edicao", "edição", "editado", "editada",
  "mudanca", "mudança", "mudado", "mudada", "atualizacao", "atualização",
  "atualizado", "atualizada", "ok", "teste", "n/a", "na", "pq sim", "porque sim",
  "sem motivo", "sem razao", "sem razão",
];

function removerAcentos(str) {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizar(str) {
  return removerAcentos(String(str || "").toLowerCase().trim());
}

/**
 * Valida uma justificativa de edição.
 * @param {string} texto
 * @returns {{ valido: boolean, motivo?: string }}
 */
function validarJustificativa(texto) {
  const original = String(texto || "").trim();

  if (original.length === 0) {
    return { valido: false, motivo: "A justificativa não pode ficar vazia." };
  }

  // precisa ter letras reais (não pode ser só números/espaços/símbolos)
  const apenasLetras = removerAcentos(original).replace(/[^A-Za-z]/g, "");
  if (apenasLetras.length < 4) {
    return {
      valido: false,
      motivo: "A justificativa precisa de uma explicação escrita (não pode ser só números ou símbolos).",
    };
  }

  const normalizado = normalizar(original)
    .replace(/[.,;:!?"'()\-_/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // resposta genérica igual a uma das palavras bloqueadas
  if (PALAVRAS_GENERICAS.includes(normalizado)) {
    return {
      valido: false,
      motivo: `"${original}" é uma justificativa muito genérica. Explique brevemente o que foi alterado (ex.: "Corrigi a data" ou "Troquei o nome do operador").`,
    };
  }

  // também bloqueia frases formadas só por palavras genéricas
  // (ex.: "erro de alteração", "corrigir erro")
  const palavras = normalizado.split(" ").filter(Boolean);
  const todasGenericas = palavras.every((p) => PALAVRAS_GENERICAS.includes(p));
  if (todasGenericas) {
    return {
      valido: false,
      motivo: `"${original}" é uma justificativa muito genérica. Explique brevemente o que foi alterado.`,
    };
  }

  if (original.length > 300) {
    return { valido: false, motivo: "A justificativa pode ser curta — reduza para até 300 caracteres." };
  }

  return { valido: true };
}
