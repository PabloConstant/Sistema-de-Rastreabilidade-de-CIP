// =====================================================================
// Autenticação e controle de acesso por perfil (operador / administrador)
// =====================================================================
// Esquema REAL confirmado pelo usuário para "public.perfis": uid (uuid,
// referencia auth.users.id), perfil (text: 'operador'/'administrador'),
// nome (text), criado_em (timestamptz) — diferente dos nomes usados no
// schema.sql originalmente entregue (id/role/nome). A consulta abaixo
// usa os nomes reais da coluna (uid/perfil) e normaliza o resultado
// para { role, nome } em JS, para não precisar mudar nome de campo em
// todo o resto do código (historico.js, registro.js, painel.html etc.
// continuam lendo perfil.role/perfil.nome normalmente).

/**
 * Classifica um erro retornado pelo Supabase (Auth ou banco) em um tipo
 * reconhecível, para não mostrar sempre a mesma mensagem genérica
 * ("e-mail ou senha inválidos") para problemas completamente diferentes:
 * configuração ausente/errada, falha de conexão, permissão negada,
 * credenciais erradas, OU um perfil incompatível com o código (coluna/
 * tabela inexistente — útil caso o esquema real volte a mudar no
 * futuro). Retorna { tipo, mensagem }.
 */
function classificarErroSupabase(error) {
  if (!error) return null;

  const msg = String(error.message || error.error_description || "").toLowerCase();
  const status = error.status || error.statusCode || null;
  const codigo = error.code || null;

  // "column ... does not exist" / "relation ... does not exist" — o
  // código do site e a estrutura real do banco não são compatíveis.
  // Isso é diferente de "perfil ausente": o perfil pode até existir,
  // mas o nome da coluna consultada está errado.
  if (
    (msg.includes("does not exist") && (msg.includes("column") || msg.includes("relation") || msg.includes("table"))) ||
    codigo === "42703" || // undefined_column
    codigo === "42P01" // undefined_table
  ) {
    return {
      tipo: "esquema",
      mensagem:
        "Perfil incompatível: o código consultou uma coluna ou tabela que " +
        'não existe no banco ("' + (error.message || "") + '"). Isso não é ' +
        "senha errada — é uma diferença entre os nomes usados no código e " +
        "os nomes reais do banco (esperado: perfis.uid, perfis.perfil, " +
        "perfis.nome). Avise o administrador do banco.",
    };
  }

  // "No API key found in request" / "Invalid API key" — a URL ou a
  // chave pública (anon/publishable) em config.js está ausente,
  // incorreta, ou não está sendo enviada (ex.: script carregado fora
  // de ordem).
  if (msg.includes("api key") || msg.includes("apikey")) {
    return {
      tipo: "configuracao",
      mensagem:
        'Erro de configuração: o Supabase recusou a requisição por falta ' +
        'de uma chave de API válida ("' + (error.message || "") + '"). ' +
        "Confira se public/js/config.js tem a URL e a chave pública " +
        "(publishable/anon) corretas do seu projeto (passo 6 de " +
        "INSTRUCOES.md) e se os scripts são carregados na ordem certa " +
        "(config.js antes de supabaseClient.js).",
    };
  }

  // Falha de rede/DNS/CORS antes de chegar a uma resposta do Supabase.
  if (
    error instanceof TypeError ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed")
  ) {
    return {
      tipo: "conexao",
      mensagem:
        "Não foi possível conectar ao Supabase. Verifique sua internet e " +
        "se a URL do projeto em public/js/config.js está correta e " +
        "completa (https://SEU-PROJETO.supabase.co).",
    };
  }

  // Credenciais erradas de fato (resposta normal do Supabase Auth).
  if (
    msg.includes("invalid login credentials") ||
    msg.includes("invalid email or password") ||
    status === 400
  ) {
    return {
      tipo: "credenciais",
      mensagem: "E-mail ou senha inválidos. Verifique e tente novamente.",
    };
  }

  // Login ok, mas algo foi negado por permissão (RLS, chave sem
  // privilégio, etc.) — diferente de senha errada.
  if (
    status === 401 ||
    status === 403 ||
    msg.includes("permission denied") ||
    msg.includes("not authorized") ||
    msg.includes("row-level security")
  ) {
    return {
      tipo: "permissao",
      mensagem:
        "O login foi aceito, mas o acesso foi negado pelas permissões do " +
        "banco de dados. Avise o administrador do sistema — pode ser uma " +
        "política de segurança (RLS) ou um perfil mal configurado.",
    };
  }

  if (status === 429) {
    return {
      tipo: "limite",
      mensagem: "Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.",
    };
  }

  // Qualquer outro erro: mostra o detalhe técnico em vez de inventar uma
  // causa — é melhor um erro "cru" e correto do que um errado e enganoso.
  return {
    tipo: "desconhecido",
    mensagem: "Não foi possível entrar. Detalhe técnico: " + (error.message || "erro desconhecido") + ".",
  };
}

/**
 * Retorna a sessão atual (ou null) e o perfil ({ role, nome }) do
 * usuário. Se não houver sessão, redireciona para a tela de login. Se
 * houver sessão mas a consulta ao perfil falhar, diferencia "perfil
 * realmente ausente" de um erro de configuração/conexão/permissão/
 * esquema incompatível — nunca mostra a mesma mensagem genérica para
 * tudo.
 */
async function exigirSessao() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const session = sessionData && sessionData.session;

  if (!session) {
    window.location.href = "index.html";
    return null;
  }

  const { data: linhaPerfil, error } = await supabaseClient
    .from("perfis")
    .select("uid, perfil, nome")
    .eq("uid", session.user.id)
    .single();

  const perfil = linhaPerfil ? { role: linhaPerfil.perfil, nome: linhaPerfil.nome } : null;

  if (error || !perfil) {
    const codigo = error && error.code;
    const msg = String((error && error.message) || "").toLowerCase();
    // PGRST116 / "0 rows" / "no rows" / "multiple (or no) rows" é o caso
    // normal de "usuário autenticado mas sem linha em perfis" — mensagem
    // específica e orientada à ação (cadastrar o perfil). Qualquer outro
    // erro (esquema, conexão, permissão) usa classificarErroSupabase().
    const perfilRealmenteAusente =
      !error ||
      codigo === "PGRST116" ||
      msg.includes("no rows") ||
      msg.includes("0 rows") ||
      msg.includes("multiple (or no) rows");

    if (perfilRealmenteAusente) {
      mostrarErroPerfilAusente();
    } else {
      const classificado = classificarErroSupabase(error);
      mostrarErroConsultaPerfil(classificado ? classificado.mensagem : error.message);
    }
    return null;
  }

  return { session, perfil };
}

function mostrarErroPerfilAusente() {
  document.body.innerHTML = `
    <div class="tela-erro">
      <h1>Perfil não configurado</h1>
      <p>
        Seu usuário fez login, mas ainda não existe um perfil cadastrado
        na tabela <code>perfis</code>. Peça ao administrador do projeto
        Supabase para cadastrar seu usuário (veja o passo 5 de
        INSTRUCOES.md).
      </p>
      <button onclick="sair()">Sair</button>
    </div>
  `;
}

function mostrarErroConsultaPerfil(detalhe) {
  document.body.innerHTML = `
    <div class="tela-erro">
      <h1>Não foi possível verificar seu perfil</h1>
      <p>${detalhe}</p>
      <button onclick="sair()">Sair</button>
    </div>
  `;
}

async function fazerLogin(email, senha) {
  return supabaseClient.auth.signInWithPassword({ email, password: senha });
}

async function sair() {
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
}

/**
 * Redireciona a página atual para o painel correto conforme o perfil,
 * caso o usuário já esteja logado (usado na tela de login).
 */
async function redirecionarSeJaLogado() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (sessionData && sessionData.session) {
    window.location.href = "painel.html";
  }
}
