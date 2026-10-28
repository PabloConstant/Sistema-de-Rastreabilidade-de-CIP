# Instruções de configuração — Sistema de Rastreabilidade de CIP

Passo a passo para colocar o sistema no ar usando Supabase (banco de dados
e login) e Netlify (site). Nenhuma etapa exige instalação local — tudo é
feito pelo navegador.

> **Projeto Supabase atual (2026-10-28):** o sistema está configurado para
> usar o projeto `https://krscjbdphymgzjteclif.supabase.co` ("Sistema de
> Rastreabilidade de CIP"), exclusivo para este sistema. Este projeto foi
> criado vazio — **sem tabelas, sem usuários** — substituindo um projeto
> anterior (`ljxzulemauygqfonoume`) que não está mais em uso. `public/js/config.js`
> já vem preenchido com a URL e a chave **publishable** deste projeto novo.
> Como ele está vazio, os passos 1 a 5 abaixo se aplicam normalmente (rodar
> `schema.sql` do zero, criar os usuários de login e cadastrar o perfil de
> cada um) — nada é recriado por engano, pois não há nada pré-existente.
>
> **Sobre a tabela `perfis`:** o código deste pacote (`auth.js`) usa os
> nomes reais `uid` (não `id`), `perfil` (não `role`) e `nome` — exatamente
> os nomes criados por `schema.sql`. Não é preciso adivinhar nem adaptar
> nada neste projeto novo.

---

## 1. Criar o projeto Supabase (exclusivo para o CIP)

1. Acesse https://supabase.com e faça login (ou crie uma conta gratuita).
2. Clique em **New Project**.
3. Dê um nome, por exemplo `cip-rastreabilidade` — **não use o mesmo
   projeto do painel FTR**. Isso é importante: o banco do CIP deve ficar
   totalmente separado.
4. Escolha uma senha para o banco (anote em local seguro) e a região mais
   próxima da fábrica.
5. Aguarde o projeto ser criado (leva 1–2 minutos).

## 2. Rodar o script SQL

1. No menu lateral do projeto, abra **SQL Editor**.
2. Clique em **New query**.
3. Abra o arquivo `supabase/schema.sql` deste pacote, copie todo o
   conteúdo e cole no editor.
4. Clique em **Run**. Isso cria as tabelas (`perfis`, `cip_registros`,
   `cip_edicoes`, `cip_observacoes`), os índices, as políticas de
   segurança (RLS), um gatilho (trigger) em `cip_registros` que define
   automaticamente quem criou/alterou um registro e quando (ignorando
   qualquer valor que o navegador tente enviar nesses campos), e a
   função `editar_registro_cip`, usada pelo site para editar um
   registro e gravar o histórico da alteração em uma única operação (se
   uma parte falhar, nada é salvo). Essa função é o **único** caminho
   permitido para editar um registro — nem o operador, nem o
   administrador conseguem alterar um registro ou inserir um histórico
   por fora dela, mesmo chamando a API diretamente.
5. **Importante:** rode o arquivo inteiro de uma vez só, do início ao
   fim, na mesma conexão do SQL Editor. A função `editar_registro_cip`
   precisa pertencer à mesma conta que é dona das tabelas para funcionar
   corretamente — isso acontece automaticamente quando tudo é executado
   junto, como este arquivo já está organizado.
6. Confirme em **Table Editor** que as 4 tabelas foram criadas.

## 3. Pegar a URL e a chave pública do projeto

1. No menu lateral, abra **Project Settings > API**.
2. Copie o valor de **Project URL**.
3. Copie a chave pública: em projetos novos do Supabase ela aparece
   como **"Publishable key"** (formato `sb_publishable_...`); em
   projetos mais antigos pode aparecer como **"anon public"** (um texto
   bem mais longo, formato JWT). As duas funcionam da mesma forma neste
   site — cole a que o seu projeto mostrar.
4. **Nunca** copie a `service_role` key nem a `secret` key para o
   site — essas são secretas, dão acesso total ao banco, e inclusive o
   próprio Supabase rejeita usar a `secret` key a partir do navegador.

## 4. Criar os usuários de login

No menu lateral, abra **Authentication > Users > Add user** e crie:

- **1 usuário para os operadores** (conta única e compartilhada), por
  exemplo:
  - E-mail: `operacao.cip@suaempresa.com`
  - Senha: defina uma senha e compartilhe apenas com a equipe de operação.
- **1 usuário para cada administrador**, com e-mail e senha individuais
  (ex.: `maria.silva@suaempresa.com`).

Marque a opção para já confirmar o e-mail automaticamente (ou confirme
manualmente), para não depender de envio de e-mail.

Depois de criar cada usuário, copie o **UID** dele (aparece na lista de
usuários, coluna "UID" / ao abrir o usuário).

## 5. Cadastrar o perfil (role) de cada usuário

> Este passo só vale para um projeto **novo**, criado com o `schema.sql`
> deste pacote (que usa as colunas `id`/`role`/`nome`). Se você já tem
> um projeto em uso com uma tabela `perfis` própria (como é o caso do
> projeto em `https://ljxzulemauygqfonoume.supabase.co`), confirme
> primeiro os nomes reais das colunas com a consulta da seção 4 de
> `TESTES.md` e ajuste os nomes das colunas no `insert` abaixo de
> acordo — inserir com o nome errado simplesmente dá erro (nada é
> alterado), mas não há razão para adivinhar se a consulta já responde
> isso.

Volte ao **SQL Editor** e, para cada usuário criado, rode um `insert`
como estes (trocando o UID e o nome):

```sql
-- conta compartilhada dos operadores
insert into perfis (uid, perfil, nome) values
  ('COLE-AQUI-O-UID-DO-OPERADOR', 'operador', 'Operação CIP');

-- um administrador
insert into perfis (uid, perfil, nome) values
  ('COLE-AQUI-O-UID-DO-ADMIN', 'administrador', 'Maria Silva');
```

Repita o segundo bloco para cada administrador adicional.

> Sem essa linha em `perfis`, o login funciona mas o sistema mostra a
> mensagem "Perfil não configurado" — e, além disso, esse usuário **não
> consegue consultar nenhum registro, histórico ou observação** pela
> API (mesmo tentando pelo console do navegador ou por fora da tela do
> site): as políticas de leitura exigem um perfil cadastrado como
> `operador` ou `administrador`. Por isso este passo é obrigatório para
> todo usuário criado, sem exceção.

## 6. Preencher a configuração do site

1. Abra `public/js/config.js` neste pacote.
2. Substitua:
   - `SUPABASE_URL` pela **Project URL** copiada no passo 3.
   - `SUPABASE_ANON_KEY` pela **anon public key** copiada no passo 3.
3. Salve o arquivo.

## 7. Publicar no Netlify

**Opção A — arrastar e soltar (mais simples):**

1. Acesse https://app.netlify.com e faça login (ou crie uma conta
   gratuita).
2. Na tela inicial, use a opção de publicar arrastando uma pasta
   ("Deploy manually" / "drag and drop").
3. Arraste a pasta `public/` (a pasta inteira, com `index.html` dentro
   dela) para a área indicada.
4. Em poucos segundos o Netlify gera uma URL pública (ex.:
   `https://nome-aleatorio.netlify.app`).
5. Você pode trocar o nome/subdomínio em **Site settings > Domain
   management**.

**Opção B — conectar a um repositório Git (para atualizações futuras):**

1. Suba este projeto para um repositório (GitHub, GitLab etc.).
2. No Netlify, **Add new site > Import an existing project**.
3. Selecione o repositório.
4. Em **Build settings**, deixe o comando de build vazio e o diretório
   de publicação como `public`. (Isso já está configurado em
   `netlify.toml`.)
5. Clique em **Deploy site**.

## 8. Testar o acesso

1. Abra a URL gerada pelo Netlify.
2. Entre com o e-mail/senha do operador → deve ver o painel com os 4
   formulários e o histórico.
3. Entre com o e-mail/senha de um administrador → deve ver apenas o
   histórico (sem os formulários de novo registro), podendo abrir cada
   registro e adicionar observações.

## 9. Manutenção e custos

- Netlify (plano Free) e Supabase (plano Free) atendem bem o uso inicial
  deste sistema. Não há garantia de custo zero permanente: se o uso
  crescer muito (muitos registros, muitos acessos), pode ser necessário
  avaliar um plano pago no futuro.
- Para adicionar um novo administrador depois: repita os passos 4 e 5
  (criar o usuário em Authentication e inserir a linha em `perfis`).
- Para trocar a senha da conta compartilhada dos operadores: em
  **Authentication > Users**, abra o usuário e use a opção de redefinir
  senha.
