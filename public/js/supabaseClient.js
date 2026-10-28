// =====================================================================
// Inicialização do cliente Supabase (via CDN, sem build/instalação local)
// =====================================================================

function configuracaoAusente() {
  return (
    !window.SUPABASE_URL ||
    !window.SUPABASE_ANON_KEY ||
    window.SUPABASE_URL.indexOf("COLE_AQUI") !== -1 ||
    window.SUPABASE_ANON_KEY.indexOf("COLE_AQUI") !== -1
  );
}

if (configuracaoAusente()) {
  document.addEventListener("DOMContentLoaded", () => {
    document.body.innerHTML = `
      <div class="tela-erro">
        <h1>Configuração pendente</h1>
        <p>
          O arquivo <code>public/js/config.js</code> ainda não foi
          preenchido com a URL e a chave pública (anon key) do seu
          projeto Supabase.
        </p>
        <p>Veja o passo 6 do arquivo <code>INSTRUCOES.md</code>.</p>
      </div>
    `;
  });
  throw new Error("Configuração do Supabase ausente em public/js/config.js (SUPABASE_URL / SUPABASE_ANON_KEY).");
}

const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);
