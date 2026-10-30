// =====================================================================
// Painel enriquecido do operador (painel.html, quando perfil.role ===
// "operador"): KPIs, 2 gráficos e as listas de registros recentes e de
// últimos CIP por equipamento — tudo calculado a partir de consultas
// reais a cip_registros no Supabase. Nada aqui é fixo ou inventado;
// quando não há dados suficientes, a tela mostra isso explicitamente.
//
// A lógica dos 4 formulários oficiais, do dashboard administrativo
// (dashboard.js) e das regras de negócio (RLS, validarJustificativa.js,
// equipamentos.js) não é alterada por este arquivo — ele só lê dados
// reais e desenha o painel do operador.
// =====================================================================

// ---- Fuso horário explícito (America/Sao_Paulo), independente do
// dispositivo de quem está usando o sistema — mesma técnica já usada e
// testada na demonstração aprovada.
const OP_FUSO = "America/Sao_Paulo";

function opAgoraFabrica() {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: OP_FUSO,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const v = {};
  partes.forEach((p) => { if (p.type !== "literal") v[p.type] = p.value; });
  let hora = Number(v.hour);
  if (hora === 24) hora = 0;
  return new Date(Number(v.year), Number(v.month) - 1, Number(v.day), hora, Number(v.minute), Number(v.second));
}

function opChaveDataLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function opChaveMesLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function opEscaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = String(texto ?? "");
  return div.innerHTML;
}

function opFmtData(dataIso) {
  if (!dataIso) return "—";
  const [ano, mes, dia] = dataIso.split("-");
  return `${dia}/${mes}/${ano}`;
}

const OP_CORES_TIPO = {
  alcalino_clorado: "#1f4d3a",
  completo: "#3c7a5c",
  tanque_levedura: "#8a5a12",
  linha_recuperacao_levedura: "#2a4b57",
};

const OP_ICONE = {
  relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  semana: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  mes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l5-5 4 4 8-8"/></svg>',
  equip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 21V9l8-6 8 6v12M4 21h16M9 21v-6h6v6"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 3h16v18H4z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  gota: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8 6 5 10 5 14a7 7 0 0014 0c0-4-3-8-7-12z"/></svg>',
  linhas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>',
};

// Janela de consulta para KPIs e para os 2 gráficos: cobre pelo menos
// os últimos 14 dias (gráfico de atividade) e o mês atual (KPI "mês
// atual"), limitada a 90 dias para manter a consulta leve e o
// gráfico de distribuição com um recorte honesto (não é "desde
// sempre" — o rótulo do gráfico deixa isso explícito).
const OP_JANELA_DIAS = 90;
let OP_GRAFICOS = { atividade: null, distribuicao: null };

function opTentarRenderizarGrafico(fn, canvasId) {
  if (typeof Chart === "undefined") {
    const canvas = document.getElementById(canvasId);
    if (canvas && canvas.parentElement) {
      canvas.parentElement.innerHTML = `<div class="estado-erro">Biblioteca de gráficos indisponível (verifique a conexão).</div>`;
    }
    return;
  }
  try {
    fn();
  } catch (e) {
    console.error("Falha ao renderizar gráfico do painel do operador:", e);
    const canvas = document.getElementById(canvasId);
    if (canvas && canvas.parentElement) {
      canvas.parentElement.innerHTML = `<div class="estado-erro">Não foi possível desenhar este gráfico.</div>`;
    }
  }
}

async function opBuscarJanela() {
  const hoje = opAgoraFabrica();
  const inicioJanela = opAgoraFabrica();
  inicioJanela.setDate(inicioJanela.getDate() - OP_JANELA_DIAS);
  // Garante que o mês atual inteiro também entra na janela, mesmo que
  // o dia 1 do mês seja anterior aos 90 dias (meses de referência curtos).
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const dataMinima = opChaveDataLocal(inicioMes < inicioJanela ? inicioMes : inicioJanela);

  const { data, error } = await supabaseClient
    .from("cip_registros")
    .select("id, tipo_cip, equipamento, data_cip, hora_inicial, nome_operador, criado_em")
    .gte("data_cip", dataMinima)
    .order("data_cip", { ascending: false })
    .limit(1500);

  if (error) throw error;
  return data || [];
}

function opCalcularKPIs(registros) {
  const hoje = opChaveDataLocal(opAgoraFabrica());
  const seteDiasAtras = opAgoraFabrica();
  seteDiasAtras.setDate(seteDiasAtras.getDate() - 6);
  const chave7 = opChaveDataLocal(seteDiasAtras);
  const mesAtual = opChaveMesLocal(opAgoraFabrica());

  const registrosHoje = registros.filter((r) => r.data_cip === hoje).length;
  const ultimos7 = registros.filter((r) => r.data_cip >= chave7 && r.data_cip <= hoje).length;
  const doMes = registros.filter((r) => r.data_cip.slice(0, 7) === mesAtual);
  const equipMes = new Set(doMes.map((r) => r.equipamento)).size;

  return { registrosHoje, ultimos7, mesAtual: doMes.length, equipMes };
}

function opRenderizarGraficoAtividade(registros) {
  const dias = [];
  const labels = [];
  for (let i = 13; i >= 0; i--) {
    const d = opAgoraFabrica();
    d.setDate(d.getDate() - i);
    dias.push(opChaveDataLocal(d));
    labels.push(d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }));
  }
  const valores = dias.map((dia) => registros.filter((r) => r.data_cip === dia).length);

  if (OP_GRAFICOS.atividade) OP_GRAFICOS.atividade.destroy();
  OP_GRAFICOS.atividade = new Chart(document.getElementById("op-grafico-atividade"), {
    type: "bar",
    data: { labels, datasets: [{ label: "CIP registrados", data: valores, backgroundColor: "#1f4d3a", borderRadius: 4 }] },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} registro(s)` } },
      },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function opRenderizarGraficoDistribuicao(registros) {
  const tipos = Object.keys(TIPO_CIP_LABELS);
  const valores = tipos.map((t) => registros.filter((r) => r.tipo_cip === t).length);
  const total = valores.reduce((a, b) => a + b, 0);

  const caixa = document.getElementById("op-grafico-distribuicao").parentElement;
  if (total === 0) {
    caixa.innerHTML = `<div class="estado-vazio">Sem registros nos últimos ${OP_JANELA_DIAS} dias para mostrar a distribuição por tipo.</div>`;
    return;
  }

  if (OP_GRAFICOS.distribuicao) OP_GRAFICOS.distribuicao.destroy();
  OP_GRAFICOS.distribuicao = new Chart(document.getElementById("op-grafico-distribuicao"), {
    type: "doughnut",
    data: {
      labels: tipos.map((t) => TIPO_CIP_LABELS[t]),
      datasets: [{ data: valores, backgroundColor: tipos.map((t) => OP_CORES_TIPO[t]), borderWidth: 0 }],
    },
    options: {
      maintainAspectRatio: false,
      cutout: "58%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 11, padding: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const t = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
              return `${ctx.label}: ${ctx.parsed} (${((ctx.parsed / t) * 100).toFixed(0)}%)`;
            },
          },
        },
      },
    },
  });
}

function opRenderizarListaRegistros(containerId, registros, qtdInicial) {
  const el = document.getElementById(containerId);
  if (!registros || registros.length === 0) {
    el.innerHTML = '<p class="sem-dado">Nenhum registro encontrado.</p>';
    return;
  }
  el.innerHTML =
    registros
      .map(
        (r, i) => `
      <div class="item-registro${qtdInicial && i >= qtdInicial ? " oculto-paginacao" : ""}">
        <span class="tipo-marca" style="background:${OP_CORES_TIPO[r.tipo_cip] || "#888"}"></span>
        <div class="dados">
          <div class="linha-principal">${opEscaparHtml(TIPO_CIP_LABELS[r.tipo_cip] || r.tipo_cip)} — ${opEscaparHtml(r.equipamento)}</div>
          <div class="linha-secundaria">Operador: ${opEscaparHtml(r.nome_operador)}</div>
        </div>
        <div class="hora">${opFmtData(r.data_cip)} ${r.hora_inicial ? r.hora_inicial.slice(0, 5) : ""}</div>
        <a class="ver" href="historico.html?registroId=${encodeURIComponent(r.id)}">Ver detalhes</a>
      </div>
    `
      )
      .join("") +
    (qtdInicial && registros.length > qtdInicial
      ? `<button type="button" class="botao-ver-mais" id="opVerMais-${containerId}">Ver mais ${registros.length - qtdInicial} registros</button>`
      : "");

  const btn = document.getElementById(`opVerMais-${containerId}`);
  if (btn) {
    btn.addEventListener("click", () => {
      el.querySelectorAll(".oculto-paginacao").forEach((e) => e.classList.remove("oculto-paginacao"));
      btn.remove();
    });
  }
}

async function opCarregarRecentes() {
  const { data, error } = await supabaseClient
    .from("cip_registros")
    .select("id, tipo_cip, equipamento, data_cip, hora_inicial, nome_operador, criado_em")
    .order("criado_em", { ascending: false })
    .limit(15);

  if (error) {
    const classificado = typeof classificarErroSupabase === "function" ? classificarErroSupabase(error) : null;
    document.getElementById("op-lista-recentes").innerHTML =
      `<div class="mensagem-erro">${opEscaparHtml(classificado ? classificado.mensagem : error.message)}</div>`;
    return;
  }

  opRenderizarListaRegistros("op-lista-recentes", data || [], 6);
}

async function opCarregarUltimosPorEquipamento() {
  const { data, error } = await supabaseClient
    .from("cip_registros")
    .select("id, tipo_cip, equipamento, data_cip, hora_inicial, criado_em")
    .order("criado_em", { ascending: false })
    .limit(300);

  const lista = document.getElementById("op-lista-equip");

  if (error) {
    const classificado = typeof classificarErroSupabase === "function" ? classificarErroSupabase(error) : null;
    lista.innerHTML = `<div class="mensagem-erro">${opEscaparHtml(classificado ? classificado.mensagem : error.message)}</div>`;
    return;
  }

  const porEquip = {};
  (data || []).forEach((r) => {
    if (r.equipamento && !porEquip[r.equipamento]) porEquip[r.equipamento] = r;
  });
  const itens = Object.values(porEquip).slice(0, 8);

  lista.innerHTML =
    itens
      .map(
        (r) => `
      <div class="item-equip">
        <span class="marca-tipo" style="background:${OP_CORES_TIPO[r.tipo_cip] || "#888"}"></span>
        <div class="info">
          <div class="nome">${opEscaparHtml(r.equipamento)}</div>
          <div class="tipo">${opEscaparHtml(TIPO_CIP_LABELS[r.tipo_cip] || r.tipo_cip)}</div>
        </div>
        <div class="quando">
          <span class="data">${opFmtData(r.data_cip)}</span>
          <span class="hora-equip">${r.hora_inicial ? r.hora_inicial.slice(0, 5) : "horário não informado"}</span>
        </div>
      </div>
    `
      )
      .join("") || '<p class="sem-dado">Nenhum equipamento com CIP registrado ainda.</p>';
}

function opMontarCartoesFormularios() {
  const container = document.getElementById("op-cartoes-formularios");
  container.innerHTML = Object.entries(FORM_CONFIG)
    .map(([tipo, cfg]) => {
      const icone = tipo === "tanque_levedura" ? OP_ICONE.gota : tipo === "linha_recuperacao_levedura" ? OP_ICONE.linhas : OP_ICONE.doc;
      return `
        <a class="cartao-formulario" href="registro.html?tipo=${encodeURIComponent(tipo)}">
          <div class="icone-forms">${icone}</div>
          <h3>${opEscaparHtml(TIPO_CIP_LABELS[tipo])}</h3>
          <p>${opEscaparHtml(cfg.documentoOrigem)}</p>
          <div class="acao">Iniciar registro &rarr;</div>
        </a>
      `;
    })
    .join("");
}

// Ponto de entrada, chamado por painel.html quando perfil.role === "operador".
async function iniciarPainelOperador() {
  opMontarCartoesFormularios();

  try {
    const registros = await opBuscarJanela();
    const kpis = opCalcularKPIs(registros);
    document.getElementById("op-kpi-hoje").textContent = String(kpis.registrosHoje);
    document.getElementById("op-kpi-7d").textContent = String(kpis.ultimos7);
    document.getElementById("op-kpi-mes").textContent = String(kpis.mesAtual);
    document.getElementById("op-kpi-equip").textContent = String(kpis.equipMes);

    opTentarRenderizarGrafico(() => opRenderizarGraficoAtividade(registros), "op-grafico-atividade");
    opTentarRenderizarGrafico(() => opRenderizarGraficoDistribuicao(registros), "op-grafico-distribuicao");
  } catch (error) {
    const classificado = typeof classificarErroSupabase === "function" ? classificarErroSupabase(error) : null;
    ["op-kpi-hoje", "op-kpi-7d", "op-kpi-mes", "op-kpi-equip"].forEach((id) => (document.getElementById(id).textContent = "—"));
    document.getElementById("op-kpis-erro").innerHTML =
      `<div class="mensagem-erro">${opEscaparHtml(classificado ? classificado.mensagem : "Não foi possível carregar os indicadores: " + error.message)}</div>`;
  }

  opCarregarRecentes();
  opCarregarUltimosPorEquipamento();
}
