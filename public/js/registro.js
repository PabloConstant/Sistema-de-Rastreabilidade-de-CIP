// =====================================================================
// Lógica da tela de novo registro / edição de registro de CIP
// =====================================================================

const params = new URLSearchParams(window.location.search);
const TIPO = params.get("tipo");
const ID_REGISTRO = params.get("id"); // presente apenas em modo edição

let CONFIG = null;
let REGISTRO_ATUAL = null; // carregado do banco, quando em modo edição
let PERFIL_ATUAL = null;

const mensagemEl = document.getElementById("mensagem");

function mostrarMensagem(tipo, texto) {
  const classe = tipo === "erro" ? "mensagem-erro" : tipo === "sucesso" ? "mensagem-sucesso" : "mensagem-aviso";
  mensagemEl.innerHTML = `<div class="${classe}">${texto}</div>`;
}

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = String(texto ?? "");
  return div.innerHTML;
}

function criarInputTopo(idCampo, label, tipoInput, valor, extraAttrs = "") {
  const obrigatorio = /\brequired\b/.test(extraAttrs);
  return `
    <div class="campo">
      <label for="${idCampo}">${escaparHtml(label)}${obrigatorio ? ' <span class="marca-obrigatorio" title="Campo obrigatório">*</span>' : ""}</label>
      <input type="${tipoInput}" id="${idCampo}" value="${escaparHtml(valor ?? "")}" ${extraAttrs} />
    </div>
  `;
}

function criarSelectEquipamento(idCampo, label, tipoSeletor, valorAtual) {
  const opcoes = listaEquipamentosParaCampo(tipoSeletor)
    .filter(Boolean)
    .map((item) => {
      const nome = nomeExibicaoEquipamento(item);
      const selecionado = nome === valorAtual ? "selected" : "";
      return `<option value="${escaparHtml(nome)}" ${selecionado}>${escaparHtml(nome)}</option>`;
    })
    .join("");
  return `
    <div class="campo">
      <label for="${idCampo}">${escaparHtml(label)} <span class="marca-obrigatorio" title="Campo obrigatório">*</span></label>
      <select id="${idCampo}">
        <option value="">— selecione —</option>
        ${opcoes}
      </select>
    </div>
  `;
}

function renderizarCamposTopo(valoresIniciais = {}) {
  const container = document.getElementById("campos-topo");
  let html = "";

  html += criarInputTopo("data_cip", "Data", "date", valoresIniciais.data_cip, "required");

  if (CONFIG.equipamento) {
    html += criarSelectEquipamento(
      "equipamento",
      CONFIG.equipamento.label,
      CONFIG.equipamento.tipoSeletor,
      valoresIniciais.equipamento
    );
  } else if (CONFIG.equipamentoFixo) {
    html += `
      <div class="campo">
        <label>Equipamento</label>
        <input type="text" value="${escaparHtml(CONFIG.equipamentoFixo)}" disabled />
      </div>
    `;
  }

  html += criarInputTopo("hora_inicial", "Hora Inicial", "time", valoresIniciais.hora_inicial, "required");

  if (CONFIG.temHoraFinal) {
    html += criarInputTopo("hora_final", "Hora Final", "time", valoresIniciais.hora_final);
  }

  html += criarInputTopo("nome_operador", "Operador", "text", valoresIniciais.nome_operador, "required");

  container.innerHTML = html;
}

function renderizarCamposDados(dadosIniciais = {}) {
  const container = document.getElementById("campos-dados");
  let html = "";

  CONFIG.campos.forEach((campo) => {
    const idCampo = `campo_${campo.key}`;
    const valor = dadosIniciais[campo.key];

    if (campo.tipo === "hora") {
      html += criarInputTopo(idCampo, campo.label, "time", valor);
    } else if (campo.tipo === "equipamento") {
      html += criarSelectEquipamento(idCampo, campo.label, campo.tipoSeletor, valor);
    } else if (campo.tipo === "sim_nao") {
      const simSel = valor === "Sim" ? "selected" : "";
      const naoSel = valor === "Não" ? "selected" : "";
      html += `
        <div class="campo">
          <label for="${idCampo}">${escaparHtml(campo.label)}</label>
          <select id="${idCampo}">
            <option value="">— selecione —</option>
            <option value="Sim" ${simSel}>Sim</option>
            <option value="Não" ${naoSel}>Não</option>
          </select>
        </div>
      `;
    } else {
      html += criarInputTopo(idCampo, campo.label, "text", valor);
    }
  });

  container.innerHTML = html;
}

function lerValoresDoFormulario() {
  const topo = {
    data_cip: document.getElementById("data_cip").value,
    hora_inicial: document.getElementById("hora_inicial").value || null,
    hora_final: CONFIG.temHoraFinal ? (document.getElementById("hora_final").value || null) : null,
    nome_operador: document.getElementById("nome_operador").value.trim(),
    equipamento: CONFIG.equipamento
      ? document.getElementById("equipamento").value
      : CONFIG.equipamentoFixo,
  };

  const dados = {};
  CONFIG.campos.forEach((campo) => {
    const el = document.getElementById(`campo_${campo.key}`);
    dados[campo.key] = el.value.trim();
  });

  const observacoes_operador = document.getElementById("observacoes").value.trim() || null;

  return { ...topo, dados, observacoes_operador };
}

function preencherObservacoes(texto) {
  document.getElementById("observacoes").value = texto || "";
}

function validarCamposObrigatorios(valores) {
  if (!valores.data_cip) return "Informe a Data.";
  if (!valores.hora_inicial) return "Informe a Hora Inicial.";
  if (CONFIG.equipamento && !valores.equipamento) return `Selecione o campo "${CONFIG.equipamento.label}".`;
  if (!valores.nome_operador) return "Informe o nome do Operador.";
  return null;
}

async function carregarRegistroParaEdicao() {
  const { data, error } = await supabaseClient
    .from("cip_registros")
    .select("*")
    .eq("id", ID_REGISTRO)
    .single();

  if (error || !data) {
    mostrarMensagem("erro", "Não foi possível carregar o registro para edição.");
    return null;
  }
  return data;
}

function montarSnapshot(valores) {
  // snapshot completo e comparável do registro (para o histórico de edições)
  return {
    tipo_cip: TIPO,
    equipamento: valores.equipamento,
    data_cip: valores.data_cip,
    hora_inicial: valores.hora_inicial,
    hora_final: valores.hora_final,
    nome_operador: valores.nome_operador,
    observacoes_operador: valores.observacoes_operador,
    dados: valores.dados,
  };
}

async function init() {
  const resultado = await exigirSessao();
  if (!resultado) return;
  const { perfil } = resultado;
  PERFIL_ATUAL = perfil;

  document.getElementById("info-usuario").textContent =
    `${perfil.nome} (${perfil.role === "administrador" ? "Administrador" : "Operador"})`;

  if (perfil.role !== "operador") {
    document.body.innerHTML = `
      <div class="tela-erro">
        <h1>Acesso restrito</h1>
        <p>Somente operadores podem preencher ou editar registros de CIP.</p>
        <a href="painel.html">Voltar ao painel</a>
      </div>
    `;
    return;
  }

  if (!TIPO || !FORM_CONFIG[TIPO]) {
    mostrarMensagem("erro", "Tipo de CIP inválido.");
    document.getElementById("form-cip").classList.add("oculto");
    return;
  }

  CONFIG = FORM_CONFIG[TIPO];
  document.getElementById("titulo-formulario").textContent = CONFIG.titulo;
  document.getElementById("doc-origem").textContent = `Baseado em: ${CONFIG.documentoOrigem}`;

  if (ID_REGISTRO) {
    // Modo edição
    REGISTRO_ATUAL = await carregarRegistroParaEdicao();
    if (!REGISTRO_ATUAL) return;

    renderizarCamposTopo(REGISTRO_ATUAL);
    renderizarCamposDados(REGISTRO_ATUAL.dados || {});
    preencherObservacoes(REGISTRO_ATUAL.observacoes_operador);

    document.getElementById("area-justificativa").classList.remove("oculto");
    document.getElementById("btn-salvar").textContent = "Salvar alteração";
  } else {
    // Modo criação
    renderizarCamposTopo({});
    renderizarCamposDados({});
  }

  document.getElementById("form-cip").addEventListener("submit", onSubmit);
}

async function onSubmit(e) {
  e.preventDefault();
  mensagemEl.innerHTML = "";

  const valores = lerValoresDoFormulario();
  const erroValidacao = validarCamposObrigatorios(valores);
  if (erroValidacao) {
    mostrarMensagem("erro", erroValidacao);
    return;
  }

  const botao = document.getElementById("btn-salvar");
  const textoOriginalBotao = botao.textContent;
  botao.disabled = true;
  botao.textContent = "Salvando...";
  // Evita duplo clique/duplo envio: o botão só volta ao normal se algo
  // impedir o salvamento; em caso de sucesso, a tela muda antes disso.
  function pararCarregamento() {
    botao.disabled = false;
    botao.textContent = textoOriginalBotao;
  }

  // Observação: não buscamos mais o uid da sessão aqui para preenchê-lo
  // manualmente em campos de auditoria (criado_por/atualizado_por). Esses
  // campos são definidos pelo próprio banco (trigger em cip_registros, ou
  // dentro da função editar_registro_cip) a partir de auth.uid() do lado
  // do servidor — nunca a partir de um valor enviado pelo cliente.

  if (ID_REGISTRO) {
    // ----- Edição: exige autoria + justificativa, e grava histórico -----
    const nomeQuemEdita = document.getElementById("nome_quem_edita").value.trim();
    if (!nomeQuemEdita) {
      mostrarMensagem(
        "erro",
        'Informe o nome de quem está fazendo esta alteração (campo "Nome de quem está fazendo esta alteração").'
      );
      pararCarregamento();
      return;
    }

    const justificativaTexto = document.getElementById("justificativa").value;
    const validacao = validarJustificativa(justificativaTexto);
    if (!validacao.valido) {
      mostrarMensagem("erro", validacao.motivo);
      pararCarregamento();
      return;
    }

    const snapshotAnterior = montarSnapshot({
      equipamento: REGISTRO_ATUAL.equipamento,
      data_cip: REGISTRO_ATUAL.data_cip,
      hora_inicial: REGISTRO_ATUAL.hora_inicial,
      hora_final: REGISTRO_ATUAL.hora_final,
      nome_operador: REGISTRO_ATUAL.nome_operador,
      observacoes_operador: REGISTRO_ATUAL.observacoes_operador,
      dados: REGISTRO_ATUAL.dados,
    });
    const snapshotNovo = montarSnapshot(valores);

    if (JSON.stringify(snapshotAnterior) === JSON.stringify(snapshotNovo)) {
      mostrarMensagem("aviso", "Nenhum campo foi alterado — nada para salvar.");
      pararCarregamento();
      return;
    }

    // A atualização do registro e a gravação do histórico acontecem
    // dentro de uma ÚNICA transação no banco (função RPC
    // editar_registro_cip, em supabase/schema.sql). Se qualquer etapa
    // falhar (ex.: justificativa rejeitada, perda de conexão no meio do
    // caminho), nada é salvo — nem o registro, nem o histórico.
    const { error: errRpc } = await supabaseClient.rpc("editar_registro_cip", {
      p_registro_id: ID_REGISTRO,
      p_equipamento: valores.equipamento,
      p_data_cip: valores.data_cip,
      p_hora_inicial: valores.hora_inicial,
      p_hora_final: valores.hora_final,
      p_nome_operador: valores.nome_operador,
      p_dados: valores.dados,
      p_observacoes_operador: valores.observacoes_operador,
      p_justificativa: justificativaTexto.trim(),
      p_alterado_por_nome: nomeQuemEdita,
    });

    if (errRpc) {
      mostrarMensagem("erro", "Não foi possível salvar a alteração: " + errRpc.message);
      pararCarregamento();
      return;
    }

    mostrarMensagem("sucesso", "Alteração salva com sucesso (registro e histórico atualizados juntos).");
    setTimeout(() => (window.location.href = "historico.html"), 900);
  } else {
    // ----- Criação de novo registro -----
    // Propositalmente NÃO enviamos criado_por, atualizado_por, criado_em
    // ou atualizado_em: esses campos são de auditoria e o banco os
    // preenche sozinho (trigger "cip_registros_set_auditoria_insert" em
    // supabase/schema.sql), ignorando qualquer valor que o cliente envie
    // para eles — mesmo que alguém chame a API diretamente.
    const { error } = await supabaseClient.from("cip_registros").insert({
      tipo_cip: TIPO,
      equipamento: valores.equipamento,
      data_cip: valores.data_cip,
      hora_inicial: valores.hora_inicial,
      hora_final: valores.hora_final,
      nome_operador: valores.nome_operador,
      dados: valores.dados,
      observacoes_operador: valores.observacoes_operador,
    });

    if (error) {
      mostrarMensagem("erro", "Erro ao salvar o registro: " + error.message);
      pararCarregamento();
      return;
    }

    mostrarMensagem("sucesso", "Registro de CIP salvo com sucesso.");
    setTimeout(() => (window.location.href = "painel.html"), 900);
  }
}

init();
