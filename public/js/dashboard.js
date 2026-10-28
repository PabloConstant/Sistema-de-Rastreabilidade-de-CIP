// =====================================================================
// Dashboard gerencial do administrador (painel.html).
// Todos os números e gráficos vêm de consultas reais a cip_registros no
// Supabase — nada aqui é fixo, demonstrativo ou inventado. Quando não
// há dados suficientes (ou uma regra real para calcular algo), a tela
// mostra isso explicitamente em vez de inventar um valor.
//
// "Registros que necessitam de revisão": o formulário pedia este
// cartão apenas se existir uma regra real para identificá-los. A
// tabela cip_registros (ver supabase/schema.sql) não tem nenhuma
// coluna de status/revisão/conformidade — por isso este cartão foi
// deliberadamente OMITIDO, em vez de inventado.
// =====================================================================

const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function dashFormatarMes(aaaaMm) {
  const [ano, mes] = aaaaMm.split("-");
  return `${MESES_ABREV[Number(mes) - 1]}/${ano.slice(2)}`;
}

function dashChaveMes(dataIso) {
  return dataIso.slice(0, 7); // "AAAA-MM"
}

function dashEscaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = String(texto ?? "");
  return div.innerHTML;
}

// ---------------------------------------------------------------------
// Busca (uma única consulta, reaproveitada para KPIs e os 4 gráficos —
// evita múltiplas consultas pesadas separadas ao banco)
// ---------------------------------------------------------------------
const DASH_LIMITE_REGISTROS = 2000;

async function dashBuscarRegistros(filtros) {
  let query = supabaseClient
    .from("cip_registros")
    .select("id, tipo_cip, equipamento, data_cip, hora_inicial, hora_final, nome_operador, criado_em")
    .order("data_cip", { ascending: false })
    .limit(DASH_LIMITE_REGISTROS);

  if (filtros.tipo) query = query.eq("tipo_cip", filtros.tipo);
  if (filtros.equipamento) query = query.ilike("equipamento", `%${filtros.equipamento}%`);
  if (filtros.dataInicio) query = query.gte("data_cip", filtros.dataInicio);
  if (filtros.dataFim) query = query.lte("data_cip", filtros.dataFim);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------
// Agregações (tudo client-side, sobre o resultado já buscado)
// ---------------------------------------------------------------------

function dashCalcularKPIs(registros) {
  const hoje = new Date();
  const mesAtualChave = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;

  const porTipo = {};
  Object.keys(TIPO_CIP_LABELS).forEach((t) => (porTipo[t] = 0));
  const equipamentos = new Set();
  let noMesAtual = 0;

  registros.forEach((r) => {
    if (porTipo[r.tipo_cip] !== undefined) porTipo[r.tipo_cip]++;
    if (r.equipamento) equipamentos.add(r.equipamento);
    if (dashChaveMes(r.data_cip) === mesAtualChave) noMesAtual++;
  });

  return {
    total: registros.length,
    noMesAtual,
    porTipo,
    equipamentosDistintos: equipamentos.size,
  };
}

function dashAgruparPorMes(registros) {
  if (registros.length === 0) return [];
  const contagem = {};
  registros.forEach((r) => {
    const chave = dashChaveMes(r.data_cip);
    contagem[chave] = (contagem[chave] || 0) + 1;
  });
  const chaves = Object.keys(contagem).sort();
  // Preenche meses sem registro entre o primeiro e o último, para a
  // evolução mensal não parecer um intervalo aleatório de barras.
  const [anoIni, mesIni] = chaves[0].split("-").map(Number);
  const [anoFim, mesFim] = chaves[chaves.length - 1].split("-").map(Number);
  const serie = [];
  let ano = anoIni;
  let mes = mesIni;
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    const chave = `${ano}-${String(mes).padStart(2, "0")}`;
    serie.push({ mes: chave, total: contagem[chave] || 0 });
    mes++;
    if (mes > 12) {
      mes = 1;
      ano++;
    }
  }
  return serie;
}

function dashAgruparPorTipo(registros) {
  const porTipo = {};
  Object.keys(TIPO_CIP_LABELS).forEach((t) => (porTipo[t] = 0));
  registros.forEach((r) => {
    if (porTipo[r.tipo_cip] !== undefined) porTipo[r.tipo_cip]++;
  });
  return Object.keys(porTipo).map((tipo) => ({ tipo, label: TIPO_CIP_LABELS[tipo], total: porTipo[tipo] }));
}

function dashAgruparPorEquipamento(registros, topN) {
  const contagem = {};
  registros.forEach((r) => {
    if (!r.equipamento) return;
    contagem[r.equipamento] = (contagem[r.equipamento] || 0) + 1;
  });
  return Object.entries(contagem)
    .map(([equipamento, total]) => ({ equipamento, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, topN || 10);
}

// Diferença em minutos entre hora_inicial e hora_final (formato "HH:MM:SS"
// ou "HH:MM"), tratando corretamente um CIP que atravessa a meia-noite.
function dashDuracaoMinutos(horaInicial, horaFinal) {
  const paraMinutos = (h) => {
    const [hh, mm] = h.split(":").map(Number);
    return hh * 60 + mm;
  };
  const ini = paraMinutos(horaInicial);
  const fim = paraMinutos(horaFinal);
  let diff = fim - ini;
  if (diff < 0) diff += 24 * 60; // atravessou a meia-noite
  return diff;
}

// Só considera um registro para duração se o TIPO realmente tem campo de
// hora final no formulário original (FORM_CONFIG[...].temHoraFinal) e se
// ambos os horários estão de fato preenchidos — nunca estima um valor.
function dashCalcularDuracoes(registros) {
  const porTipo = {};
  const porMes = {};

  registros.forEach((r) => {
    const config = FORM_CONFIG[r.tipo_cip];
    if (!config || !config.temHoraFinal) return;
    if (!r.hora_inicial || !r.hora_final) return;
    const minutos = dashDuracaoMinutos(r.hora_inicial, r.hora_final);
    if (!Number.isFinite(minutos) || minutos <= 0 || minutos > 20 * 60) return; // descarta valores implausíveis (>20h), provável erro de digitação, sem tentar "corrigir"

    if (!porTipo[r.tipo_cip]) porTipo[r.tipo_cip] = [];
    porTipo[r.tipo_cip].push(minutos);

    const chaveMes = dashChaveMes(r.data_cip);
    if (!porMes[chaveMes]) porMes[chaveMes] = [];
    porMes[chaveMes].push(minutos);
  });

  const media = (lista) => lista.reduce((a, b) => a + b, 0) / lista.length;

  const porTipoResultado = Object.keys(TIPO_CIP_LABELS)
    .map((tipo) => ({
      tipo,
      label: TIPO_CIP_LABELS[tipo],
      temCampoHoraFinal: !!(FORM_CONFIG[tipo] && FORM_CONFIG[tipo].temHoraFinal),
      amostras: porTipo[tipo] ? porTipo[tipo].length : 0,
      mediaMinutos: porTipo[tipo] && porTipo[tipo].length ? media(porTipo[tipo]) : null,
    }));

  const porMesResultado = Object.keys(porMes)
    .sort()
    .map((chave) => ({ mes: chave, amostras: porMes[chave].length, mediaMinutos: media(porMes[chave]) }));

  return { porTipo: porTipoResultado, porMes: porMesResultado };
}

function dashFormatarMinutos(min) {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
}

// ---------------------------------------------------------------------
// Navegação para o histórico já filtrado (drill-down ao clicar em uma
// coluna/segmento/equipamento de um gráfico)
// ---------------------------------------------------------------------
function dashIrParaHistorico(filtrosExtra, filtrosAtuais) {
  const params = new URLSearchParams();
  const tipo = (filtrosExtra && filtrosExtra.tipo) || filtrosAtuais.tipo;
  const equipamento = (filtrosExtra && filtrosExtra.equipamento) || filtrosAtuais.equipamento;
  let dataInicio = filtrosAtuais.dataInicio;
  let dataFim = filtrosAtuais.dataFim;
  if (filtrosExtra && filtrosExtra.mes) {
    dataInicio = `${filtrosExtra.mes}-01`;
    const [ano, mes] = filtrosExtra.mes.split("-").map(Number);
    const proximo = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
    const fimDate = new Date(proximo);
    fimDate.setDate(fimDate.getDate() - 1);
    dataFim = fimDate.toISOString().slice(0, 10);
  }
  if (tipo) params.set("tipo", tipo);
  if (equipamento) params.set("equipamento", equipamento);
  if (dataInicio) params.set("dataInicio", dataInicio);
  if (dataFim) params.set("dataFim", dataFim);
  window.location.href = "historico.html" + (params.toString() ? "?" + params.toString() : "");
}

// ---------------------------------------------------------------------
// Paleta dos gráficos (mesma identidade do sistema — não usa cores
// aleatórias do Chart.js)
// ---------------------------------------------------------------------
const DASH_CORES = {
  primaria: "#1f4d3a",
  primariaClara: "#3c7a5c",
  admin: "#2a4b57",
  adminClara: "#4a7a8c",
  aviso: "#b8752b",
  erro: "#a23b3b",
  grade: "#d7ded3",
  texto: "#4b5750",
};
const DASH_CORES_TIPO = ["#1f4d3a", "#3c7a5c", "#2a4b57", "#4a7a8c"];

function dashOpcoesBase() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: DASH_CORES.texto, font: { family: "IBM Plex Sans" } } },
      tooltip: { titleFont: { family: "IBM Plex Sans" }, bodyFont: { family: "IBM Plex Sans" } },
    },
    scales: {
      x: { ticks: { color: DASH_CORES.texto, font: { family: "IBM Plex Mono", size: 11 } }, grid: { color: DASH_CORES.grade } },
      y: { ticks: { color: DASH_CORES.texto, font: { family: "IBM Plex Mono", size: 11 } }, grid: { color: DASH_CORES.grade }, beginAtZero: true },
    },
  };
}

// =======================================================================
// Orquestração do dashboard (chamada por painel.html quando perfil é
// "administrador"). Mantém os filtros e as instâncias dos 4 gráficos.
// =======================================================================

let dashFiltrosAtuais = { tipo: "", equipamento: "", dataInicio: "", dataFim: "" };
let dashRegistrosAtuais = [];
let dashGraficos = { a: null, b: null, c: null, d: null };

function dashLerFiltros() {
  return {
    tipo: document.getElementById("dash-filtro-tipo").value,
    equipamento: document.getElementById("dash-filtro-equipamento").value.trim(),
    dataInicio: document.getElementById("dash-filtro-data-inicio").value,
    dataFim: document.getElementById("dash-filtro-data-fim").value,
  };
}

function dashMostrarMensagem(tipo, texto) {
  const el = document.getElementById("dash-mensagem");
  if (!texto) {
    el.innerHTML = "";
    return;
  }
  const classe = tipo === "erro" ? "mensagem-erro" : tipo === "aviso" ? "mensagem-aviso" : "mensagem-sucesso";
  el.innerHTML = `<div class="${classe}">${dashEscaparHtml(texto)}</div>`;
}

function dashRenderizarKPIs(kpis, filtros) {
  document.getElementById("kpi-total").textContent = String(kpis.total);
  document.getElementById("kpi-mes-atual").textContent = String(kpis.noMesAtual);
  document.getElementById("kpi-equipamentos").textContent = String(kpis.equipamentosDistintos);

  const container = document.getElementById("kpi-por-tipo-badges");
  const entradas = Object.keys(TIPO_CIP_LABELS).map((tipo) => ({ tipo, total: kpis.porTipo[tipo] || 0 }));
  container.innerHTML = entradas
    .map((e) => `<span class="badge" title="${dashEscaparHtml(TIPO_CIP_LABELS[e.tipo])}">${dashEscaparHtml(TIPO_CIP_LABELS[e.tipo])}: ${e.total}</span>`)
    .join("");

  const avisoLimite = document.getElementById("dash-aviso-limite");
  avisoLimite.textContent =
    kpis.total === DASH_LIMITE_REGISTROS
      ? `Mostrando os ${DASH_LIMITE_REGISTROS} registros mais recentes que combinam com o filtro — use o período para refinar se houver mais.`
      : "";
}

function dashDestruirGrafico(chave) {
  if (dashGraficos[chave]) {
    dashGraficos[chave].destroy();
    dashGraficos[chave] = null;
  }
}

function dashMostrarEstadoGrafico(idEstado, tipo, texto) {
  const el = document.getElementById(idEstado);
  if (!texto) {
    el.className = "oculto";
    el.innerHTML = "";
    return;
  }
  el.className = tipo === "erro" ? "estado-erro" : tipo === "carregando" ? "estado-carregando" : "estado-vazio";
  el.textContent = texto;
}

function dashRenderizarGraficoA(registros, filtros, comparar) {
  dashDestruirGrafico("a");
  const serieAtual = dashAgruparPorMes(registros);
  if (serieAtual.length === 0) {
    dashMostrarEstadoGrafico("grafico-a-estado", "vazio", "Sem dados disponíveis para o período selecionado.");
    return;
  }
  dashMostrarEstadoGrafico("grafico-a-estado", null, null);

  const datasets = [
    {
      label: "Registros",
      data: serieAtual.map((p) => p.total),
      backgroundColor: DASH_CORES.primariaClara,
      borderColor: DASH_CORES.primaria,
      borderRadius: 3,
    },
  ];

  if (comparar && filtros.dataInicio && filtros.dataFim) {
    const inicio = new Date(filtros.dataInicio);
    const fim = new Date(filtros.dataFim);
    const spanDias = Math.max(1, Math.round((fim - inicio) / 86400000) + 1);
    const fimAnterior = new Date(inicio);
    fimAnterior.setDate(fimAnterior.getDate() - 1);
    const inicioAnterior = new Date(fimAnterior);
    inicioAnterior.setDate(inicioAnterior.getDate() - (spanDias - 1));

    dashBuscarRegistros({
      tipo: filtros.tipo,
      equipamento: filtros.equipamento,
      dataInicio: inicioAnterior.toISOString().slice(0, 10),
      dataFim: fimAnterior.toISOString().slice(0, 10),
    }).then((registrosAnteriores) => {
      const serieAnterior = dashAgruparPorMes(registrosAnteriores);
      const totalAnterior = serieAnterior.reduce((a, p) => a + p.total, 0);
      // Alinhado por posição (mês 1 do período anterior vs. mês 1 do
      // período atual) — os rótulos do eixo continuam sendo os meses do
      // período ATUAL, então a série anterior é só um comparativo visual.
      const valoresAnteriores = serieAtual.map((_, i) => (serieAnterior[i] ? serieAnterior[i].total : 0));
      dashGraficos.a.data.datasets.push({
        label: `Período anterior (${totalAnterior} no total)`,
        data: valoresAnteriores,
        backgroundColor: "rgba(0,0,0,0)",
        borderColor: DASH_CORES.aviso,
        borderDash: [5, 4],
        type: "line",
        tension: 0.25,
      });
      dashGraficos.a.update();
    }).catch(() => {
      // Comparação é um extra opcional — se falhar, mantém o gráfico
      // principal (já renderizado) sem o comparativo, sem travar a tela.
    });
  }

  const ctx = document.getElementById("grafico-a").getContext("2d");
  dashGraficos.a = new Chart(ctx, {
    type: "bar",
    data: { labels: serieAtual.map((p) => dashFormatarMes(p.mes)), datasets },
    options: {
      ...dashOpcoesBase(),
      onClick: (evt, elementos) => {
        if (!elementos.length) return;
        const idx = elementos[0].index;
        dashIrParaHistorico({ mes: serieAtual[idx].mes }, filtros);
      },
    },
  });
}

function dashRenderizarGraficoB(registros, filtros) {
  dashDestruirGrafico("b");
  const dadosTipo = dashAgruparPorTipo(registros);
  const total = dadosTipo.reduce((a, d) => a + d.total, 0);
  if (total === 0) {
    dashMostrarEstadoGrafico("grafico-b-estado", "vazio", "Sem dados disponíveis para o período selecionado.");
    return;
  }
  dashMostrarEstadoGrafico("grafico-b-estado", null, null);

  const ctx = document.getElementById("grafico-b").getContext("2d");
  dashGraficos.b = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: dadosTipo.map((d) => d.label),
      datasets: [{ data: dadosTipo.map((d) => d.total), backgroundColor: DASH_CORES_TIPO, borderColor: "#fff", borderWidth: 2 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { color: DASH_CORES.texto, font: { family: "IBM Plex Sans", size: 11 } } } },
      onClick: (evt, elementos) => {
        if (!elementos.length) return;
        const idx = elementos[0].index;
        dashIrParaHistorico({ tipo: dadosTipo[idx].tipo }, filtros);
      },
    },
  });
}

function dashRenderizarGraficoC(registros, filtros) {
  dashDestruirGrafico("c");
  const dadosEquip = dashAgruparPorEquipamento(registros, 10);
  if (dadosEquip.length === 0) {
    dashMostrarEstadoGrafico("grafico-c-estado", "vazio", "Sem dados disponíveis para o período selecionado.");
    return;
  }
  dashMostrarEstadoGrafico("grafico-c-estado", null, null);

  const ctx = document.getElementById("grafico-c").getContext("2d");
  dashGraficos.c = new Chart(ctx, {
    type: "bar",
    data: {
      labels: dadosEquip.map((d) => d.equipamento),
      datasets: [{ label: "Registros", data: dadosEquip.map((d) => d.total), backgroundColor: DASH_CORES.adminClara, borderColor: DASH_CORES.admin, borderRadius: 3 }],
    },
    options: {
      ...dashOpcoesBase(),
      indexAxis: "y",
      plugins: { ...dashOpcoesBase().plugins, legend: { display: false } },
      onClick: (evt, elementos) => {
        if (!elementos.length) return;
        const idx = elementos[0].index;
        dashIrParaHistorico({ equipamento: dadosEquip[idx].equipamento }, filtros);
      },
    },
  });
}

function dashRenderizarGraficoD(registros, filtros, modo) {
  dashDestruirGrafico("d");
  const duracoes = dashCalcularDuracoes(registros);
  const algumaAmostra = duracoes.porTipo.some((t) => t.amostras > 0);

  if (!algumaAmostra) {
    dashMostrarEstadoGrafico(
      "grafico-d-estado",
      "vazio",
      "Sem registros com hora inicial e final válidas no período selecionado para calcular duração."
    );
    return;
  }
  dashMostrarEstadoGrafico("grafico-d-estado", null, null);

  const ctx = document.getElementById("grafico-d").getContext("2d");

  if (modo === "tempo") {
    if (duracoes.porMes.length === 0) {
      dashMostrarEstadoGrafico("grafico-d-estado", "vazio", "Sem dados suficientes para a evolução ao longo do tempo.");
      return;
    }
    dashGraficos.d = new Chart(ctx, {
      type: "line",
      data: {
        labels: duracoes.porMes.map((p) => dashFormatarMes(p.mes)),
        datasets: [
          {
            label: "Duração média (todos os tipos com hora final)",
            data: duracoes.porMes.map((p) => Math.round(p.mediaMinutos)),
            borderColor: DASH_CORES.primaria,
            backgroundColor: DASH_CORES.primariaClara,
            tension: 0.25,
          },
        ],
      },
      options: {
        ...dashOpcoesBase(),
        plugins: {
          ...dashOpcoesBase().plugins,
          tooltip: { callbacks: { label: (c) => dashFormatarMinutos(c.parsed.y) } },
        },
      },
    });
  } else {
    const comDados = duracoes.porTipo.filter((t) => t.temCampoHoraFinal);
    dashGraficos.d = new Chart(ctx, {
      type: "bar",
      data: {
        labels: comDados.map((t) => t.label + (t.amostras === 0 ? " (sem dados)" : "")),
        datasets: [
          {
            label: "Duração média",
            data: comDados.map((t) => (t.mediaMinutos != null ? Math.round(t.mediaMinutos) : 0)),
            backgroundColor: DASH_CORES_TIPO,
            borderRadius: 3,
          },
        ],
      },
      options: {
        ...dashOpcoesBase(),
        plugins: {
          ...dashOpcoesBase().plugins,
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => (comDados[c.dataIndex].amostras ? dashFormatarMinutos(c.parsed.y) + ` (${comDados[c.dataIndex].amostras} registro(s))` : "Sem dados") } },
        },
      },
    });
  }

  const nota = document.getElementById("grafico-d-nota");
  const tiposSemCampo = Object.keys(TIPO_CIP_LABELS).filter((t) => !(FORM_CONFIG[t] && FORM_CONFIG[t].temHoraFinal));
  nota.textContent =
    tiposSemCampo.length > 0
      ? `${tiposSemCampo.map((t) => TIPO_CIP_LABELS[t]).join(", ")} não tem campo de hora final no formulário original, por isso não entra neste cálculo.`
      : "";
}

async function dashCarregar() {
  dashFiltrosAtuais = dashLerFiltros();
  dashMostrarMensagem(null, "");
  ["a", "b", "c", "d"].forEach((c) => dashMostrarEstadoGrafico(`grafico-${c}-estado`, "carregando", "Carregando..."));

  try {
    dashRegistrosAtuais = await dashBuscarRegistros(dashFiltrosAtuais);
  } catch (error) {
    const classificado = typeof classificarErroSupabase === "function" ? classificarErroSupabase(error) : null;
    dashMostrarMensagem("erro", classificado ? classificado.mensagem : "Não foi possível carregar os dados do painel: " + error.message);
    ["a", "b", "c", "d"].forEach((c) => dashMostrarEstadoGrafico(`grafico-${c}-estado`, "erro", "Não foi possível carregar."));
    document.getElementById("kpi-total").textContent = "—";
    document.getElementById("kpi-mes-atual").textContent = "—";
    document.getElementById("kpi-equipamentos").textContent = "—";
    document.getElementById("kpi-por-tipo-badges").innerHTML = "";
    return;
  }

  const kpis = dashCalcularKPIs(dashRegistrosAtuais);
  dashRenderizarKPIs(kpis, dashFiltrosAtuais);

  const comparar = document.getElementById("grafico-a-comparar").checked;
  dashRenderizarGraficoA(dashRegistrosAtuais, dashFiltrosAtuais, comparar);
  dashRenderizarGraficoB(dashRegistrosAtuais, dashFiltrosAtuais);
  dashRenderizarGraficoC(dashRegistrosAtuais, dashFiltrosAtuais);
  dashRenderizarGraficoD(dashRegistrosAtuais, dashFiltrosAtuais, document.getElementById("grafico-d-modo").value);
}

function iniciarDashboard() {
  const selectTipo = document.getElementById("dash-filtro-tipo");
  Object.entries(TIPO_CIP_LABELS).forEach(([tipo, label]) => {
    const opt = document.createElement("option");
    opt.value = tipo;
    opt.textContent = label;
    selectTipo.appendChild(opt);
  });

  document.getElementById("dash-btn-filtrar").addEventListener("click", dashCarregar);
  document.getElementById("dash-btn-limpar").addEventListener("click", () => {
    document.getElementById("dash-filtro-tipo").value = "";
    document.getElementById("dash-filtro-equipamento").value = "";
    document.getElementById("dash-filtro-data-inicio").value = "";
    document.getElementById("dash-filtro-data-fim").value = "";
    document.getElementById("grafico-a-comparar").checked = false;
    dashCarregar();
  });
  document.getElementById("grafico-a-comparar").addEventListener("change", dashCarregar);
  document.getElementById("grafico-d-modo").addEventListener("change", () => {
    dashRenderizarGraficoD(dashRegistrosAtuais, dashFiltrosAtuais, document.getElementById("grafico-d-modo").value);
  });

  const atualizarEstadoComparar = () => {
    const temPeriodo = document.getElementById("dash-filtro-data-inicio").value && document.getElementById("dash-filtro-data-fim").value;
    const checkbox = document.getElementById("grafico-a-comparar");
    checkbox.disabled = !temPeriodo;
    checkbox.closest("label").title = temPeriodo ? "" : "Selecione um período (de/até) para comparar com o intervalo equivalente anterior.";
  };
  document.getElementById("dash-filtro-data-inicio").addEventListener("change", atualizarEstadoComparar);
  document.getElementById("dash-filtro-data-fim").addEventListener("change", atualizarEstadoComparar);
  atualizarEstadoComparar();

  dashCarregar();
}
