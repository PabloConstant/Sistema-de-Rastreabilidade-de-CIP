# Checklist de verificação manual — Supabase em produção

Este arquivo existe porque, nesta tarefa, o acesso à organização Supabase
real (`ljxzulemauygqfonoume.supabase.co`) ainda não foi concedido a esta
sessão. Sem esse acesso, não é possível confirmar via consulta direta se o
que está descrito em `supabase/schema.sql` (a referência local, já corrigida
para os nomes reais de coluna `uid`/`perfil`/`nome`) corresponde exatamente
ao que está em produção. **Não altere nada no banco de produção a partir
deste arquivo — ele é só um roteiro de consulta/leitura para você confirmar
manualmente no SQL Editor ou no Table Editor do Supabase.**

Rode cada consulta abaixo (todas são somente leitura) e compare o resultado
com o "esperado". Se algo não corresponder, **não corrija direto em
produção sem decidir antes o que fazer** — me diga o que encontrou e eu
ajusto o código do site para corresponder, em vez de sugerir mudar o banco.

## 1. Colunas da tabela `perfis`

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'perfis'
order by ordinal_position;
```

**Esperado:** `uid` (uuid), `perfil` (text), `nome` (text), `criado_em`
(timestamptz) — é isso que `auth.js` e `schema.sql` já assumem agora.

## 2. As duas contas existentes têm perfil cadastrado

```sql
select uid, perfil, nome from public.perfis;
```

**Esperado:** pelo menos as linhas para `administracao@heiway.net`
(perfil `administrador`) e `filtracao2026@heiway.net` (perfil `operador`,
nome "Operação CIP"). Se alguma estiver ausente, o login dessa conta vai
cair na tela "Perfil não configurado" — não é bug do site, é dado faltando.

## 3. RLS está habilitado nas 4 tabelas

```sql
select relname, relrowsecurity
from pg_class
where relname in ('perfis', 'cip_registros', 'cip_edicoes', 'cip_observacoes');
```

**Esperado:** `relrowsecurity = true` nas 4 linhas.

## 4. Políticas RLS existentes (compare com o esperado abaixo)

```sql
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, cmd;
```

**Esperado, por tabela:**

- **`perfis`**: só uma política, de `SELECT`, usando `auth.uid() = uid`.
  **Não deve existir** política de `INSERT`/`UPDATE`/`DELETE` — perfil é
  gerido só pelo SQL Editor/admin do projeto, nunca pelo frontend (evita
  que um usuário se autopromova a administrador).
- **`cip_registros`**: uma política de `SELECT` (exige perfil
  operador/administrador) e uma de `INSERT` (só operador). **Não deve
  existir** política de `UPDATE` — a edição só acontece pela função
  `editar_registro_cip` (ver item 6), nunca por UPDATE direto da API.
- **`cip_edicoes`**: só uma política de `SELECT`. **Não deve existir**
  política de `INSERT` — pelo mesmo motivo: só a função transacional
  insere aqui, nunca a API direta (evita "edição fantasma" sem UPDATE
  correspondente no registro).
- **`cip_observacoes`**: uma de `SELECT` e uma de `INSERT` restrita a
  `administrador`.

## 5. Privilégios de UPDATE/INSERT revogados como camada extra

```sql
select table_name, grantee, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in ('cip_registros', 'cip_edicoes')
  and grantee in ('authenticated', 'anon')
order by table_name, grantee, privilege_type;
```

**Esperado:** **nenhuma linha** com `privilege_type = 'UPDATE'` para
`cip_registros`, e **nenhuma linha** com `privilege_type = 'INSERT'` para
`cip_edicoes`, para `authenticated` ou `anon`. Isso é uma segunda camada de
proteção independente da RLS (mesmo que a RLS fosse desabilitada por
engano, o UPDATE/INSERT direto continuaria impossível pela API).

## 6. A função `editar_registro_cip` existe e está correta

```sql
select proname, prosecdef, proconfig
from pg_proc
where proname = 'editar_registro_cip';
```

**Esperado:** `prosecdef = true` (ou seja, `SECURITY DEFINER` — necessário
porque a função contorna as restrições de UPDATE/INSERT acima, de forma
controlada) e `proconfig` contendo `search_path=` vazio (proteção contra
"search_path hijacking").

```sql
select grantee, privilege_type
from information_schema.role_routine_grants
where routine_name = 'editar_registro_cip';
```

**Esperado:** `EXECUTE` concedido só para `authenticated`, **nunca** para
`anon` — usuários não logados não podem nem tentar chamar a função.

## 7. Função auxiliar `auth_role()` usa os nomes reais de coluna

```sql
select pg_get_functiondef(oid)
from pg_proc
where proname = 'auth_role';
```

**Esperado:** o corpo deve ler
`select perfil from public.perfis where uid = auth.uid();` — se o corpo
real usar `role`/`id` em vez de `perfil`/`uid`, isso é uma divergência
importante (me avise antes de qualquer alteração).

## 8. Nenhuma chave privilegiada exposta no frontend

Isso não depende de acesso ao Supabase — já foi verificado localmente:
`public/js/config.js` contém apenas a URL do projeto e a chave
**publishable** (`sb_publishable_...`), nunca `service_role` ou `secret`.
Nada a fazer aqui, só confirmando que este item já está coberto.

---

Depois de rodar os itens acima, me diga quais bateram com o esperado e
quais não bateram — principalmente os itens 4, 5, 6 e 7, que são as
proteções que impedem alguém de editar um registro ou inserir uma
"edição"/observação por fora da interface, mesmo indo direto na API.
