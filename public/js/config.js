// =====================================================================
// Configuração de conexão com o Supabase
// =====================================================================
// Preencha com os dados do SEU projeto Supabase (Project Settings > API).
//
// IMPORTANTE:
// - SUPABASE_ANON_KEY guarda a chave PÚBLICA do projeto — hoje, nos
//   projetos Supabase novos, essa chave é do tipo "publishable"
//   (formato "sb_publishable_..."), que substitui a antiga "anon key"
//   (um JWT). As duas funcionam da mesma forma na inicialização do
//   cliente (createClient(url, chave)) e têm os mesmos privilégios
//   baixos — a segurança real continua sendo garantida pelas políticas
//   de Row Level Security (RLS) criadas pelo schema.sql, não pela
//   chave. Mantivemos o nome da variável (SUPABASE_ANON_KEY) só por
//   compatibilidade com o resto do código; o valor pode ser uma anon
//   key antiga OU uma publishable key nova, sem diferença de uso aqui.
// - NUNCA coloque aqui a "service_role key" nem a "secret key" novas.
//   Essas chaves são secretas, têm acesso total ao banco (e a secret
//   key é rejeitada pelo próprio Supabase se usada no navegador) e NÃO
//   devem existir em nenhum arquivo do site.
// =====================================================================

// URL e chave pública (publishable) do projeto Supabase, informadas
// pelo usuário. Projeto exclusivo do Sistema CIP (ref krscjbdphymgzjteclif),
// criado em 2026-10-28, substituindo o projeto anterior
// (ljxzulemauygqfonoume) — ver histórico em VERIFICACAO_SUPABASE_PRODUCAO.md.
window.SUPABASE_URL = "https://krscjbdphymgzjteclif.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_HSW-mqcJySZAo4GnnQ6U1A_l4K4I0qv";
