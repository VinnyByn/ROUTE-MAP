// Projetos: tipos (TCR, TCT, MDU, Backbone, B2B), seletor de tipo do formulário e a janela
// "Abrir projeto" com busca no servidor (sem acento, várias palavras), filtros por tipo e cidade,
// ordenação e carregamento em páginas de 20 conforme a lista rola. Depende de script.js.

const PROJECT_TYPES = [
    { value: 'TCR', label: 'TCR', color: '#0f766e' },
    { value: 'TCT', label: 'TCT', color: '#2563eb' },
    { value: 'MDU', label: 'MDU', color: '#7c3aed', hint: 'Prédios e condomínios' },
    { value: 'Backbone', label: 'Backbone', color: '#c2410c', hint: 'Rede troncal entre POPs e cidades' },
    { value: 'B2B', label: 'B2B', color: '#be123c', hint: 'Atendimento empresarial' },
];
const PROJECT_PAGE_SIZE = 20;
const PROJECT_PICKER_PREFS_KEY = 'routeMapProjectPicker';

function getProjectTypeMeta(value) {
    return PROJECT_TYPES.find(t => t.value === value) || { value: value || '', label: value || '—', color: '#64748b' };
}

// ---------------------------------------------------------------
// Seletor de tipo no formulário de projeto (o valor fica em #projectType)
// ---------------------------------------------------------------

function renderProjectTypePicker() {
    const picker = document.getElementById('projectTypePicker');
    if (!picker) return;
    picker.innerHTML = '';
    PROJECT_TYPES.forEach(type => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'project-type-option';
        button.dataset.value = type.value;
        button.setAttribute('role', 'radio');
        button.style.setProperty('--type-color', type.color);
        button.innerHTML = `<span class="project-type-option__dot" aria-hidden="true"></span><span>${escapeHtml(type.label)}</span>`;
        if (type.hint) button.title = type.hint;
        button.addEventListener('click', () => setProjectTypeValue(type.value));
        picker.appendChild(button);
    });
    setProjectTypeValue(document.getElementById('projectType').value || 'TCR');
}

function setProjectTypeValue(value) {
    const input = document.getElementById('projectType');
    input.value = value || 'TCR';
    document.querySelectorAll('#projectTypePicker .project-type-option').forEach(button => {
        const active = button.dataset.value === input.value;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    const hint = document.getElementById('projectTypeHint');
    if (hint) hint.textContent = getProjectTypeMeta(input.value).hint || '';
}

// ---------------------------------------------------------------
// Janela "Abrir projeto"
// ---------------------------------------------------------------

const projectPicker = {
    term: '',
    type: '',
    city: '',
    sort: 'recent',
    items: [],
    total: 0,
    loading: false,
    done: false,
    seq: 0,
    timer: null,
    observer: null,
    rpcAvailable: true,
    facets: null,
};

function readProjectPickerPrefs() {
    try {
        const saved = JSON.parse(localStorage.getItem(PROJECT_PICKER_PREFS_KEY) || '{}');
        return { sort: ['recent', 'name', 'city', 'oldest'].includes(saved.sort) ? saved.sort : 'recent' };
    } catch (e) {
        return { sort: 'recent' };
    }
}

function storeProjectPickerPrefs() {
    try { localStorage.setItem(PROJECT_PICKER_PREFS_KEY, JSON.stringify({ sort: projectPicker.sort })); } catch (e) { /* armazenamento indisponível */ }
}

function openProjectPicker() {
    document.getElementById('projectDropdown')?.classList.remove('show');
    const input = document.getElementById('projectSearchInput');
    input.value = '';
    Object.assign(projectPicker, { term: '', type: '', city: '', sort: readProjectPickerPrefs().sort });
    document.getElementById('projectSortSelect').value = projectPicker.sort;
    document.getElementById('projectCityFilter').value = '';
    updateProjectSearchClear();
    document.getElementById('loadProjectModal').style.display = 'flex';
    loadProjectFacets();
    reloadProjectPickerList();
    setTimeout(() => input.focus(), 50);
}

function closeProjectPicker() {
    document.getElementById('loadProjectModal').style.display = 'none';
    projectPicker.observer?.disconnect();
}

function handleProjectSearchInput() {
    updateProjectSearchClear();
    clearTimeout(projectPicker.timer);
    projectPicker.timer = setTimeout(() => {
        const term = document.getElementById('projectSearchInput').value.trim();
        if (term === projectPicker.term) return;
        projectPicker.term = term;
        reloadProjectPickerList();
    }, 280);
}

function updateProjectSearchClear() {
    const hasText = !!document.getElementById('projectSearchInput').value;
    document.getElementById('projectSearchClear')?.classList.toggle('hidden', !hasText);
}

//Tipos e cidades existentes na empresa, com a quantidade de projetos
async function loadProjectFacets() {
    await appReady;
    let facets = null;
    if (projectPicker.rpcAvailable) {
        const { data, error } = await supabaseClient.rpc('project_facets');
        if (!error && data) facets = data;
        else if (isMissingRpcError(error)) projectPicker.rpcAvailable = false;
    }
    projectPicker.facets = facets;
    renderProjectTypeChips();
    renderProjectCityOptions();
}

function renderProjectTypeChips() {
    const wrap = document.getElementById('projectTypeChips');
    if (!wrap) return;
    const counts = new Map((projectPicker.facets?.types || []).map(t => [t.value, t.count]));
    const total = projectPicker.facets?.total;
    const chips = [{ value: '', label: 'Todos', color: 'var(--brand-600)', count: total }]
        .concat(PROJECT_TYPES.map(t => ({ ...t, count: projectPicker.facets ? (counts.get(t.value) || 0) : undefined })));
    //Tipos antigos/personalizados que existam no banco também aparecem
    counts.forEach((count, value) => {
        if (!PROJECT_TYPES.some(t => t.value === value)) chips.push({ ...getProjectTypeMeta(value), count });
    });
    wrap.innerHTML = '';
    chips.forEach(chip => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `pp-chip${projectPicker.type === chip.value ? ' is-active' : ''}${chip.count === 0 ? ' is-empty' : ''}`;
        button.dataset.value = chip.value;
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', projectPicker.type === chip.value ? 'true' : 'false');
        button.style.setProperty('--chip', chip.color);
        button.innerHTML = `${chip.value ? '<span class="pp-chip__dot" aria-hidden="true"></span>' : ''}<span>${escapeHtml(chip.label)}</span>${chip.count !== undefined ? `<small>${chip.count}</small>` : ''}`;
        button.addEventListener('click', () => {
            if (projectPicker.type === chip.value) return;
            projectPicker.type = chip.value;
            renderProjectTypeChips();
            reloadProjectPickerList();
        });
        wrap.appendChild(button);
    });
}

function renderProjectCityOptions() {
    const select = document.getElementById('projectCityFilter');
    if (!select) return;
    const cities = projectPicker.facets?.cities || [];
    select.innerHTML = '<option value="">Todas as cidades</option>'
        + cities.map(c => `<option value="${escapeHtml(c.value)}">${escapeHtml(c.value)} (${c.count})</option>`).join('');
    select.value = projectPicker.city;
    select.closest('.pp-select')?.classList.toggle('hidden', cities.length < 2 && !projectPicker.city);
}

function isMissingRpcError(error) {
    return !!error && (error.code === 'PGRST202' || /could not find the function/i.test(error.message || ''));
}

function reloadProjectPickerList() {
    projectPicker.items = [];
    projectPicker.total = 0;
    projectPicker.done = false;
    projectPicker.seq++;
    const list = document.getElementById('projectPickerList');
    list.innerHTML = '';
    list.scrollTop = 0;
    renderProjectPickerSkeleton(list, 5);
    updateProjectPickerCount(null);
    fetchProjectPickerPage();
}

function renderProjectPickerSkeleton(list, count) {
    for (let i = 0; i < count; i++) {
        const li = document.createElement('li');
        li.className = 'pp-item pp-item--skeleton';
        li.setAttribute('aria-hidden', 'true');
        li.innerHTML = '<span class="pp-badge"></span><div class="pp-item__body"><span class="pp-sk pp-sk--title"></span><span class="pp-sk"></span></div>';
        list.appendChild(li);
    }
}

//Busca uma página. Usa a função search_projects do banco; se ainda não existir, consulta a tabela direto.
async function fetchProjectPickerPage() {
    if (projectPicker.loading || projectPicker.done) return;
    projectPicker.loading = true;
    const seq = projectPicker.seq;
    const offset = projectPicker.items.length;
    await appReady;
    let rows = [];
    let total = 0;
    let error = null;
    if (projectPicker.rpcAvailable) {
        const result = await supabaseClient.rpc('search_projects', {
            p_term: projectPicker.term || null,
            p_type: projectPicker.type || null,
            p_city: projectPicker.city || null,
            p_sort: projectPicker.sort,
            p_limit: PROJECT_PAGE_SIZE,
            p_offset: offset,
        });
        if (isMissingRpcError(result.error)) {
            projectPicker.rpcAvailable = false;
        } else {
            error = result.error;
            rows = result.data || [];
            total = rows.length ? Number(rows[0].total_count) : (offset ? projectPicker.total : 0);
        }
    }
    if (!projectPicker.rpcAvailable) {
        const result = await fetchProjectPickerPageFallback(offset);
        error = result.error;
        rows = result.rows;
        total = result.total;
    }
    if (seq !== projectPicker.seq) return; //Uma busca mais nova começou
    projectPicker.loading = false;
    const list = document.getElementById('projectPickerList');
    list.querySelectorAll('.pp-item--skeleton, .pp-more, .project-picker__state').forEach(el => el.remove());
    if (error) {
        console.error('Erro ao listar projetos:', error);
        list.insertAdjacentHTML('beforeend', '<li class="project-picker__state project-picker__state--error">Não foi possível carregar os projetos. <button type="button" class="btn btn-secondary btn-sm" data-pp-retry>Tentar de novo</button></li>');
        list.querySelector('[data-pp-retry]').addEventListener('click', reloadProjectPickerList);
        return;
    }
    projectPicker.total = total;
    projectPicker.items.push(...rows);
    projectPicker.done = projectPicker.items.length >= total || rows.length < PROJECT_PAGE_SIZE;
    rows.forEach(project => list.appendChild(buildProjectPickerItem(project)));
    updateProjectPickerCount(total);
    if (!projectPicker.items.length) {
        list.innerHTML = renderProjectPickerEmptyState();
        list.querySelector('[data-pp-clear]')?.addEventListener('click', clearProjectPickerFilters);
        list.querySelector('[data-pp-create]')?.addEventListener('click', () => {
            closeProjectPicker();
            document.getElementById('createProjectButton')?.click();
        });
        return;
    }
    if (!projectPicker.done) appendProjectPickerSentinel(list);
}

async function fetchProjectPickerPageFallback(offset) {
    let query = supabaseClient
        .from('projects')
        .select('id, name, city, neighborhood, project_type, created_at, updated_at', { count: 'exact' });
    const term = projectPicker.term.replace(/[%,()*\\]/g, ' ').trim();
    term.split(/\s+/).filter(Boolean).forEach(word => {
        query = query.or(`name.ilike.%${word}%,city.ilike.%${word}%,neighborhood.ilike.%${word}%,project_type.ilike.%${word}%`);
    });
    if (projectPicker.type) query = query.eq('project_type', projectPicker.type);
    if (projectPicker.city) query = query.eq('city', projectPicker.city);
    if (projectPicker.sort === 'name') query = query.order('name', { ascending: true });
    else if (projectPicker.sort === 'city') query = query.order('city', { ascending: true, nullsFirst: false });
    query = query.order('updated_at', { ascending: projectPicker.sort === 'oldest' });
    const { data, error, count } = await query.range(offset, offset + PROJECT_PAGE_SIZE - 1);
    return { rows: data || [], total: count ?? (data?.length || 0), error };
}

function appendProjectPickerSentinel(list) {
    const li = document.createElement('li');
    li.className = 'pp-more';
    li.innerHTML = `<button type="button" class="btn btn-secondary btn-sm">Carregar mais (${projectPicker.total - projectPicker.items.length} restantes)</button>`;
    li.querySelector('button').addEventListener('click', fetchProjectPickerPage);
    list.appendChild(li);
    projectPicker.observer?.disconnect();
    if ('IntersectionObserver' in window) {
        projectPicker.observer = new IntersectionObserver((entries) => {
            if (entries.some(e => e.isIntersecting)) fetchProjectPickerPage();
        }, { root: list, rootMargin: '120px' });
        projectPicker.observer.observe(li);
    }
}

function updateProjectPickerCount(total) {
    const el = document.getElementById('projectPickerCount');
    if (!el) return;
    if (total === null) {
        el.textContent = 'Buscando…';
        return;
    }
    const filtered = !!(projectPicker.term || projectPicker.type || projectPicker.city);
    el.textContent = total === 0 ? (filtered ? 'Nenhum resultado' : 'Nenhum projeto')
        : `${total} projeto${total === 1 ? '' : 's'}${filtered ? ' encontrado' + (total === 1 ? '' : 's') : ''}`
          + (projectPicker.items.length < total ? ` · mostrando ${projectPicker.items.length}` : '');
    document.getElementById('projectPickerClear')?.classList.toggle('hidden', !filtered);
}

function renderProjectPickerEmptyState() {
    const filtered = !!(projectPicker.term || projectPicker.type || projectPicker.city);
    if (filtered) {
        return `<li class="project-picker__state pp-empty">
            <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-search"></use></svg>
            <strong>Nada encontrado</strong>
            <span>Nenhum projeto corresponde à busca${projectPicker.type ? ` no tipo ${escapeHtml(projectPicker.type)}` : ''}${projectPicker.city ? ` em ${escapeHtml(projectPicker.city)}` : ''}.</span>
            <button type="button" class="btn btn-secondary btn-sm" data-pp-clear>Limpar filtros</button>
        </li>`;
    }
    return `<li class="project-picker__state pp-empty">
        <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-folder"></use></svg>
        <strong>Nenhum projeto salvo ainda</strong>
        <span>Crie o primeiro projeto da equipe.</span>
        ${AppSession.canEdit ? '<button type="button" class="btn btn-success btn-sm" data-pp-create>Novo projeto</button>' : ''}
    </li>`;
}

function clearProjectPickerFilters() {
    document.getElementById('projectSearchInput').value = '';
    document.getElementById('projectCityFilter').value = '';
    Object.assign(projectPicker, { term: '', type: '', city: '' });
    updateProjectSearchClear();
    renderProjectTypeChips();
    reloadProjectPickerList();
    document.getElementById('projectSearchInput').focus();
}

//Destaca no texto as palavras buscadas (ignorando acentos)
function highlightProjectTerm(text) {
    const value = String(text ?? '');
    const words = projectPicker.term.split(/\s+/).filter(w => w.length > 0);
    if (!words.length || !value) return escapeHtml(value);
    const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const folded = fold(value);
    const marks = new Array(value.length).fill(false);
    words.map(fold).forEach(word => {
        let index = folded.indexOf(word);
        while (index !== -1 && word) {
            for (let i = index; i < index + word.length; i++) marks[i] = true;
            index = folded.indexOf(word, index + word.length);
        }
    });
    //A normalização NFD+remoção mantém o tamanho do texto para letras latinas comuns
    if (folded.length !== value.length) return escapeHtml(value);
    let html = '';
    let open = false;
    for (let i = 0; i < value.length; i++) {
        if (marks[i] && !open) { html += '<mark>'; open = true; }
        if (!marks[i] && open) { html += '</mark>'; open = false; }
        html += escapeHtml(value[i]);
    }
    return open ? `${html}</mark>` : html;
}

function formatProjectSummary(summary) {
    if (!summary) return '';
    const parts = [];
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    if (summary.ctos) parts.push(plural(summary.ctos, 'CTO', 'CTOs'));
    if (summary.ceos) parts.push(plural(summary.ceos, 'CEO', 'CEOs'));
    if (summary.clients) parts.push(plural(summary.clients, 'cliente', 'clientes'));
    if (summary.cableMeters) {
        const m = Number(summary.cableMeters);
        parts.push(m >= 1000 ? `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km de cabo` : `${m} m de cabo`);
    }
    if (!parts.length) return summary.markers ? plural(summary.markers, 'marcador', 'marcadores') : 'Projeto vazio';
    return parts.join(' · ');
}

function buildProjectPickerItem(project) {
    const isOpen = !!document.getElementById(project.id);
    const type = getProjectTypeMeta(project.project_type);
    const place = [project.city, project.neighborhood].filter(Boolean);
    const li = document.createElement('li');
    li.className = `pp-item${isOpen ? ' is-open' : ''}`;
    li.dataset.projectId = project.id;
    li.tabIndex = 0;
    li.setAttribute('role', 'option');
    li.style.setProperty('--type-color', type.color);
    const who = project.updated_by_name ? ` por ${escapeHtml(project.updated_by_name.split(' ')[0])}` : '';
    const summary = formatProjectSummary(project.summary);
    li.innerHTML = `
        <span class="pp-badge" title="${escapeHtml(type.hint || type.label)}">${escapeHtml(type.label || '—')}</span>
        <div class="pp-item__body">
            <strong class="pp-item__name">${highlightProjectTerm(project.name)}</strong>
            <span class="pp-item__place">
                <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-marker"></use></svg>
                ${place.length ? place.map(p => highlightProjectTerm(p)).join(' · ') : 'Sem localização'}
            </span>
            ${summary ? `<span class="pp-item__summary">${escapeHtml(summary)}</span>` : ''}
        </div>
        <div class="pp-item__side">
            <small title="${escapeHtml(new Date(project.updated_at).toLocaleString('pt-BR'))}">Atualizado ${escapeHtml(formatRelativeDate(project.updated_at))}${who}</small>
            <button type="button" class="btn ${isOpen ? 'btn-secondary' : 'btn-success'} btn-sm load-project-btn" ${isOpen ? 'disabled' : ''}>${isOpen ? 'Aberto' : 'Abrir'}</button>
        </div>`;
    const open = (event) => {
        if (document.getElementById(project.id)) return;
        openProjectFromDatabase(project.id, li.querySelector('.load-project-btn'));
        event?.stopPropagation();
    };
    li.querySelector('.load-project-btn').addEventListener('click', open);
    li.addEventListener('dblclick', open);
    li.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') open(event);
    });
    return li;
}

//Setas navegam entre a busca e os projetos; Enter abre
function handleProjectPickerKeys(event) {
    const list = document.getElementById('projectPickerList');
    const items = Array.from(list.querySelectorAll('.pp-item:not(.pp-item--skeleton)'));
    if (!items.length || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
        const next = items[Math.min(items.length - 1, index + 1)];
        next.focus();
        next.scrollIntoView({ block: 'nearest' });
        if (index + 1 >= items.length - 3) fetchProjectPickerPage();
    } else if (index <= 0) {
        document.getElementById('projectSearchInput').focus();
    } else {
        items[index - 1].focus();
        items[index - 1].scrollIntoView({ block: 'nearest' });
    }
}

function setupProjectPicker() {
    renderProjectTypePicker();
    const input = document.getElementById('projectSearchInput');
    input.addEventListener('input', handleProjectSearchInput);
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            clearTimeout(projectPicker.timer);
            projectPicker.term = input.value.trim();
            reloadProjectPickerList();
        }
    });
    document.getElementById('projectSearchClear').addEventListener('click', () => {
        input.value = '';
        handleProjectSearchInput();
        input.focus();
    });
    document.getElementById('projectPickerClear').addEventListener('click', clearProjectPickerFilters);
    document.getElementById('projectCityFilter').addEventListener('change', (event) => {
        projectPicker.city = event.target.value;
        reloadProjectPickerList();
    });
    document.getElementById('projectSortSelect').addEventListener('change', (event) => {
        projectPicker.sort = event.target.value;
        storeProjectPickerPrefs();
        reloadProjectPickerList();
    });
    document.getElementById('loadProjectModal').addEventListener('keydown', handleProjectPickerKeys);
    document.getElementById('closeLoadProjectModal').addEventListener('click', closeProjectPicker);
}

setupProjectPicker();
