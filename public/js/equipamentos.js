// =====================================================================
// Lista de equipamentos — extraída do verso dos formulários originais
// (idêntica nos 4 anexos: PO-JAC-FAB-004 Anexo 2/3, PO-JAC-FAB-031 Anexo 2,
// PO-JAC-FAB-032 Anexo 2). Nenhum equipamento foi inventado.
// =====================================================================

// Tanques de Fermentação 01 a 65.
// Os tanques 53 a 63 também são identificados pelo código de painel HORAP
// H01 a H11 nos documentos originais (mesmo tanque físico).
const TANQUES_FERMENTACAO = (() => {
  const lista = [];
  for (let n = 1; n <= 65; n++) {
    const numero = String(n).padStart(2, "0");
    let codigoHorap = null;
    if (n >= 53 && n <= 63) {
      codigoHorap = "H" + String(n - 52).padStart(2, "0");
    }
    lista.push({
      categoria: "fermentacao",
      nome: `Tanque de Fermentação ${numero}`,
      codigoHorap,
    });
  }
  return lista;
})();

// Tanques de Levedura 01 a 13 (código TQ1 a TQ13 nos documentos originais)
const TANQUES_LEVEDURA = (() => {
  const lista = [];
  for (let n = 1; n <= 13; n++) {
    const numero = String(n).padStart(2, "0");
    lista.push({
      categoria: "levedura",
      nome: `Tanque de Levedura ${numero}`,
      codigo: `TQ${n}`,
    });
  }
  return lista;
})();

// Demais equipamentos do verso dos formulários
const OUTROS_EQUIPAMENTOS = [
  { categoria: "linha_recuperacao_fermento", nome: "Linha de Recuperação de Fermento", codigo: "LRF" },
  { categoria: "adega", nome: "Adega A", codigo: "A" },
  { categoria: "adega", nome: "Adega B", codigo: "B" },
  { categoria: "trasfega", nome: "Linha de Trasfega", codigo: "LT" },
];

// Lista completa (para o histórico/filtros)
const TODOS_EQUIPAMENTOS = [
  ...TANQUES_FERMENTACAO,
  ...TANQUES_LEVEDURA,
  ...OUTROS_EQUIPAMENTOS,
];

function nomeExibicaoEquipamento(item) {
  if (item.codigoHorap) {
    return `${item.nome} (HORAP ${item.codigoHorap})`;
  }
  return item.nome;
}

// Conjuntos usados para restringir os seletores de equipamento de cada
// campo, de acordo com o próprio nome do campo no formulário original:
//   - "TFM/HORAP/Linha Trasfega" e "TFM/HORAP/Trasfega" -> tanques de
//     fermentação (inclui HORAP) + Linha de Trasfega
//   - "TQ" (CIP Tanque de Levedura)                     -> tanques de levedura
//   - "TFM" (CIP Linha de Recuperação de Levedura)       -> tanques de fermentação
function listaEquipamentosParaCampo(tipoSeletor) {
  switch (tipoSeletor) {
    case "tfm_horap_trasfega":
      return [...TANQUES_FERMENTACAO, OUTROS_EQUIPAMENTOS.find((e) => e.codigo === "LT")];
    case "tq_levedura":
      return TANQUES_LEVEDURA;
    case "tfm":
      return TANQUES_FERMENTACAO;
    default:
      return TODOS_EQUIPAMENTOS;
  }
}
