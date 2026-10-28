# Testes executados e pontos ainda não validados

Este documento lista **exatamente** o que foi testado neste ambiente de
desenvolvimento (sem acesso a um projeto Supabase real nem a uma conta
Netlify real) e o que só pode ser confirmado depois da configuração feita
pelo usuário.

## 0. Histórico das revisões

### 0.1 Edição atômica (registro + histórico)
O frontend fazia a edição em duas chamadas separadas ao banco. Corrigido
com a função `editar_registro_cip(...)`, cujo corpo roda dentro de uma
única transação (tudo ou nada).

### 0.2 Bloqueio do contorno pela API REST
As políticas de RLS ainda permitiam `UPDATE` direto em `cip_registros` e
`INSERT` direto em `cip_edicoes` pela API, contornando a função.
Corrigido: essas políticas foram removidas (não recriadas) e os
privilégios de tabela correspondentes foram revogados das roles da API.
A função passou a `SECURITY DEFINER` para continuar funcionando como o
único caminho de escrita, com validação própria de usuário/perfil.

### 0.3 Esta revisão: `search_path` restritivo e separação de autoria

**a) `search_path` mais restritivo.** `editar_registro_cip` usava
`set search_path = public, pg_temp`. Trocado para `set search_path = ''`
(vazio) — a configuração mais restritiva possível. Com isso, NENHUM
schema é pesquisado implicitamente (só o `pg_catalog`, que o PostgreSQL
sempre inclui, mesmo com o caminho vazio — por isso tipos e funções
nativas como `uuid`, `jsonb`, `now()`, `jsonb_build_object()`, `btrim()`
continuam funcionando sem qualificação). Todo objeto que não é nativo do
PostgreSQL foi qualificado explicitamente com `public.` no corpo da
função: `public.cip_registros` (tabela e tipo de retorno/variável),
`public.cip_edicoes`, `public.auth_role()`, `public.justificativa_valida()`.
A função auxiliar `auth_role()` também foi ajustada (`public.perfis`) já
que ela é chamada de dentro de `editar_registro_cip` e herdaria o
`search_path` vazio durante essa chamada.

**b) Separação da autoria.** O campo `alterado_por_nome` do histórico
recebia automaticamente o mesmo valor de `nome_operador` do formulário —
mas `nome_operador` identifica o responsável pelo CIP **registrado**, e
pode ser corrigido pela própria edição (ex.: um nome digitado errado).
Não é a mesma coisa que "quem fez esta edição agora". Corrigido: a
função ganhou um parâmetro novo, `p_alterado_por_nome`, obrigatório e
independente de `p_nome_operador`; o frontend agora pede explicitamente
"Nome de quem está fazendo esta alteração" na tela de edição. Como a
conta de operador é compartilhada, a documentação e os comentários do
`schema.sql` deixam claro que esse nome é **autodeclarado** (não
verificado por autenticação individual) e que `alterado_por_uid`
identifica apenas a conta usada, não a pessoa.

### 0.4 Esta revisão: leitura restrita, validação completa da RPC e campos de auditoria protegidos

**a) Políticas de leitura (`SELECT`).** As políticas de `cip_registros`,
`cip_edicoes` e `cip_observacoes` verificavam apenas
`auth.role() = 'authenticated'` — ou seja, bastava estar logado (com
qualquer conta) para consultar tudo, mesmo sem uma linha em `perfis`.
Corrigido: as três passaram a usar `auth_role() in ('operador',
'administrador')`. Como `auth_role()` lê de `public.perfis`, um usuário
autenticado sem linha correspondente recebe `NULL` de `auth_role()`, e
`NULL in (...)` resulta em `NULL` — que a RLS do PostgreSQL trata como
"nega o acesso" (o mesmo comportamento de `false`), sem necessidade de
tratamento especial para `NULL` (diferente do `IS DISTINCT FROM` usado
dentro da função RPC, que é uma comparação negada e por isso exige esse
cuidado).

**b) Validação completa dos campos obrigatórios na RPC.** A função
`editar_registro_cip` já validava equipamento, data e nome do operador,
mas **não** validava `p_hora_inicial` nem `p_hora_final` — campos que a
interface já trata como obrigatórios (o primeiro sempre; o segundo em 3
dos 4 tipos de CIP, exceto "Tanque de Levedura"). Como a função pode ser
chamada diretamente (sem passar pela validação em JavaScript da tela),
isso permitia salvar uma edição sem hora inicial, por exemplo. Corrigido:
a função agora rejeita `p_hora_inicial` nulo sempre, e rejeita
`p_hora_final` nulo quando `v_registro.tipo_cip <> 'tanque_levedura'`
(usando o tipo já lido do próprio banco, não um valor enviado pelo
cliente).

**c) Campos de auditoria protegidos na criação.** O frontend fazia um
`INSERT` direto em `cip_registros` ao criar um novo CIP, enviando
`criado_por` e `atualizado_por` com o `uid` da sessão atual — mas nada
no banco impedia que esses valores (e `criado_em`/`atualizado_em`)
fossem manipulados antes do envio, atribuindo a criação do registro a
outra conta ou informando uma data falsa. Corrigido: um gatilho
(`trigger`) `BEFORE INSERT` em `cip_registros`
(`cip_registros_set_auditoria_insert`) agora sobrescreve essas 4
colunas sempre com `now()` e `auth.uid()` lidos no servidor, **antes**
de a linha ser gravada — qualquer valor enviado pelo cliente nessas
colunas é descartado. O frontend (`registro.js`) foi ajustado para não
enviar mais esses campos na criação (deixando de buscar o `uid` da
sessão só para esse fim).

### 0.5 Depuração do login contra o projeto Supabase real do usuário

Esta revisão não é de segurança, mas de **compatibilidade e diagnóstico**:
o usuário reportou "E-mail ou senha inválidos" ao tentar logar, com o
Console do navegador mostrando `{"message":"No API key found in
request", ...}` — um sintoma completamente diferente do que a mensagem
exibida sugeria.

**a) Causa raiz nº 1 — mensagem de erro genérica.** Em `index.html`, o
código mostrava sempre "E-mail ou senha inválidos" para **qualquer**
erro de login, inclusive erros que não têm nada a ver com senha errada
(configuração ausente, falha de rede, permissão negada). Corrigido: uma
função nova, `classificarErroSupabase()` (em `auth.js`), identifica o
tipo real do erro (configuração/"no API key", conexão, credenciais,
permissão, limite de tentativas, ou desconhecido) e mostra uma mensagem
específica para cada um — inclusive com o detalhe técnico quando o tipo
não é reconhecido, em vez de inventar uma causa. A mesma função também
passou a ser usada em `exigirSessao()` (consulta do perfil após login),
para não confundir "perfil realmente ausente" com qualquer outro erro
na consulta.

**b) Causa raiz nº 2 — nomes de coluna incompatíveis.** O usuário
confirmou que a tabela `public.perfis` **já existente** no projeto
Supabase real usa as colunas `uid`, `nome` e `perfil` — não `id`, `nome`
e `role`, que é o que `auth.js` consultava (e o que o `schema.sql` deste
pacote cria, caso rode do zero). Corrigido no frontend: `auth.js` agora
consulta `select("uid, perfil, nome")` / `eq("uid", ...)`, e todos os
lugares que liam `perfil.role` (`painel.html`, `registro.js`,
`historico.js`) foram ajustados para `perfil.perfil`.

> **Importante — isto NÃO foi uma mudança no banco de dados.** Nenhuma
> tabela, política de RLS ou função SQL foi alterada ou recriada nesta
> revisão — só o código do site (frontend) foi ajustado para ler as
> colunas que o usuário confirmou que já existem. Veja a seção 4 deste
> documento sobre uma inconsistência que PODE exigir uma decisão do
> usuário sobre o banco (fora do escopo desta correção, por exigir
> autorização prévia).

**c) Chave pública (anon key) ainda pendente.** O usuário informou a
URL do projeto (`https://ljxzulemauygqfonoume.supabase.co`), já
preenchida em `public/js/config.js`, mas disse que a anon key seria
enviada separadamente. Ela **continua como placeholder** — o site
mostra a tela "Configuração pendente" até que o valor real seja
colado ali, exatamente para evitar reproduzir o erro "No API key found
in request" enquanto a chave não estiver configurada.

### 0.6 Chave publishable real, segunda tentativa de nome de coluna rejeitada, e leitura adaptativa do perfil

O usuário forneceu a chave pública real — do tipo **publishable**
(`sb_publishable_...`), o formato novo do Supabase que substitui a
antiga "anon key" (um JWT) — e relatou que, depois da correção da
revisão anterior (que passou a consultar as colunas `uid`/`perfil`,
conforme ele próprio havia descrito), o Supabase retornou um erro
**real do banco**: `column perfis.uid does not exist`. Ou seja: a
segunda tentativa de nome de coluna também estava errada — nem
`id`/`role` (hipótese original do `schema.sql`) nem `uid`/`perfil`
(descrição anterior do usuário) estão confirmados como corretos.

**a) Chave e versão do `supabase-js`.** `public/js/config.js` foi
preenchido com a URL e a chave publishable reais. Como o formato de
chave é mais novo do que a versão do `supabase-js` carregada por CDN
neste pacote (`2.45.4`), pesquisei a documentação oficial do Supabase:
a chave publishable "funciona da mesma forma" que a anon key antiga em
`createClient(url, chave)`, mas por cautela — já que a versão antiga
foi lançada antes desse novo formato existir — a versão do CDN em
todos os 4 arquivos HTML foi atualizada para `2.118.0` (a versão mais
recente confirmada nos registros oficiais do pacote, cujos próprios
exemplos de uso já mostram uma chave publishable). Fontes consultadas:
[Migrating to publishable and secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys),
[supabase-js@2.118.0 (jsr.io)](https://jsr.io/@supabase/supabase-js@2.118.0).

**b) Sem uma terceira adivinhação de coluna.** Em vez de arriscar mais
um nome (o que já falhou duas vezes), `auth.js` foi reescrito para não
depender de saber o nome da coluna de id nem o nome da coluna de papel/
perfil:
- A consulta passou a ser `supabaseClient.from("perfis").select("*")`,
  **sem** `.eq()` em nenhuma coluna — ela conta com a política de RLS
  "cada usuário só lê o próprio perfil" (que já deveria existir) para
  devolver só a linha certa, em vez do frontend tentar filtrar por um
  nome de coluna que pode estar errado.
- Uma função nova, `normalizarPerfil(linha)`, recebe a linha crua
  (com os nomes de coluna que ela realmente tiver) e descobre, **pelo
  valor** de cada campo (procurando o texto `"operador"` ou
  `"administrador"`), qual é o campo de papel — sem precisar saber o
  nome dele de antemão. O campo `nome` é usado se existir; senão, usa
  o primeiro outro campo de texto que não pareça um UUID.
- `exigirSessao()` agora diferencia explicitamente: erro real do banco
  (mostra a classificação de `classificarErroSupabase()`, incluindo a
  nova categoria "esquema incompatível" — ver item c), zero linhas
  (perfil ausente OU bloqueado pela RLS), mais de uma linha (RLS não
  está filtrando como deveria — avisa em vez de aceitar o perfil
  errado), e "nenhum campo parece um papel válido" (avisa com a lista
  de colunas reais encontradas, para ajudar a confirmar o esquema).

**c) Nova categoria de erro: "perfil incompatível" / coluna
inexistente.** `classificarErroSupabase()` ganhou uma verificação para
mensagens como `"column ... does not exist"` / `"relation ... does not
exist"` (e os códigos PostgreSQL `42703`/`42P01`), classificando-as
como tipo `"esquema"` — distinto de credenciais, conexão, configuração
e permissão, exatamente como pedido.

**d) Por que isso não é uma solução definitiva.** Esta é uma medida
defensiva para o sistema funcionar (e continuar seguro — nenhuma
verificação foi desativada) enquanto não temos a confirmação exata do
esquema. A forma correta e definitiva ainda depende do usuário rodar a
consulta de leitura da seção 4 e informar o resultado — só então vale
simplificar `auth.js` para usar os nomes de coluna certos diretamente,
em vez da descoberta por valor.

## 1. O que foi testado de verdade

### 1.1 Sintaxe do código
Todos os arquivos `.js` do site foram revalidados com `node --check`
após as mudanças desta revisão em `registro.js` (remoção do envio de
`criado_por`/`atualizado_por` na criação) — sem erros.

### 1.2 Compilação do schema no PostgreSQL (`search_path = ''`, novo gatilho, novas políticas)
O `schema.sql` completo foi executado do zero num PostgreSQL 16 local
(ambiente com simulação do `auth` do Supabase e dos privilégios padrão
que o Supabase concede a tabelas novas), incluindo as três políticas de
`SELECT` revisadas, a função `editar_registro_cip` com as novas
validações de `hora_inicial`/`hora_final`, e o novo gatilho
`cip_registros_set_auditoria_insert` (também com `security invoker` e
`set search_path = ''`) — **tudo compilou sem erros**, confirmando que
todos os objetos referenciados estão corretamente qualificados e que a
sintaxe de todas as novas políticas/função/gatilho é válida.

### 1.3 Testes funcionais (RLS, RPC, atomicidade e autoria) — revisões 2 a 4

| # | Cenário testado | Resultado |
|---|---|---|
| — | Criação normal de um registro de CIP pelo operador | ✅ Continua funcionando |
| **1** | **`UPDATE` direto em `cip_registros` pela API** (operador e administrador) | ✅ Bloqueado — `permission denied`; registro conferido depois, inalterado |
| **2** | **`INSERT` direto em `cip_edicoes`** (contornando a RPC) | ✅ Bloqueado — `permission denied`; histórico continua em 0 linhas |
| **3** | **`editar_registro_cip` chamada com `search_path=''`**, alterando `nome_operador` para "João Pedro" e informando `p_alterado_por_nome = "Maria Edição"` (pessoa diferente) | ✅ Sucesso: a função compilou e executou corretamente mesmo com o `search_path` vazio; `cip_registros.nome_operador` ficou "João Pedro"; `cip_edicoes.alterado_por_nome` ficou **"Maria Edição"**, não "João Pedro" — confirma que os dois campos são realmente independentes |
| **3b** | `editar_registro_cip` sem informar quem está editando (vazio e `NULL`) | ✅ Rejeitada nos dois casos ("Informe o nome de quem está fazendo esta alteração") |
| **4** | Justificativas inválidas (ex.: "erro") | ✅ Registro consultado depois continua inalterado; histórico não ganha linha nova |
| **5** | `editar_registro_cip` chamada por administrador e por usuário sem perfil | ✅ Bloqueada nos dois casos; histórico permanece com 1 linha (a do teste 3) |
| **6** | Administrador insere observação; operador tenta inserir observação | ✅ Admin consegue; operador continua bloqueado |
| — | `DELETE` em `cip_registros` e `cip_edicoes` | ✅ Continua bloqueado (0 linhas afetadas) |

Todos os cenários se comportaram exatamente como esperado, incluindo a
prova concreta de que `nome_operador` (responsável pelo CIP) e
`alterado_por_nome` (quem fez a edição) ficam gravados de forma
independente.

### 1.4 Testes funcionais desta revisão (leitura restrita, validação da RPC, auditoria)

Banco de teste recriado do zero (harness + `schema.sql` atualizado,
sem erros de compilação) e testado com um novo script cobrindo
exatamente os 6 pontos pedidos pelo usuário:

| # | Cenário testado | Resultado |
|---|---|---|
| **A** | Criação normal de registro pelo operador, **tentando** forçar `criado_por`/`atualizado_por` = uid do administrador e `criado_em`/`atualizado_em` = ano 2000 no próprio `INSERT` | ✅ O gatilho sobrescreveu tudo: `criado_por` e `atualizado_por` ficaram com o uid real do operador autenticado, e `criado_em`/`atualizado_em` ficaram com a data/hora real do servidor — nenhum valor enviado pelo cliente foi aceito |
| **B** | `UPDATE` direto em `cip_registros` pela API (reforço da revisão anterior) | ✅ Continua bloqueado — `permission denied` |
| **C** | `INSERT` direto em `cip_edicoes` pela API (reforço) | ✅ Continua bloqueado — `permission denied`; histórico em 0 linhas |
| **D** | `editar_registro_cip` chamada **sem** `p_hora_inicial` (`null`) | ✅ Rejeitada: "Informe a hora inicial."; registro consultado depois permanece com os valores originais; histórico continua em 0 linhas |
| **E** | `editar_registro_cip` chamada **sem** `p_hora_final`, para um registro do tipo `completo` (que exige hora final) | ✅ Rejeitada: "Informe a hora final."; nada foi alterado |
| **F** | `editar_registro_cip` chamada com todos os campos obrigatórios preenchidos (incluindo hora inicial e final) | ✅ Sucesso normal — confirma que a nova validação não bloqueia o caso correto |
| **G** | `editar_registro_cip` chamada **sem** `p_hora_final`, para um registro do tipo `tanque_levedura` (que **não** tem esse campo no formulário original) | ✅ Sucesso — confirma que a exigência de hora final é condicional ao tipo de CIP, e não quebrou o tipo que nunca teve esse campo |
| **H** | Justificativa inválida (ex.: "erro") | ✅ Continua rejeitada; nada alterado |
| **I** | `editar_registro_cip` chamada por administrador e por usuário sem perfil | ✅ Continua bloqueada nos dois casos ("Apenas o perfil operador pode editar...") |
| **J** | **Leitura (`SELECT`)** de `cip_registros`, `cip_edicoes` e `cip_observacoes` por: operador com perfil, administrador com perfil, e usuário autenticado **sem** linha em `perfis` | ✅ Operador e administrador consultam normalmente; o usuário sem perfil recebe **0 linhas** nas três tabelas (sem erro — é assim que a RLS nega leitura: filtrando todas as linhas, não lançando exceção) |
| **K** | Administrador insere observação; operador tenta inserir observação | ✅ Admin consegue; operador continua bloqueado pela RLS |
| — | `DELETE` em `cip_registros`/`cip_edicoes` (reforço) | ✅ Continua bloqueado (0 linhas afetadas) |

Todos os cenários se comportaram exatamente como esperado, numa única
execução limpa do script de teste (sem erros inesperados — apenas os 8
bloqueios/rejeições intencionais previstos no roteiro).

> Os scripts de teste usados (que simulam o `auth` do Supabase e os
> privilégios padrão do Supabase) **não** fazem parte do pacote
> entregue — rodá-los num projeto Supabase real poderia interferir na
> autenticação real. O `supabase/schema.sql` entregue é exatamente o
> mesmo que foi testado, sem essa simulação.

### 1.5 Formulários e visual
Não foram alterados nesta revisão. Os 4 formulários continuam extraídos
célula a célula dos `.xlsx` originais (ver `public/js/formConfig.js` e
`public/js/equipamentos.js`), e as telas (`registro.html` e as demais)
não tiveram nenhuma mudança visual nesta revisão — as três correções
desta rodada são inteiramente do lado do banco (`schema.sql`) e de um
ajuste interno em `registro.js` (parar de enviar campos que agora são
controlados pelo servidor), sem nenhum campo novo na tela.

### 1.6 Testes desta revisão de depuração (login/perfil)

| # | Verificação | Resultado |
|---|---|---|
| — | `node --check` em todos os `.js` após as mudanças em `auth.js`, `registro.js`, `historico.js` | ✅ Sem erros de sintaxe |
| — | Leitura de todo o pacote anexado pelo usuário e `diff` contra a última versão entregue | ✅ Confirmado: é exatamente o pacote da revisão anterior (nenhuma edição própria do usuário no ZIP) |
| — | Revisão manual de cada `.html`: ordem dos `<script>` (CDN → `config.js` → `supabaseClient.js` → `auth.js` → demais) | ✅ Já estava correta em todas as páginas; não era a causa do problema |
| — | Busca por todas as ocorrências de `.role`, `perfil.id`, `eq("id", session.user.id)` no frontend | ✅ Encontradas e corrigidas em `auth.js`, `painel.html`, `registro.js`, `historico.js` (nenhuma ocorrência restante) |
| — | Revisão da lógica de `classificarErroSupabase()` contra os formatos de erro conhecidos do Supabase Auth/PostgREST (mensagens e códigos de status) | ✅ Revisado manualmente; sem um projeto Supabase real para disparar cada erro de verdade, não há como confirmar o texto exato de cada resposta de erro — ver seção 2 |

### 1.7 Formulários e visual (revisão de depuração)
Não foram alterados. As únicas mudanças desta rodada são: `auth.js`
(lógica de perfil/erro), `index.html` (uso da nova classificação de
erro), `painel.html`/`registro.js`/`historico.js` (nome do campo de
perfil) e `public/js/config.js` (URL preenchida). Nenhum HTML de
formulário, nenhum CSS e nenhum campo dos 4 formulários de CIP foi
tocado.

### 1.8 Testes de lógica desta revisão (chave publishable, esquema incompatível, leitura adaptativa)

Além do `node --check` (sem erros em nenhum `.js`, incluindo o
`auth.js` reescrito), executei um script de teste isolado (Node.js,
usando o módulo `vm` para carregar `auth.js` real e chamar suas
funções diretamente — sem simular o Supabase, só a lógica em
JavaScript) cobrindo os formatos de erro e de linha mais relevantes:

| # | Cenário testado | Resultado |
|---|---|---|
| 1 | `classificarErroSupabase({message:"No API key found in request"})` | ✅ `tipo: "configuracao"` |
| 2 | `classificarErroSupabase({message:"column perfis.uid does not exist", code:"42703"})` | ✅ `tipo: "esquema"` (categoria nova) |
| 3 | `classificarErroSupabase({message:"relation \"perfis\" does not exist", code:"42P01"})` | ✅ `tipo: "esquema"` |
| 4 | `classificarErroSupabase({message:"Invalid login credentials", status:400})` | ✅ `tipo: "credenciais"` |
| 5 | `classificarErroSupabase(new TypeError("Failed to fetch"))` | ✅ `tipo: "conexao"` |
| 6 | `classificarErroSupabase({message:"permission denied...", status:403})` | ✅ `tipo: "permissao"` |
| 7 | `classificarErroSupabase({message:"Too many requests", status:429})` | ✅ `tipo: "limite"` |
| 8 | `classificarErroSupabase({message:"algo bizarro e nunca visto"})` | ✅ `tipo: "desconhecido"`, preserva o detalhe técnico na mensagem |
| 9 | `classificarErroSupabase(null)` | ✅ retorna `null` (sem erro, não deveria classificar nada) |
| 10 | `normalizarPerfil({uid:"...", perfil:"operador", nome:"Operação CIP"})` (hipótese 2, já rejeitada pelo banco) | ✅ `{perfil:"operador", nome:"Operação CIP"}` |
| 11 | `normalizarPerfil({id:"...", role:"administrador", nome:"Admin"})` (hipótese 1, nunca confirmada) | ✅ `{perfil:"administrador", nome:"Admin"}` |
| 12 | `normalizarPerfil({user_id:"...", funcao:" Operador ", nome_completo:"João"})` (esquema **totalmente diferente** das duas hipóteses) | ✅ `{perfil:"operador", nome:"João"}` — confirma que a leitura adaptativa funciona mesmo com nomes nunca tentados antes |
| 13 | `normalizarPerfil({id:"...", algumacoisa:"não é um papel válido"})` | ✅ retorna `null` (não inventa um papel quando não encontra um valor reconhecível) |
| 14 | `normalizarPerfil(null)` | ✅ retorna `null`, não lança exceção |

Todos os 14 casos passaram. Isso confirma a lógica em JavaScript, mas
**não substitui** o teste contra o Supabase real — só ele confirma se
a política de RLS de `perfis` realmente limita a leitura a uma linha,
e qual é o formato exato de cada erro que o Supabase devolve (ver
seção 2).

## 2. O que NÃO foi possível testar neste ambiente (e por quê)

- **Login real e chamada real da função pelo navegador contra um
  projeto Supabase real:** este ambiente não tem acesso a um projeto
  Supabase nem a uma conta Netlify reais. A lógica foi testada de ponta
  a ponta diretamente no PostgreSQL (seções 1.3 e 1.4).
- **Mensagem exibida na tela quando a RPC rejeita a falta de hora
  inicial/final:** o banco rejeita corretamente (teste D/E da seção
  1.4), mas a forma como essa mensagem de erro aparece para o operador
  na tela de edição depende do tratamento de erro do navegador contra
  um Supabase real — recomenda-se confirmar visualmente após a
  configuração.
- **Se o SQL Editor do Supabase cria a função com o mesmo dono das
  tabelas:** a segurança do `SECURITY DEFINER` depende disso. É o
  comportamento padrão ao rodar o `schema.sql` inteiro de uma vez no SQL
  Editor — mas recomenda-se confirmar, após rodar o script, que a edição
  funciona para o operador (checklist da seção 3).
- **Carregamento da biblioteca `supabase-js` pelo CDN:** o acesso de
  rede deste ambiente não inclui CDNs públicos de JavaScript.
- **Concorrência real, diferentes navegadores/celulares, volume real de
  dados:** não testado.
- **Login real das duas contas já existentes
  (`administracao@heiway.net` e `filtracao2026@heiway.net`) contra o
  projeto Supabase real do usuário:** agora a chave publishable real
  foi informada e preenchida em `config.js`, mas este ambiente ainda
  não alcança o Supabase real nem o CDN do `supabase-js` (ver
  verificação de rede na seção 1), então o login **não pôde ser
  testado de ponta a ponta**. **Não declaro o login como validado.**
- **Os nomes reais das colunas de `public.perfis`:** ainda **não**
  confirmados. Duas hipóteses já foram tentadas e pelo menos a segunda
  está confirmadamente errada (`uid` não existe, erro real do banco). A
  correção desta revisão (seção 0.6) não depende mais de acertar esse
  nome — lê a linha inteira e descobre o campo certo pelo valor — mas
  isso é um reforço, não a confirmação. Ver seção 4 para a consulta que
  resolve isso definitivamente.
- **Se as tabelas `cip_registros`, `cip_edicoes`, `cip_observacoes`, a
  função `editar_registro_cip` e o gatilho de auditoria já existem no
  projeto Supabase real do usuário, e em que forma:** ainda não
  sabemos — ver seção 4.
- **Se a política de RLS "cada usuário só lê o próprio perfil" existe
  e funciona de verdade no projeto real:** a nova leitura adaptativa em
  `auth.js` depende disso para devolver só a linha do usuário correto;
  sem um Supabase real para testar, não há como confirmar — se a
  política não existir ou não filtrar corretamente, o próprio código
  detecta isso (mais de uma linha) e avisa, em vez de aceitar
  silenciosamente um perfil errado, mas isso também não foi exercido
  contra um banco real.

## 3. Checklist de verificação recomendado após a configuração

- [ ] Confirmar que `public/js/config.js` já tem a URL e a chave
      publishable reais preenchidas (já foram, nesta revisão) e que o
      site não mostra mais a tela "Configuração pendente".
- [ ] Rodar a consulta da seção 4 no SQL Editor e confirmar os nomes
      reais das colunas de `perfis` (mesmo que o login já funcione com
      a leitura adaptativa, vale simplificar o código depois).
- [ ] Login do operador (`filtracao2026@heiway.net`) e do administrador
      (`administracao@heiway.net`) funcionam e mostram as telas
      corretas para cada perfil.
- [ ] Criar um registro de cada um dos 4 tipos de CIP.
- [ ] Editar um registro pela tela do site: confirmar que agora o
      sistema pede o "Nome de quem está fazendo esta alteração" **além**
      da justificativa, e que rejeita os dois campos vazios.
- [ ] Editar um registro preenchendo um nome diferente em "Operador" e
      em "Nome de quem está fazendo esta alteração" — abrir o histórico
      depois e confirmar que os dois nomes aparecem corretos e
      distintos.
- [ ] Confirmar que a edição pela tela funciona de ponta a ponta (chama
      a função RPC com sucesso); se der erro de permissão, confira se o
      `schema.sql` foi executado por completo, de uma vez só.
- [ ] Tentar salvar uma edição sem preencher a Hora Inicial: o site deve
      impedir (validação em JavaScript) e, mesmo que isso falhasse, o
      banco também rejeitaria.
- [ ] Criar um usuário de teste em Authentication **sem** cadastrar a
      linha correspondente em `perfis` e confirmar que, ao logar, ele
      não consegue ver nenhum registro/histórico/observação (mensagem
      de "Perfil não configurado" e nenhum dado na tela).
- [ ] Como administrador, adicionar uma observação em um registro.
- [ ] Filtrar o histórico por data, operador, equipamento e tipo de CIP.
- [ ] Fechar o navegador, abrir em outro computador e confirmar que os
      registros continuam lá.

## 4. Pergunta aberta sobre o banco — decisão do usuário antes de qualquer mudança no Supabase

O `schema.sql` deste pacote cria a tabela `perfis` com as colunas `id`,
`role` e `nome`, e toda a parte de segurança do banco (políticas de
RLS, a função `auth_role()`, a função `editar_registro_cip`) depende
dessas colunas existirem com esses nomes.

Já tentamos duas hipóteses para os nomes reais: primeiro `id`/`role`
(o padrão do `schema.sql`), depois `uid`/`perfil` (como o usuário
descreveu de memória). A segunda gerou um erro real e confirmado do
próprio Postgres: `column perfis.uid does not exist`. Ou seja, **nem
uma nem a outra está confirmada como correta** — por isso esta revisão
passou a ler o perfil sem depender de acertar esses nomes (seção 0.6),
em vez de arriscar um terceiro palpite.

Isso **não impede mais o login** (a leitura adaptativa cobre isso).
Mas se, além do login, o usuário também espera que o restante do
`schema.sql` (tabelas `cip_registros`/`cip_edicoes`/`cip_observacoes`,
a função `editar_registro_cip`, o gatilho de auditoria, as políticas de
RLS) já esteja funcionando no projeto real — ou se simplesmente quiser
que o código volte a usar nomes de coluna diretos (mais simples e
fáceis de ler do que a descoberta por valor) — é necessário primeiro
confirmar o que já existe lá. **Nada no banco foi ou será alterado sem
essa confirmação e sua autorização explícita**, conforme pedido.

Para eu poder responder com segurança (em vez de supor), peço que
rode esta consulta — **só leitura, não altera nada** — no SQL Editor
do seu projeto Supabase e me envie o resultado:

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('perfis', 'cip_registros', 'cip_edicoes', 'cip_observacoes')
order by table_name, ordinal_position;

select routine_name
from information_schema.routines
where routine_schema = 'public';

select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public';
```

Com esse resultado eu digo exatamente se o `schema.sql` deste pacote
pode ser rodado como está, se precisa de ajuste nos nomes de coluna, ou
se o restante do sistema (registro de CIP, histórico, observações) já
existe e só precisava da correção de login feita agora. Qualquer
alteração no banco (criar, renomear coluna, recriar política/função)
só será proposta depois disso, explicada separadamente, e só executada
com sua autorização explícita.
