// =====================================================================
// Definição dos 4 formulários de CIP
// Campos, rótulos e ordem extraídos literalmente dos documentos originais.
// Nenhum campo, unidade, concentração, temperatura, pressão ou limite
// operacional foi inventado — os documentos de referência não trazem
// unidades fixas nesses campos, por isso eles são de texto livre (o
// operador preenche como preenchia no papel).
// =====================================================================

// tipo -> { titulo, documentoOrigem, campoEquipamento, camposDados, temHoraFinal }
const FORM_CONFIG = {
  alcalino_clorado: {
    titulo: "CIP Alcalino Clorado — TFM/HORAP/Trasfega",
    documentoOrigem: "PO-JAC-FAB-004, Anexo 2",
    // Campo de equipamento de nível superior (vai para cip_registros.equipamento)
    equipamento: {
      label: "TFM/HORAP/Linha Trasfega",
      tipoSeletor: "tfm_horap_trasfega",
    },
    temHoraFinal: true,
    // Demais campos específicos (vão para cip_registros.dados)
    campos: [
      { key: "num_utilizacao_solucao_alcalina_clorada", label: "Nº Utilização solução alcalina clorada", tipo: "texto" },
      { key: "painel_cip", label: "Painel de CIP", tipo: "texto" },
      { key: "conc_inicial", label: "Conc. Inicial", tipo: "texto" },
      { key: "conc_final", label: "Conc. Final", tipo: "texto" },
      { key: "tempo_circulacao", label: "Tempo Circul.", tipo: "texto" },
      { key: "num_utilizacao_acido", label: "Nº Utilização Ácido", tipo: "texto" },
      { key: "hora_inicial_acido", label: "Hora Inicial (Ácido)", tipo: "hora" },
      { key: "hora_final_acido", label: "Hora Final (Ácido)", tipo: "hora" },
      { key: "painel_cip_acido", label: "Painel de CIP (Ácido)", tipo: "texto" },
      { key: "conc_inicial_acido", label: "Conc. Inicial Ácido", tipo: "texto" },
      { key: "conc_final_acido", label: "Conc. Final Ácido", tipo: "texto" },
      { key: "tempo_circulacao_acido", label: "Tempo Circul. Ácido", tipo: "texto" },
      { key: "pressao", label: "Pressão", tipo: "texto" },
      { key: "ph_enxague_final", label: "pH enxague Final", tipo: "texto" },
      { key: "limpeza_cone_cupula_microbiologico", label: "Limpeza Cone, cúpula e ponto Microbiológico", tipo: "texto" },
      { key: "coordenador_lider", label: "Coordenador/Líder", tipo: "texto" },
    ],
  },

  completo: {
    titulo: "CIP Completo — TFM/HORAP/Trasfega",
    documentoOrigem: "PO-JAC-FAB-004, Anexo 3",
    equipamento: {
      label: "TFM/HORAP/Trasfega",
      tipoSeletor: "tfm_horap_trasfega",
    },
    temHoraFinal: true,
    campos: [
      { key: "num_utilizacao_soda", label: "Nº Utilização de soda", tipo: "texto" },
      { key: "painel_cip", label: "Painel de CIP", tipo: "texto" },
      { key: "conc_inicial_soda", label: "Conc. Inicial de soda", tipo: "texto" },
      { key: "conc_final_soda", label: "Conc. Final de soda", tipo: "texto" },
      { key: "tempo_circulacao_soda", label: "Tempo Circul. Soda", tipo: "texto" },
      { key: "num_utilizacao_acido", label: "Nº Utilização Ácido", tipo: "texto" },
      { key: "hora_inicial_acido", label: "Hora Inicial (Ácido)", tipo: "hora" },
      { key: "hora_final_acido", label: "Hora Final (Ácido)", tipo: "hora" },
      { key: "painel_cip_acido", label: "Painel de CIP (Ácido)", tipo: "texto" },
      { key: "conc_inicial_acido", label: "Conc. Inicial Ácido", tipo: "texto" },
      { key: "conc_final_acido", label: "Conc. Final Ácido", tipo: "texto" },
      { key: "tempo_circulacao_acido", label: "Tempo Circul. Ácido", tipo: "texto" },
      { key: "num_utilizacao_divosan", label: "Número da Utilização do Divosan Forte", tipo: "texto" },
      { key: "hora_inicial_divosan", label: "Horário Inicial Divosan Forte", tipo: "hora" },
      { key: "hora_final_divosan", label: "Horário final Divosan Forte", tipo: "hora" },
      { key: "conc_inicial_divosan", label: "Conc. Inicial Divosan Forte", tipo: "texto" },
      { key: "conc_final_divosan", label: "Conc. Final Divosan Forte", tipo: "texto" },
      { key: "tempo_circulacao_divosan", label: "Tempo Circul. Divosan Forte", tipo: "texto" },
      { key: "pressao", label: "Pressão", tipo: "texto" },
      { key: "ph_enxague_final", label: "pH enxague Final", tipo: "texto" },
      { key: "limpeza_cone_cupula_microbiologico", label: "Limpeza Cone, cúpula e ponto Microbiológico", tipo: "texto" },
      { key: "coordenador_lider", label: "Coordenador/Líder", tipo: "texto" },
    ],
  },

  tanque_levedura: {
    titulo: "CIP Tanque de Levedura",
    documentoOrigem: "PO-JAC-FAB-032, Anexo 2",
    equipamento: {
      label: "TQ",
      tipoSeletor: "tq_levedura",
    },
    temHoraFinal: false, // o formulário original só tem "Hora Inicial"
    campos: [
      { key: "painel_cip", label: "Painel de CIP", tipo: "texto" },
      { key: "num_utilizacao_solucao_alcalina_clorada", label: "Nº Utilização Solução Alcalina Clorada", tipo: "texto" },
      { key: "conc_inicial_solucao_alcalina_clorada", label: "Conc Inicial Solução Alcalina Clorada", tipo: "texto" },
      { key: "conc_final_solucao_alcalina_clorada", label: "Conc Final Solução Alcalina Clorada", tipo: "texto" },
      { key: "tempo_circulacao_solucao_alcalina_clorada", label: "Tempo Circul. Solução Alcalina Clorada", tipo: "texto" },
      { key: "num_utilizacao_soda", label: "Nº Utilização Soda", tipo: "texto" },
      { key: "conc_inicial_soda", label: "Conc Inicial Soda", tipo: "texto" },
      { key: "conc_final_soda", label: "Conc Final Soda", tipo: "texto" },
      { key: "tempo_circulacao_soda", label: "Tempo Circul. Soda", tipo: "texto" },
      { key: "temperatura_soda", label: "Temperatura Soda", tipo: "texto" },
      { key: "num_utilizacao_acido", label: "Nº Utilização Ácido", tipo: "texto" },
      { key: "conc_inicial_acido", label: "Conc Inicial Ácido", tipo: "texto" },
      { key: "conc_final_acido", label: "Conc Final Ácido", tipo: "texto" },
      { key: "tempo_circulacao_acido", label: "Tempo Circul. Ácido", tipo: "texto" },
      { key: "pressao", label: "Pressão", tipo: "texto" },
      { key: "ph_enxague_final", label: "pH Enxague Final", tipo: "texto" },
      { key: "limpeza_cone_cupula_microbiologico", label: "Limpeza do cone, cupula e ponto microbiologico", tipo: "texto" },
      { key: "validacao_coordenador_lider", label: "Validação (Coordenador/Líder)", tipo: "texto" },
    ],
  },

  linha_recuperacao_levedura: {
    titulo: "CIP Linha de Recuperação de Levedura",
    documentoOrigem: "PO-JAC-FAB-031, Anexo 2",
    // Equipamento principal é fixo: a própria linha. O campo "TFM" do
    // formulário original (tanque de fermentação relacionado) fica em
    // dados.tfm.
    equipamentoFixo: "Linha de Recuperação de Levedura",
    temHoraFinal: true,
    campos: [
      { key: "num_utilizacao_soda", label: "Nº Utilização Soda", tipo: "texto" },
      { key: "tfm", label: "TFM", tipo: "equipamento", tipoSeletor: "tfm" },
      { key: "tq_cip_quente", label: "TQ de CIP Quente (Sim ou Não)", tipo: "sim_nao" },
      { key: "conc_inicial_soda", label: "Conc Inicial Soda", tipo: "texto" },
      { key: "conc_final_soda", label: "Conc Final Soda", tipo: "texto" },
      { key: "tempo_circulacao_soda", label: "Tempo Circul. Soda", tipo: "texto" },
      { key: "temperatura_soda", label: "Temperatura Soda", tipo: "texto" },
      { key: "num_utilizacao_acido", label: "Nº Utilização Ácido", tipo: "texto" },
      { key: "conc_inicial_acido", label: "Conc Inicial Ácido", tipo: "texto" },
      { key: "conc_final_acido", label: "Conc Final Ácido", tipo: "texto" },
      { key: "tempo_circulacao_acido", label: "Tempo Circul. Ácido", tipo: "texto" },
      { key: "pressao", label: "Pressão", tipo: "texto" },
      { key: "ph_enxague_final", label: "pH Enxague Final", tipo: "texto" },
      { key: "validacao_coordenador_lider", label: "Validação (Coordenador/Líder)", tipo: "texto" },
    ],
  },
};

const TIPO_CIP_LABELS = {
  alcalino_clorado: "CIP Alcalino Clorado",
  completo: "CIP Completo",
  tanque_levedura: "CIP Tanque de Levedura",
  linha_recuperacao_levedura: "CIP Linha de Recuperação de Levedura",
};
