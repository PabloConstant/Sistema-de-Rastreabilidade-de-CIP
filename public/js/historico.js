// =====================================================================
// Lógica da tela de Histórico (consulta, filtros, detalhe, edição e
// observações administrativas)
// =====================================================================

let PERFIL_ATUAL = null;
let REGISTRO_ABERTO_ID = null;

const mensagemEl = document.getElementById("mensagem");

function mostrarMensagem(tipo, texto) {
  const classe = tipo === "erro" ? "mensagem-erro" : tipo === "sucesso" ? "mensagem-sucesso" : "mensagem-aviso";
  mensagemEl.innerHTML = texto ? `<div class="${classe}">${texto}</div>` : "";
}

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = String(texto ?? "");
  return div.innerHTML;
}

function formatarData(dataIso) {
  if (!dataIso) return "—";
  const [ano, mes, dia] = dataIso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function formatarDataHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR");
}

function preencherSelectTipos() {
  const select = document.getElementById("f-tipo");
  Object.entries(TIPO_CIP_LABELS).forEach(([tipo, label]) => {
    const opt = document.createElement("option");
    opt.value = tipo;
    opt.textContent = label;
    select.appendChild(opt);
  });
}

// Paginação: evita trazer o histórico inteiro de uma vez. Cada página
// busca PAGINA_TAMANHO + 1 linhas só para saber se existe uma próxima
// página (sem precisar de um count() separado no banco).
const PAGINA_TAMANHO = 25;
let paginaAtual = 0;
let temMaisPaginas = false;

function montarQueryFiltrada() {
  let query = supabaseClient.from("cip_registros").select("*").order("data_cip", { ascending: false }).order("hora_inicial", { ascending: false });

  const tipo = document.getElementById("f-tipo").value;
  const dataInicio = document.getElementById("f-data-inicio").value;
  const dataFim = document.getElementById("f-data-fim").value;
  const operador = document.getElementById("f-operador").value.trim();
  const equipamento = document.getElementById("f-equipamento").value.trim();
  const texto = document.getElementById("f-texto").value.trim();

  if (tipo) query = query.eq("tipo_cip", tipo);
  if (dataInicio) query = query.gte("data_cip", dataInicio);
  if (dataFim) query = query.lte("data_cip", dataFim);
  if (operador) query = query.ilike("nome_operador", `%${operador}%`);
  if (equipamento) query = query.ilike("equipamento", `%${equipamento}%`);
  if (texto) {
    const escapado = texto.replace(/[%,]/g, "");
    query = query.or(`equipamento.ilike.%${escapado}%,nome_operador.ilike.%${escapado}%,observacoes_operador.ilike.%${escapado}%`);
  }

  return query;
}

async function buscarPagina(pagina) {
  mostrarMensagem(null, "");
  const inicio = pagina * PAGINA_TAMANHO;
  // Busca uma linha a mais que o tamanho da página só para saber se há
  // uma próxima página — sem precisar de uma segunda consulta de count().
  const fim = inicio + PAGINA_TAMANHO; // (inclusive, intervalo de PAGINA_TAMANHO+1 linhas)

  const { data, error } = await montarQueryFiltrada().range(inicio, fim);

  if (error) {
    const classificado = typeof classificarErroSupabase === "function" ? classificarErroSupabase(error) : null;
    mostrarMensagem("erro", classificado ? classificado.mensagem : "Erro ao buscar o histórico: " + error.message);
    return [];
  }

  const linhas = data || [];
  temMaisPaginas = linhas.length > PAGINA_TAMANHO;
  return temMaisPaginas ? linhas.slice(0, PAGINA_TAMANHO) : linhas;
}

function renderizarTabela(registros, acumular) {
  const corpo = document.getElementById("corpo-tabela");
  const resumo = document.getElementById("resumo-resultado");
  const botaoMais = document.getElementById("btn-carregar-mais");

  if (!acumular) {
    corpo.innerHTML = "";
  }

  if (!acumular && registros.length === 0) {
    corpo.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--cor-texto-suave);">Nenhum registro encontrado com os filtros aplicados.</td></tr>`;
    resumo.textContent = "0 registro(s) encontrado(s).";
    botaoMais.classList.add("oculto");
    return;
  }

  corpo.insertAdjacentHTML(
    "beforeend",
    registros
      .map(
        (r) => `
      <tr>
        <td data-label="Data">${formatarData(r.data_cip)}</td>
        <td data-label="Tipo de CIP"><span class="badge">${escaparHtml(TIPO_CIP_LABELS[r.tipo_cip] || r.tipo_cip)}</span></td>
        <td data-label="Equipamento" class="col-texto">${escaparHtml(r.equipamento)}</td>
        <td data-label="Operador" class="col-texto">${escaparHtml(r.nome_operador)}</td>
        <td data-label="Hora Inicial">${r.hora_inicial ? r.hora_inicial.slice(0, 5) : "—"}</td>
        <td><button type="button" class="secundario" data-id="${r.id}" onclick="abrirDetalhe('${r.id}')">Ver detalhes</button></td>
      </tr>
    `
      )
      .join("")
  );

  const totalNaTela = corpo.querySelectorAll("tr").length;
  resumo.textContent = temMaisPaginas
    ? `Mostrando os ${totalNaTela} primeiros registros — há mais resultados.`
    : `${totalNaTela} registro(s) encontrado(s).`;
  botaoMais.classList.toggle("oculto", !temMaisPaginas);
}

async function carregarPrimeiraPagina() {
  paginaAtual = 0;
  const registros = await buscarPagina(paginaAtual);
  renderizarTabela(registros, false);
}

async function carregarProximaPagina() {
  const botao = document.getElementById("btn-carregar-mais");
  const textoOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = "Carregando...";
  paginaAtual += 1;
  const registros = await buscarPagina(paginaAtual);
  renderizarTabela(registros, true);
  botao.disabled = false;
  botao.textContent = textoOriginal;
}

function renderizarCamposDados(tipoCip, dados) {
  const config = FORM_CONFIG[tipoCip];
  if (!config) return "";
  return config.campos
    .map((campo) => {
      const valor = dados && dados[campo.key] ? dados[campo.key] : "—";
      return `<div class="campo-dado"><span>${escaparHtml(campo.label)}</span><span class="valor">${escaparHtml(valor)}</span></div>`;
    })
    .join("");
}

async function abrirDetalhe(id) {
  REGISTRO_ABERTO_ID = id;
  const area = document.getElementById("area-detalhe");
  area.innerHTML = `<div class="cartao">Carregando detalhes...</div>`;

  const [{ data: registro, error: errReg }, { data: edicoes, error: errEd }, { data: observacoes, error: errObs }] =
    await Promise.all([
      supabaseClient.from("cip_registros").select("*").eq("id", id).single(),
      supabaseClient.from("cip_edicoes").select("*").eq("registro_id", id).order("alterado_em", { ascending: false }),
      supabaseClient.from("cip_observacoes").select("*").eq("registro_id", id).order("criado_em", { ascending: false }),
    ]);

  if (errReg || !registro) {
    area.innerHTML = `<div class="cartao mensagem-erro">Não foi possível carregar este registro.</div>`;
    return;
  }

  const config = FORM_CONFIG[registro.tipo_cip];
  const podeEditar = PERFIL_ATUAL.role === "operador";
  const podeComentar = PERFIL_ATUAL.role === "administrador";

  let htmlEdicoes = "<p style='color:#889;font-size:0.85rem;'>Nenhuma alteração registrada.</p>";
  if (!errEd && edicoes && edicoes.length > 0) {
    htmlEdicoes = `<ul class="lista-edicoes">${edicoes
      .map(
        (e) => `
        <li>
          <div class="meta">${formatarDataHora(e.alterado_em)} — por ${escaparHtml(e.alterado_por_nome)}</div>
          <div><strong>Justificativa:</strong> ${escaparHtml(e.justificativa)}</div>
        </li>
      `
      )
      .join("")}</ul>`;
  }

  let htmlObservacoes = "<p style='color:#889;font-size:0.85rem;'>Nenhuma observação administrativa.</p>";
  if (!errObs && observacoes && observacoes.length > 0) {
    htmlObservacoes = `<ul class="lista-observacoes">${observacoes
      .map(
        (o) => `
        <li>
          <div class="meta">${formatarDataHora(o.criado_em)} — ${escaparHtml(o.administrador_nome)}</div>
          <div>${escaparHtml(o.texto)}</div>
        </li>
      `
      )
      .join("")}</ul>`;
  }

  area.innerHTML = `
    <div class="cartao detalhe-registro">
      <h3>${escaparHtml(config ? config.titulo : registro.tipo_cip)}</h3>
      <div class="campo-dado"><span>Data</span><span class="valor">${formatarData(registro.data_cip)}</span></div>
      <div class="campo-dado"><span>Equipamento</span><span class="valor">${escaparHtml(registro.equipamento)}</span></div>
      <div class="campo-dado"><span>Hora Inicial</span><span class="valor">${registro.hora_inicial ? registro.hora_inicial.slice(0,5) : "—"}</span></div>
      ${config && config.temHoraFinal ? `<div class="campo-dado"><span>Hora Final</span><span class="valor">${registro.hora_final ? registro.hora_final.slice(0,5) : "—"}</span></div>` : ""}
      <div class="campo-dado"><span>Operador</span><span class="valor">${escaparHtml(registro.nome_operador)}</span></div>
      ${renderizarCamposDados(registro.tipo_cip, registro.dados)}
      <div class="campo-dado"><span>Observações</span><span class="valor">${escaparHtml(registro.observacoes_operador || "—")}</span></div>
      <p class="rodape-doc">Criado em ${formatarDataHora(registro.criado_em)} · Última atualização em ${formatarDataHora(registro.atualizado_em)}</p>

      <div class="botoes">
        ${podeEditar ? `<a class="secundario" style="text-decoration:none;display:inline-flex;align-items:center;padding:0 20px;" href="registro.html?tipo=${registro.tipo_cip}&id=${registro.id}">Editar este registro</a>` : ""}
        <button type="button" class="secundario" onclick="document.getElementById('area-detalhe').innerHTML=''">Fechar</button>
      </div>

      <fieldset>
        <legend>Histórico de alterações</legend>
        ${htmlEdicoes}
      </fieldset>

      <fieldset>
        <legend>Observações administrativas</legend>
        ${htmlObservacoes}
        ${
          podeComentar
            ? `
          <div style="margin-top:10px;">
            <label for="nova-observacao">Adicionar observação</label>
            <textarea id="nova-observacao" placeholder="Descreva o problema ou observação encontrada"></textarea>
            <div class="botoes">
              <button type="button" class="primario" onclick="salvarObservacao('${registro.id}')">Salvar observação</button>
            </div>
          </div>
        `
            : ""
        }
      </fieldset>
    </div>
  `;
}

async function salvarObservacao(registroId) {
  const textarea = document.getElementById("nova-observacao");
  const texto = textarea.value.trim();

  if (texto.length < 3) {
    alert("Escreva uma observação com pelo menos 3 caracteres.");
    return;
  }

  const { data: sessionData } = await supabaseClient.auth.getSession();
  const uid = sessionData.session.user.id;

  const { error } = await supabaseClient.from("cip_observacoes").insert({
    registro_id: registroId,
    texto,
    administrador_nome: PERFIL_ATUAL.nome,
    administrador_uid: uid,
  });

  if (error) {
    alert("Erro ao salvar a observação: " + error.message);
    return;
  }

  await abrirDetalhe(registroId);
}

async function init() {
  const resultado = await exigirSessao();
  if (!resultado) return;
  PERFIL_ATUAL = resultado.perfil;

  document.getElementById("info-usuario").textContent =
    `${PERFIL_ATUAL.nome} (${PERFIL_ATUAL.role === "administrador" ? "Administrador" : "Operador"})`;

  preencherSelectTipos();

  // Pré-preenche os filtros a partir da URL (usado pelo "drill-down" do
  // painel administrativo: clicar num gráfico abre aqui já filtrado).
  const params = new URLSearchParams(window.location.search);
  if (params.get("tipo")) document.getElementById("f-tipo").value = params.get("tipo");
  if (params.get("equipamento")) document.getElementById("f-equipamento").value = params.get("equipamento");
  if (params.get("dataInicio")) document.getElementById("f-data-inicio").value = params.get("dataInicio");
  if (params.get("dataFim")) document.getElementById("f-data-fim").value = params.get("dataFim");

  document.getElementById("btn-filtrar").addEventListener("click", async () => {
    const botao = document.getElementById("btn-filtrar");
    const textoOriginal = botao.textContent;
    botao.disabled = true;
    botao.textContent = "Filtrando...";
    await carregarPrimeiraPagina();
    botao.disabled = false;
    botao.textContent = textoOriginal;
  });

  document.getElementById("btn-limpar").addEventListener("click", async () => {
    document.getElementById("f-tipo").value = "";
    document.getElementById("f-data-inicio").value = "";
    document.getElementById("f-data-fim").value = "";
    document.getElementById("f-operador").value = "";
    document.getElementById("f-equipamento").value = "";
    document.getElementById("f-texto").value = "";
    await carregarPrimeiraPagina();
  });

  document.getElementById("btn-carregar-mais").addEventListener("click", carregarProximaPagina);

  await carregarPrimeiraPagina();

  // Abre direto o detalhe de um registro específico quando chegamos aqui
  // a partir de um link do painel do operador (ex.: "Ver detalhes" nos
  // registros recentes) — não interfere nos filtros nem na listagem.
  if (params.get("registroId")) {
    abrirDetalhe(params.get("registroId"));
  }
}

init();
