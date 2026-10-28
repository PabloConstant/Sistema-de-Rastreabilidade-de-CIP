-- =====================================================================
-- Sistema de Rastreabilidade de CIP — Schema do Supabase (PostgreSQL)
-- Projeto Supabase EXCLUSIVO para este sistema (não usar o banco do FTR)
-- =====================================================================
-- Execute este arquivo inteiro no SQL Editor do Supabase (projeto novo).
-- Pode ser executado de uma só vez, de cima para baixo. Não depende de
-- nenhuma simulação de teste — usa apenas objetos nativos do Supabase
-- (auth.users, auth.uid(), auth.role()).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Tipos
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_cip_enum') then
    create type tipo_cip_enum as enum (
      'alcalino_clorado',
      'completo',
      'tanque_levedura',
      'linha_recuperacao_levedura'
    );
  end if;
end$$;

-- ---------------------------------------------------------------------
-- 2. Perfis de usuário (operador compartilhado / administradores individuais)
-- ---------------------------------------------------------------------
-- Um registro aqui para cada usuário de auth.users.
-- perfil = 'operador'      -> conta única compartilhada pelos operadores
-- perfil = 'administrador' -> uma conta por administrador
--
-- NOTA: esta tabela já existe no projeto Supabase real em produção com
-- estes nomes de coluna (uid/perfil/nome, não id/role/nome). O
-- "create table if not exists" abaixo é só para recriar o projeto do
-- zero em outro ambiente — nunca deve ser reaplicado ao projeto de
-- produção já existente, que já tem a tabela e dados reais.
create table if not exists perfis (
  uid uuid primary key references auth.users(id) on delete cascade,
  perfil text not null check (perfil in ('operador', 'administrador')),
  nome text not null,
  criado_em timestamptz not null default now()
);

comment on table perfis is 'Perfil de cada usuário de autenticação (operador ou administrador).';

-- ---------------------------------------------------------------------
-- 3. Registros de CIP
-- ---------------------------------------------------------------------
create table if not exists cip_registros (
  id uuid primary key default gen_random_uuid(),
  tipo_cip tipo_cip_enum not null,
  equipamento text not null,
  data_cip date not null,
  hora_inicial time,
  hora_final time,
  nome_operador text not null,
  dados jsonb not null default '{}'::jsonb,       -- campos específicos de cada formulário
  observacoes_operador text,                       -- campo "Observações" do verso do formulário
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id)
);

comment on table cip_registros is 'Registro atual (estado vigente) de cada CIP executado. O histórico de alterações fica em cip_edicoes.';
comment on column cip_registros.dados is 'Campos específicos do tipo de formulário (concentrações, tempos, números de utilização etc.), em JSON.';

create index if not exists idx_cip_registros_tipo on cip_registros (tipo_cip);
create index if not exists idx_cip_registros_equipamento on cip_registros (equipamento);
create index if not exists idx_cip_registros_data on cip_registros (data_cip);
create index if not exists idx_cip_registros_operador on cip_registros (nome_operador);

-- ---------------------------------------------------------------------
-- 3b. Trava os campos de auditoria na CRIAÇÃO de um registro
-- ---------------------------------------------------------------------
-- O frontend faz um INSERT direto em cip_registros ao criar um novo CIP
-- (operação simples, já atômica por natureza — não precisa de RPC). Mas
-- um INSERT direto pela API permite que o cliente envie QUALQUER valor
-- nas colunas da linha, inclusive "criado_por", "atualizado_por",
-- "criado_em" e "atualizado_em" — um operador malicioso (ou um bug no
-- frontend) poderia, por exemplo, inserir um registro atribuindo a
-- autoria a outro uid, ou informando uma data de criação no passado.
-- Esta função de gatilho ignora qualquer valor que o cliente tenha
-- enviado nessas 4 colunas e os substitui, sempre, por valores lidos do
-- próprio servidor (now() e auth.uid()) — nunca por algo vindo de NEW.*
-- fornecido pelo cliente.
create or replace function cip_registros_set_auditoria_insert() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.criado_em := now();
  new.criado_por := auth.uid();
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

comment on function cip_registros_set_auditoria_insert() is
  'Gatilho BEFORE INSERT em cip_registros: define criado_em/criado_por/atualizado_em/atualizado_por a partir do servidor (now(), auth.uid()), ignorando qualquer valor enviado pelo cliente nessas colunas — impede que o cliente falsifique a autoria/data de criação de um registro.';

drop trigger if exists trg_cip_registros_auditoria_insert on cip_registros;
create trigger trg_cip_registros_auditoria_insert
  before insert on cip_registros
  for each row
  execute function cip_registros_set_auditoria_insert();

-- ---------------------------------------------------------------------
-- 4. Validação da justificativa de edição (usada pela constraint da
--    tabela cip_edicoes E pela função transacional de edição, seção 9)
-- ---------------------------------------------------------------------
-- Regras (requisito 5 do projeto):
--   - não pode ser vazia
--   - precisa ter pelo menos 4 letras reais (não pode ser só números,
--     espaços ou símbolos)
--   - não pode ser uma resposta genérica ("erro", "corrigir", "arrumar",
--     "alteração" etc.)
create or replace function justificativa_valida(p_texto text) returns boolean
language sql
immutable
as $$
  select
    p_texto is not null
    and char_length(regexp_replace(trim(p_texto), '[^A-Za-zÀ-ÖØ-öø-ÿ]', '', 'g')) >= 4
    and lower(trim(p_texto)) not in (
      'erro', 'erros', 'corrigir', 'correção', 'correcao', 'corrigido', 'corrigida',
      'arrumar', 'arrumado', 'arrumada', 'alteração', 'alteracao', 'alterado', 'alterada',
      'ajuste', 'ajustado', 'ajustada', 'edição', 'edicao', 'editado', 'editada',
      'mudança', 'mudanca', 'mudado', 'mudada', 'atualização', 'atualizacao',
      'atualizado', 'atualizada', 'ok', 'teste', 'n/a', 'na'
    );
$$;

comment on function justificativa_valida(text) is 'Valida a justificativa obrigatória de uma edição de CIP: não vazia, com letras reais, e não genérica.';

-- ---------------------------------------------------------------------
-- 5. Histórico de edições (com justificativa obrigatória)
-- ---------------------------------------------------------------------
create table if not exists cip_edicoes (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid not null references cip_registros(id) on delete cascade,
  valores_anteriores jsonb not null,   -- snapshot completo do registro antes da edição
  valores_novos jsonb not null,        -- snapshot completo do registro depois da edição
  justificativa text not null,
  -- IMPORTANTE: "alterado_por_nome" é o nome de QUEM FEZ A EDIÇÃO,
  -- digitado especificamente no momento da edição — NÃO é o mesmo campo
  -- que "nome_operador" de cip_registros (que identifica o responsável
  -- pelo CIP registrado, e que pode inclusive ser alterado por esta
  -- própria edição, ex.: corrigindo um nome digitado errado). Os dois
  -- são propositalmente independentes.
  alterado_por_nome text not null,
  -- "alterado_por_uid" identifica apenas a CONTA de autenticação usada
  -- (auth.users.id). Como a conta dos operadores é ÚNICA e
  -- COMPARTILHADA entre todas as pessoas da operação, este campo NÃO
  -- identifica individualmente quem fez a alteração — só confirma que
  -- foi feita por alguém autenticado com a conta de operador. A
  -- identificação de qual pessoa, de fato, é a que vem de
  -- "alterado_por_nome" (autodeclarada, sem verificação por
  -- autenticação individual).
  alterado_por_uid uuid references auth.users(id),
  alterado_em timestamptz not null default now()
);

comment on table cip_edicoes is 'Histórico imutável de alterações. Nenhuma linha pode ser apagada ou substituída (sem política de UPDATE/DELETE).';
comment on column cip_edicoes.alterado_por_nome is 'Nome autodeclarado de quem fez ESTA edição (digitado no momento da edição). Independente do campo nome_operador do registro, que pode ser alterado pela própria edição.';
comment on column cip_edicoes.alterado_por_uid is 'Conta de autenticação usada na edição. Como a conta de operador é compartilhada por toda a equipe, este campo identifica a CONTA, não necessariamente o indivíduo — a atribuição a uma pessoa específica depende de alterado_por_nome, que é autodeclarado.';

create index if not exists idx_cip_edicoes_registro on cip_edicoes (registro_id);

-- Camada extra de validação diretamente no banco, além da validação feita
-- no frontend e dentro da função transacional da seção 9: qualquer INSERT
-- em cip_edicoes (por qualquer caminho) precisa de uma justificativa válida.
alter table cip_edicoes
  drop constraint if exists justificativa_minima;

alter table cip_edicoes
  add constraint justificativa_minima check (justificativa_valida(justificativa));

-- ---------------------------------------------------------------------
-- 6. Observações administrativas
-- ---------------------------------------------------------------------
create table if not exists cip_observacoes (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid not null references cip_registros(id) on delete cascade,
  texto text not null check (char_length(trim(texto)) >= 3),
  administrador_nome text not null,
  administrador_uid uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

comment on table cip_observacoes is 'Observações do administrador vinculadas a um registro de CIP (ex.: problemas encontrados).';

create index if not exists idx_cip_observacoes_registro on cip_observacoes (registro_id);

-- ---------------------------------------------------------------------
-- 7. Função auxiliar para ler o role do usuário autenticado
-- ---------------------------------------------------------------------
create or replace function auth_role() returns text
language sql stable
as $$
  select perfil from public.perfis where uid = auth.uid();
$$;

comment on function auth_role() is
  'Lê o perfil (role) do usuário autenticado. Objeto "perfis" qualificado explicitamente com o schema (public.perfis) para funcionar corretamente mesmo quando chamada por uma função com search_path restrito, como editar_registro_cip (seção 9).';

-- ---------------------------------------------------------------------
-- 8. Row Level Security (RLS)
-- ---------------------------------------------------------------------
alter table perfis enable row level security;
alter table cip_registros enable row level security;
alter table cip_edicoes enable row level security;
alter table cip_observacoes enable row level security;

-- perfis: cada usuário só lê o próprio perfil (necessário para saber seu role)
drop policy if exists "perfis_select_proprio" on perfis;
create policy "perfis_select_proprio" on perfis
  for select
  using (auth.uid() = uid);
-- Não há política de insert/update/delete: perfis são geridos pelo
-- administrador do projeto Supabase (SQL Editor / service role), nunca
-- pelo frontend. Isso evita que um usuário se autopromova a administrador.

-- cip_registros: só quem tem um perfil cadastrado (operador OU
-- administrador) pode consultar. Um usuário autenticado SEM linha
-- correspondente em "perfis" (auth_role() retorna NULL) não aparece na
-- lista — "in ('operador', 'administrador')" com NULL resulta em NULL,
-- que a RLS trata como "nega o acesso", então isso já é seguro por
-- padrão mesmo sem um tratamento especial para NULL. Operador pode
-- CRIAR um registro novo diretamente (um único INSERT, já atômico por
-- natureza). Ninguém apaga.
--
-- IMPORTANTE — EDIÇÃO: propositalmente NÃO existe política de UPDATE
-- para esta tabela. A única forma de editar um registro já salvo é a
-- função editar_registro_cip (seção 9), que grava o histórico na mesma
-- transação. Sem uma política de UPDATE, a RLS bloqueia por padrão
-- qualquer tentativa de UPDATE direto pela API REST do Supabase
-- (PostgREST) — de operador OU administrador — contornando o frontend.
drop policy if exists "cip_registros_select" on cip_registros;
create policy "cip_registros_select" on cip_registros
  for select
  using (auth_role() in ('operador', 'administrador'));

drop policy if exists "cip_registros_insert_operador" on cip_registros;
create policy "cip_registros_insert_operador" on cip_registros
  for insert
  with check (auth_role() = 'operador');

drop policy if exists "cip_registros_update_operador" on cip_registros;
-- (nenhuma política de UPDATE é recriada aqui — ver explicação acima)

-- Camada extra, independente da RLS: remove também o privilégio de
-- UPDATE na tabela para as roles usadas pela API. Mesmo que a RLS seja
-- desabilitada por engano no futuro, o UPDATE direto continua
-- impossível para quem usa a API (a função da seção 9 não é afetada,
-- pois roda como "security definer", com os privilégios do seu dono).
revoke update on cip_registros from authenticated, anon;

-- cip_edicoes: qualquer autenticado consulta o histórico. Imutável.
--
-- IMPORTANTE — INSERÇÃO: propositalmente NÃO existe política de INSERT
-- para esta tabela. Se houvesse, um operador poderia inserir pela API
-- REST uma "edição" fantasma, sem relação com uma alteração real no
-- registro. A única forma de inserir aqui é dentro da função
-- editar_registro_cip (seção 9), junto com o UPDATE do registro, na
-- mesma transação.
-- Mesma regra de leitura de cip_registros: só operador ou administrador
-- com perfil cadastrado consultam o histórico.
drop policy if exists "cip_edicoes_select" on cip_edicoes;
create policy "cip_edicoes_select" on cip_edicoes
  for select
  using (auth_role() in ('operador', 'administrador'));

drop policy if exists "cip_edicoes_insert_operador" on cip_edicoes;
-- (nenhuma política de INSERT é recriada aqui — ver explicação acima)

revoke insert on cip_edicoes from authenticated, anon;

-- cip_observacoes: só operador ou administrador com perfil cadastrado
-- consultam; só administrador insere; imutável.
drop policy if exists "cip_observacoes_select" on cip_observacoes;
create policy "cip_observacoes_select" on cip_observacoes
  for select
  using (auth_role() in ('operador', 'administrador'));

drop policy if exists "cip_observacoes_insert_admin" on cip_observacoes;
create policy "cip_observacoes_insert_admin" on cip_observacoes
  for insert
  with check (auth_role() = 'administrador');

-- ---------------------------------------------------------------------
-- 9. Função RPC transacional: editar um registro de CIP + gravar
--    histórico, de forma ATÔMICA (tudo ou nada) — ÚNICO CAMINHO DE EDIÇÃO
-- ---------------------------------------------------------------------
-- Por que esta função existe: se o frontend fizesse um UPDATE em
-- cip_registros e depois um INSERT separado em cip_edicoes (duas
-- chamadas distintas ao banco), uma falha entre as duas etapas (rede,
-- navegador fechado, etc.) poderia deixar o registro alterado SEM o
-- histórico correspondente. Como todo o corpo de uma função PL/pgSQL
-- roda dentro de uma única transação implícita, se qualquer instrução
-- aqui dentro falhar (inclusive a validação da justificativa), TUDO é
-- desfeito automaticamente — o UPDATE e o INSERT são tratados como uma
-- unidade só.
--
-- SECURITY DEFINER (e não "invoker"): como as seções 8 removeram as
-- políticas de UPDATE em cip_registros e de INSERT em cip_edicoes (e
-- revogaram esses privilégios das roles da API), um "security invoker"
-- simples NÃO conseguiria mais fazer o UPDATE nem o INSERT — ficaria tão
-- bloqueado quanto a API REST. Por isso a função roda com os privilégios
-- de quem a CRIOU (o dono do projeto, que também é dono das tabelas),
-- contornando a RLS de propósito só dentro deste caminho único e
-- controlado. Isso só é seguro porque a própria função faz, de forma
-- explícita e obrigatória (não confiando em nenhuma restrição da
-- interface):
--   a) confere se existe um usuário autenticado (auth.uid() não nulo);
--   b) confere se o perfil desse usuário é exatamente 'operador'
--      (tratando corretamente o caso de perfil ausente/NULL);
--   c) valida a justificativa (não vazia, não genérica, com letras);
--   d) valida os campos obrigatórios do registro;
--   e) só então faz o UPDATE + INSERT, dentro da mesma transação.
-- "set search_path = ''" (vazio, e não apenas "public, pg_temp") é a
-- configuração mais restritiva possível contra o ataque clássico de
-- "search_path hijacking" em funções SECURITY DEFINER: com o search_path
-- vazio, NENHUM schema é pesquisado implicitamente (só o pg_catalog, que
-- o PostgreSQL sempre pesquisa primeiro, mesmo com search_path vazio —
-- por isso tipos e funções nativas como uuid, text, jsonb, now(),
-- jsonb_build_object(), btrim() continuam funcionando sem qualificação).
-- Todo objeto que NÃO é nativo do PostgreSQL (tabelas, e as duas funções
-- auxiliares deste projeto) é qualificado explicitamente com o schema
-- "public." em cada uso dentro do corpo da função — nenhuma referência
-- unqualified a cip_registros, cip_edicoes, auth_role() ou
-- justificativa_valida() é deixada para o search_path resolver.
--
-- Além disso, a seção 9 revoga a permissão de execução de todo mundo e
-- concede apenas para "authenticated" (nunca "anon") — então nem
-- usuários não logados conseguem nem tentar chamá-la.
create or replace function editar_registro_cip(
  p_registro_id uuid,
  p_equipamento text,
  p_data_cip date,
  p_hora_inicial time,
  p_hora_final time,
  p_nome_operador text,
  p_dados jsonb,
  p_observacoes_operador text,
  p_justificativa text,
  p_alterado_por_nome text
)
returns public.cip_registros
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registro public.cip_registros;
  v_valores_anteriores jsonb;
  v_valores_novos jsonb;
  v_uid uuid := auth.uid();
begin
  -- 1. Só usuário autenticado com perfil "operador" pode editar.
  --    "is distinct from" trata corretamente o caso de auth_role() ser
  --    NULL (usuário sem perfil cadastrado) — sem isso, "<> 'operador'"
  --    com NULL resultaria em NULL e o IF seria ignorado (falha de
  --    segurança por engano de SQL com NULL).
  if auth.uid() is null or public.auth_role() is distinct from 'operador' then
    raise exception 'Apenas o perfil operador pode editar registros de CIP.' using errcode = '42501';
  end if;

  if p_registro_id is null then
    raise exception 'Informe o registro a ser editado.' using errcode = '22023';
  end if;

  -- 2. Busca o registro atual e TRAVA a linha (evita duas edições
  --    simultâneas calcularem o "valor anterior" com base em dados
  --    desatualizados).
  select * into v_registro from public.cip_registros where id = p_registro_id for update;

  if v_registro.id is null then
    raise exception 'Registro de CIP não encontrado.' using errcode = 'P0002';
  end if;

  -- 3. Justificativa da ALTERAÇÃO: obrigatória e não genérica (mesma
  --    regra aplicada no frontend e reforçada pela constraint da tabela
  --    cip_edicoes).
  if not public.justificativa_valida(p_justificativa) then
    raise exception 'Justificativa inválida: não pode ficar vazia, ser apenas números/símbolos, ou uma resposta genérica como "erro" ou "corrigir".' using errcode = '23514';
  end if;

  -- 3b. Nome de quem está fazendo ESTA edição: obrigatório e
  --     independente do "Operador" do registro (ver comentário da
  --     tabela cip_edicoes). Como a conta de operador é compartilhada,
  --     este é o único jeito de saber quem fez a alteração — por isso é
  --     sempre exigido, mesmo que o campo "Operador" do registro não
  --     tenha mudado nesta edição.
  if p_alterado_por_nome is null or btrim(p_alterado_por_nome) = '' then
    raise exception 'Informe o nome de quem está fazendo esta alteração.' using errcode = '22023';
  end if;

  if p_equipamento is null or btrim(p_equipamento) = '' then
    raise exception 'Informe o equipamento.' using errcode = '22023';
  end if;
  if p_data_cip is null then
    raise exception 'Informe a data do CIP.' using errcode = '22023';
  end if;
  if p_nome_operador is null or btrim(p_nome_operador) = '' then
    raise exception 'Informe o nome do operador.' using errcode = '22023';
  end if;

  -- 3c. "Hora Inicial" é obrigatória na interface para os 4 formulários
  --     (ver validarCamposObrigatorios em public/js/registro.js) — mas a
  --     RPC pode ser chamada diretamente (ex.: API/ferramenta externa),
  --     sem passar pela validação em JavaScript. Por isso a mesma regra
  --     é repetida aqui, do lado do banco, como única fonte confiável.
  if p_hora_inicial is null then
    raise exception 'Informe a hora inicial.' using errcode = '22023';
  end if;

  -- "Hora Final" só é obrigatória para 3 dos 4 tipos de CIP — o tipo
  -- "tanque_levedura" não tem esse campo no formulário original (ver
  -- FORM_CONFIG[...].temHoraFinal em public/js/formConfig.js). Usa-se
  -- v_registro.tipo_cip (lido do próprio banco no passo 2, não um valor
  -- enviado pelo cliente) para decidir se a exigência se aplica.
  if v_registro.tipo_cip <> 'tanque_levedura' and p_hora_final is null then
    raise exception 'Informe a hora final.' using errcode = '22023';
  end if;

  -- 4. Monta os snapshots completos (antes/depois) para o histórico.
  --    Observação: estes snapshots guardam os dados DO REGISTRO (quem é
  --    o operador responsável, os campos do CIP etc.) — não têm relação
  --    com "quem fez esta edição", que é gravado em colunas próprias de
  --    cip_edicoes (alterado_por_nome / alterado_por_uid), fora do JSON.
  v_valores_anteriores := jsonb_build_object(
    'tipo_cip', v_registro.tipo_cip,
    'equipamento', v_registro.equipamento,
    'data_cip', v_registro.data_cip,
    'hora_inicial', v_registro.hora_inicial,
    'hora_final', v_registro.hora_final,
    'nome_operador', v_registro.nome_operador,
    'observacoes_operador', v_registro.observacoes_operador,
    'dados', v_registro.dados
  );

  v_valores_novos := jsonb_build_object(
    'tipo_cip', v_registro.tipo_cip,
    'equipamento', p_equipamento,
    'data_cip', p_data_cip,
    'hora_inicial', p_hora_inicial,
    'hora_final', p_hora_final,
    'nome_operador', p_nome_operador,
    'observacoes_operador', p_observacoes_operador,
    'dados', p_dados
  );

  if v_valores_anteriores = v_valores_novos then
    raise exception 'Nenhum campo foi alterado — nada para salvar.' using errcode = '22023';
  end if;

  -- 5. Atualiza o registro. Como a função é "security definer", este
  --    UPDATE não depende de nenhuma política de RLS — a autorização já
  --    foi feita manualmente no passo 1 (perfil operador obrigatório).
  update public.cip_registros set
    equipamento = p_equipamento,
    data_cip = p_data_cip,
    hora_inicial = p_hora_inicial,
    hora_final = p_hora_final,
    nome_operador = p_nome_operador,
    dados = coalesce(p_dados, '{}'::jsonb),
    observacoes_operador = p_observacoes_operador,
    atualizado_em = now(),
    atualizado_por = v_uid
  where id = p_registro_id
  returning * into v_registro;

  -- 6. Grava o histórico. Não depende de política de RLS pelo mesmo
  --    motivo do passo 5, mas ainda passa pela constraint
  --    "justificativa_minima" da tabela (defesa em profundidade). Se
  --    ESTA instrução falhar por qualquer motivo, o UPDATE acima é
  --    desfeito junto — é isso que torna a operação atômica.
  --    "alterado_por_nome" recebe p_alterado_por_nome (quem fez ESTA
  --    edição) — NUNCA p_nome_operador (que é o operador responsável
  --    pelo CIP no registro, um dado do formulário, não da autoria da
  --    edição).
  insert into public.cip_edicoes (
    registro_id, valores_anteriores, valores_novos, justificativa,
    alterado_por_nome, alterado_por_uid
  ) values (
    p_registro_id, v_valores_anteriores, v_valores_novos, p_justificativa,
    btrim(p_alterado_por_nome), v_uid
  );

  return v_registro;
end;
$$;

comment on function editar_registro_cip(uuid, text, date, time, time, text, jsonb, text, text, text) is
  'Edita um registro de CIP e grava o histórico da alteração em uma única transação atômica (tudo ou nada). Único caminho usado pelo frontend para editar um registro já salvo. p_nome_operador é o operador responsável PELO REGISTRO (pode ser corrigido pela edição); p_alterado_por_nome é quem está fazendo ESTA edição agora — os dois são independentes.';

-- Só usuários autenticados podem chamar a função (nunca o papel "anon").
-- IMPORTANTE: "revoke all ... from public" NÃO é suficiente — as default
-- privileges do Supabase concedem EXECUTE diretamente aos papéis anon e
-- authenticated (não através da pseudo-role PUBLIC), então um revoke
-- contra "public" não as alcança. Confirmado em produção (2026-10-28) via
-- advisor de segurança: sem o "revoke ... from anon" explícito abaixo, um
-- usuário NÃO autenticado conseguia chamar esta função pela API REST
-- (/rest/v1/rpc/editar_registro_cip), mesmo sendo SECURITY DEFINER.
revoke all on function editar_registro_cip(uuid, text, date, time, time, text, jsonb, text, text, text) from public;
revoke execute on function editar_registro_cip(uuid, text, date, time, time, text, jsonb, text, text, text) from anon;
grant execute on function editar_registro_cip(uuid, text, date, time, time, text, jsonb, text, text, text) to authenticated;

-- =====================================================================
-- Fim do schema.
--
-- Próximos passos manuais (ver INSTRUCOES.md):
--  1. Criar os usuários no Authentication > Users do Supabase:
--       - 1 usuário para a conta compartilhada dos operadores
--       - 1 usuário para cada administrador
--  2. Para cada usuário criado, inserir a linha correspondente em "perfis":
--       insert into perfis (uid, perfil, nome) values
--         ('<uid-do-usuario>', 'operador', 'Operação CIP');
--       insert into perfis (uid, perfil, nome) values
--         ('<uid-do-admin>', 'administrador', 'Nome do Administrador');
-- =====================================================================
