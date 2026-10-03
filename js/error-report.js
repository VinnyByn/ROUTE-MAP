// Registro de erros do navegador: grava na tabela client_errors (Supabase) os erros que acontecem
// com os usuários, para o administrador ver em Minha conta → Empresa. Sem dados do projeto: só a
// mensagem, onde aconteceu, a página e o navegador. No máximo 10 erros por acesso, sem repetir.
// Depende de js/supabase-client.js (supabaseClient, AppSession). Carregado sem defer, logo depois dele.

const ERROR_REPORT_LIMIT = 10;
const errorReportSeen = new Set();
const errorReportQueue = [];
let errorReportSent = 0;

//Ruídos conhecidos que não são erro do sistema
const ERROR_REPORT_IGNORE = [
    /ResizeObserver loop/i,
    /^Script error\.?$/i,                       //erro de outro domínio sem detalhes
    /chrome-extension:|moz-extension:|safari-extension:/i,
    /Failed to fetch|NetworkError|Load failed/i, //sem internet: não é defeito do sistema
    /AbortError/i,
];

function reportClientError(message, detail = '') {
    const text = String(message || '').trim();
    if (!text) return;
    const full = `${text} ${detail}`;
    if (ERROR_REPORT_IGNORE.some(rx => rx.test(full))) return;
    const key = text.slice(0, 200);
    if (errorReportSeen.has(key) || errorReportSeen.size >= ERROR_REPORT_LIMIT) return;
    errorReportSeen.add(key);
    errorReportQueue.push({
        message: text.slice(0, 1000),
        detail: String(detail || '').slice(0, 4000) || null,
        page: (location.pathname + location.hash).slice(0, 300),
        user_agent: navigator.userAgent.slice(0, 300),
    });
    flushClientErrors();
}

async function flushClientErrors() {
    if (!AppSession?.company?.id || !AppSession.userId || !errorReportQueue.length) return;
    const batch = errorReportQueue.splice(0).slice(0, ERROR_REPORT_LIMIT - errorReportSent)
        .map(e => ({ ...e, company_id: AppSession.company.id, user_id: AppSession.userId }));
    if (!batch.length) return;
    errorReportSent += batch.length;
    try {
        await supabaseClient.from('client_errors').insert(batch);
    } catch (e) { /* registro de erro nunca pode gerar outro erro */ }
}

window.addEventListener('error', (event) => {
    const where = event.filename ? `${event.filename.replace(location.origin, '')}:${event.lineno}:${event.colno}` : '';
    reportClientError(event.message || event.error?.message, [where, event.error?.stack].filter(Boolean).join('\n'));
});

window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportClientError(reason?.message || String(reason || 'Promessa rejeitada'), reason?.stack || '');
});

//Envia o que ficou na fila assim que a sessão carrega a empresa
(function waitForSession() {
    if (AppSession?.company?.id) return flushClientErrors();
    setTimeout(waitForSession, 1500);
})();
