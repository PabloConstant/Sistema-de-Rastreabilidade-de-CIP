# Sistema de Rastreabilidade de CIP

Site para registrar e consultar os CIPs (Cleaning in Place) realizados em
uma fábrica de cerveja, com histórico de alterações e observações
administrativas.

## Estrutura do projeto

```
sistema-cip/
├── public/                  ← é isto que vai para o Netlify
│   ├── index.html            (login)
│   ├── painel.html            (painel inicial, por perfil)
│   ├── registro.html          (novo registro / edição de um CIP)
│   ├── historico.html         (consulta, filtros, edições, observações)
│   ├── css/style.css
│   └── js/
│       ├── config.js          ← preencher com a URL e a anon key do seu Supabase
│       ├── supabaseClient.js
│       ├── auth.js
│       ├── equipamentos.js    (lista de tanques/linhas — extraída dos anexos originais)
│       ├── formConfig.js      (campos dos 4 formulários — extraídos dos anexos originais)
│       ├── validarJustificativa.js
│       ├── registro.js
│       └── historico.js
├── supabase/
│   └── schema.sql             (rode isto no SQL Editor do seu projeto Supabase)
├── netlify.toml
├── INSTRUCOES.md              (passo a passo de configuração, em português)
├── TESTES.md                  (o que foi testado e o que falta validar)
└── README.md
```

## Tecnologia

- **Frontend:** HTML, CSS e JavaScript puro (sem framework, sem build,
  sem dependências locais). O cliente Supabase é carregado por CDN.
- **Banco de dados e autenticação:** Supabase (Postgres + Auth), em um
  projeto Supabase **dedicado e separado** do painel FTR.
- **Publicação:** Netlify (diretório `public/`), plano gratuito.

## Edição de registros (atômica e sem contorno pela API)

Editar um registro de CIP já salvo só é possível através da função
`editar_registro_cip(...)`, definida em `supabase/schema.sql` e chamada
pelo frontend via `supabaseClient.rpc(...)` (em `public/js/registro.js`).
Essa função atualiza o registro **e** grava a linha de histórico dentro
da mesma transação no banco: se a justificativa for inválida, se o
usuário não for operador, ou se qualquer outra validação falhar, nada é
alterado — nem o registro, nem o histórico.

Isso não é garantido só pela interface: as tabelas `cip_registros`
(UPDATE) e `cip_edicoes` (INSERT) não têm política de RLS nem privilégio
de tabela que permita essas operações por fora da função — nem para o
operador, nem para o administrador. Quem tenta um `UPDATE` ou `INSERT`
direto pela API REST do Supabase recebe um erro de permissão. A função
roda como `SECURITY DEFINER`, com `search_path` vazio (`''`) e todos os
objetos qualificados explicitamente (`public.cip_registros`,
`public.auth_role()` etc.) para evitar o ataque de "search_path
hijacking", e com validação explícita de usuário/perfil dentro dela —
exatamente para ser o único caminho autorizado a fazer essas duas
escritas.

### Autoria do histórico: operador do registro ≠ quem editou

O campo "Operador" de um registro (`nome_operador`) identifica quem é o
responsável pelo CIP **registrado**, e pode ser corrigido pela própria
edição (ex.: um nome digitado errado). Isso é diferente de "quem fez
esta edição agora" — por isso a tela de edição pede, separadamente, o
"Nome de quem está fazendo esta alteração", gravado em
`cip_edicoes.alterado_por_nome`. Como a conta de operador é **única e
compartilhada**, esse nome é autodeclarado (não verificado por
autenticação individual); o sistema não afirma identificar a pessoa
exata por meio do login.

### Leitura restrita a quem tem perfil cadastrado

As políticas de `SELECT` de `cip_registros`, `cip_edicoes` e
`cip_observacoes` exigem que o usuário autenticado tenha uma linha em
`perfis` com `role` igual a `operador` ou `administrador`. Um usuário
que só tem conta de login (`auth.users`), sem essa linha, não consegue
consultar nada pela API — nem pela tela do site, nem tentando a API
diretamente.

### Validação de campos obrigatórios também no banco

A função `editar_registro_cip` não depende apenas da validação feita em
JavaScript na tela: ela confere, no próprio banco, que o equipamento, a
data, o nome do operador e a **hora inicial** foram informados, e que a
**hora final** foi informada nos 3 tipos de CIP em que o formulário
original a exige (todos, exceto "Tanque de Levedura"). Isso impede que
alguém chamando a função diretamente (por fora da tela) contorne essas
exigências.

### Campos de auditoria definidos pelo banco, não pelo navegador

Ao criar um novo registro, os campos `criado_por`, `atualizado_por`,
`criado_em` e `atualizado_em` são preenchidos por um gatilho (`trigger`)
no próprio banco, a partir de `auth.uid()` e `now()` do lado do
servidor — qualquer valor que o navegador envie para essas colunas é
ignorado. Isso impede que alguém, manipulando a chamada à API,
atribua a criação de um registro a outra conta ou informe uma data de
criação falsa.

## Login e diagnóstico de erros

A tela de login (`index.html`) e a verificação de perfil
(`exigirSessao()`, em `public/js/auth.js`) usam uma função,
`classificarErroSupabase()`, que diferencia o tipo real de um erro do
Supabase antes de mostrar uma mensagem — configuração ausente/errada
(ex.: "No API key found in request"), falha de conexão, permissão
negada, credenciais erradas de fato, ou **perfil incompatível com o
esquema** (ex.: "column ... does not exist") — em vez de mostrar
sempre "E-mail ou senha inválidos" para qualquer problema.

### Leitura do perfil sem depender dos nomes exatos das colunas

Duas tentativas anteriores de descobrir os nomes reais das colunas da
tabela `public.perfis` do projeto em produção (primeiro `id`/`role`,
depois `uid`/`perfil`) já se mostraram erradas — a segunda chegou a
gerar o erro real `column perfis.uid does not exist`. Por isso
`auth.js` não arrisca um terceiro nome: ele busca a linha do perfil com
`select("*")` (sem indicar colunas, sem filtrar por uma coluna de id
que pode não existir) contando com a política de RLS "cada usuário só
lê o próprio perfil" para devolver a linha certa, e uma função,
`normalizarPerfil()`, descobre **pelo valor** (`"operador"` ou
`"administrador"`) qual campo é o papel, usando outro campo de texto
como nome.

Isso é um reforço para o sistema funcionar enquanto os nomes reais não
são confirmados — não uma solução definitiva. O `schema.sql` deste
pacote continua assumindo `id`/`role`/`nome` caso você recrie o banco
do zero; se usar um banco já existente com nomes diferentes, confirme-os
com a consulta da seção 4 de `TESTES.md`.

### Chave pública: anon key ou publishable key

`public/js/config.js` aceita tanto a chave antiga ("anon public", um
JWT) quanto a nova chave **publishable** (`sb_publishable_...`) — as
duas têm os mesmos privilégios baixos e são inicializadas da mesma
forma (`createClient(url, chave)`). O `supabase-js` carregado por CDN
em todos os HTMLs foi atualizado para a versão `2.118.0` para ter
suporte confirmado ao novo formato de chave.

## Formulários preservados

Os 4 formulários foram implementados preservando os campos e a ordem dos
documentos originais fornecidos, sem inventar unidades, limites ou campos
novos:

1. CIP Alcalino Clorado — TFM/HORAP/Trasfega (PO-JAC-FAB-004, Anexo 2)
2. CIP Completo — TFM/HORAP/Trasfega (PO-JAC-FAB-004, Anexo 3)
3. CIP Tanque de Levedura (PO-JAC-FAB-032, Anexo 2)
4. CIP Linha de Recuperação de Levedura (PO-JAC-FAB-031, Anexo 2)

Veja `public/js/formConfig.js` para a lista completa de campos de cada um.

Comece pela leitura de **INSTRUCOES.md** para configurar o Supabase e
publicar no Netlify.
