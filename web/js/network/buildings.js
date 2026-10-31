// Prédio: um marcador que agrupa as caixas (CTO/CEO) instaladas dentro dele, cada uma com torre e andar.
// No mapa aparece só o prédio (com quantas caixas e portas); as caixas ficam no mesmo ponto, escondidas, e se
// abrem pela lista do prédio. A prumada (cabo que sobe entre os andares) é estimada pela altura do andar.
// Depende de js/app.js (markers, updateMarkerAppearance), js/map/marker-panel.js e js/network/clients.js.

const BUILDING_BOX_TYPES = ['CTO', 'CEO'];
const BUILDING_DEFAULT_FLOOR_HEIGHT = 3;   //metros por andar
const BUILDING_RISER_RESERVE_M = 10;       //sobra no pé da prumada

function isBuildingMarker(markerInfo) {
    return markerInfo?.type === 'PREDIO';
}

function getBuildingOf(box) {
    if (!box?.buildingUid || !BUILDING_BOX_TYPES.includes(box.type)) return null;
    const building = markers.find(m => m.uid === box.buildingUid && isBuildingMarker(m));
    return building && (typeof isSameProject !== 'function' || isSameProject(building, box)) ? building : null;
}

function isBoxInsideBuilding(box) {
    return !!getBuildingOf(box);
}

//Caixas do prédio, do andar mais baixo para o mais alto (térreo e subsolo primeiro)
function getBuildingBoxes(building) {
    if (!building?.uid) return [];
    return markers.filter(m => BUILDING_BOX_TYPES.includes(m.type) && m.buildingUid === building.uid
        && (typeof isSameProject !== 'function' || isSameProject(m, building)))
        .sort((a, b) => String(a.tower || '').localeCompare(String(b.tower || ''), 'pt-BR', { numeric: true })
            || floorSortValue(a.floor) - floorSortValue(b.floor)
            || String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', { numeric: true }));
}

//"T", "Térreo" = 0; "SS", "Subsolo 2" = -2; "5" ou "5º" = 5
function floorSortValue(floor) {
    const t = String(floor ?? '').trim().toUpperCase();
    if (!t) return 0;
    if (/^T(ERREO|ÉRREO)?$/.test(t)) return 0;
    const sub = /^(SS|SUBSOLO|S)\s*(\d*)$/.exec(t);
    if (sub) return -(parseInt(sub[2], 10) || 1);
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? n : 0;
}

function formatBuildingFloor(floor) {
    const t = String(floor ?? '').trim();
    if (!t) return '';
    if (/^\d+$/.test(t)) return `${t}º andar`;
    if (/^T$/i.test(t)) return 'Térreo';
    return t;
}

//"Ed. Sol · Torre A · 5º andar"
function describeBoxLocation(box) {
    const building = getBuildingOf(box);
    if (!building) return '';
    return [building.name, box.tower ? `Torre ${box.tower}` : '', formatBuildingFloor(box.floor)].filter(Boolean).join(' · ');
}

//Prumada: do térreo até o andar mais alto com caixa (por torre), mais a sobra
function getBuildingRiserMeters(building) {
    const boxes = getBuildingBoxes(building);
    if (!boxes.length) return 0;
    const height = Number(building.building?.floorHeight) || BUILDING_DEFAULT_FLOOR_HEIGHT;
    const byTower = new Map();
    boxes.forEach(b => {
        const key = b.tower || '';
        byTower.set(key, Math.max(byTower.get(key) || 0, Math.max(0, floorSortValue(b.floor))));
    });
    const floors = [...byTower.values()].reduce((sum, top) => sum + top, 0);
    return floors > 0 ? Math.round(floors * height + BUILDING_RISER_RESERVE_M * byTower.size) : 0;
}

function getBuildingPortSummary(building) {
    const boxes = getBuildingBoxes(building);
    const ctos = boxes.filter(b => b.type === 'CTO');
    let total = 0, used = 0;
    ctos.forEach(cto => {
        total += typeof getCtoPortCapacity === 'function' ? (getCtoPortCapacity(cto) || DEFAULT_CTO_PORTS) : 0;
        used += typeof getOccupiedPorts === 'function' ? getOccupiedPorts(cto).size : 0;
    });
    return { boxes: boxes.length, ctos: ctos.length, ceos: boxes.length - ctos.length, total, used };
}

//Rótulo do prédio no mapa: nome e quantas caixas tem
function getBuildingMapLabel(building) {
    const { boxes } = getBuildingPortSummary(building);
    return boxes ? `${building.name} · ${boxes} ${boxes === 1 ? 'caixa' : 'caixas'}` : building.name;
}

//Caixa dentro do prédio fica no ponto do prédio (mover o prédio leva as caixas junto)
function syncBuildingBoxesPosition(building) {
    const pos = building?.marker?.getPosition?.();
    if (!pos) return;
    getBuildingBoxes(building).forEach(box => {
        const p = box.marker?.getPosition?.();
        if (p && (p.lat() !== pos.lat() || p.lng() !== pos.lng())) box.marker.setPosition(pos);
    });
}

//Prédios do projeto (para a caixa escolher em qual está)
function getProjectBuildings(near) {
    return markers.filter(m => isBuildingMarker(m) && (!near || typeof isSameProject !== 'function' || isSameProject(m, near)))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', { numeric: true }));
}

//Liga (ou tira) a caixa do prédio, com torre e andar
function setBoxBuilding(box, building, { tower = '', floor = '' } = {}) {
    if (!box || !BUILDING_BOX_TYPES.includes(box.type)) return;
    const previous = getBuildingOf(box);
    if (building) {
        box.buildingUid = building.uid;
        box.tower = String(tower || '').trim();
        box.floor = String(floor || '').trim();
        if (box.type === 'CTO') box.isPredial = true;
        const pos = building.marker?.getPosition?.();
        if (pos) box.marker?.setPosition(pos);
    } else {
        delete box.buildingUid;
        delete box.tower;
        delete box.floor;
    }
    updateMarkerAppearance(box);
    if (previous && previous !== building) updateMarkerAppearance(previous);
    if (building) updateMarkerAppearance(building);
}

// ---------------------------------------------------------------
// Painel do prédio (dentro do painel de marcador) e escolha da caixa
// ---------------------------------------------------------------

function renderBuildingBoxesPanel(building) {
    const box = document.getElementById('buildingBoxesPanel');
    if (!box) return;
    if (!building) { box.innerHTML = ''; return; }
    const boxes = getBuildingBoxes(building);
    const summary = getBuildingPortSummary(building);
    const riser = getBuildingRiserMeters(building);
    const canEdit = AppSession.canEdit;
    const rows = boxes.map(b => {
        const ports = b.type === 'CTO' && typeof getCtoPortCapacity === 'function'
            ? `${typeof getOccupiedPorts === 'function' ? getOccupiedPorts(b).size : 0}/${getCtoPortCapacity(b) || DEFAULT_CTO_PORTS} portas` : b.type;
        const where = [b.tower ? `Torre ${b.tower}` : '', formatBuildingFloor(b.floor) || 'Andar não informado'].filter(Boolean).join(' · ');
        return `<li class="building-box">
            <span class="building-box__floor">${escapeHtml(where)}</span>
            <strong class="building-box__name">${escapeHtml(b.name || b.type)}</strong>
            <small>${escapeHtml(ports)}</small>
            <button type="button" class="btn btn-secondary btn-sm" data-building-open="${escapeHtml(b.uid)}">Abrir</button>
        </li>`;
    }).join('');
    box.innerHTML = `
        <div class="building-summary">
            <span><b>${summary.boxes}</b> ${summary.boxes === 1 ? 'caixa' : 'caixas'}</span>
            ${summary.ctos ? `<span><b>${summary.used}/${summary.total}</b> portas em uso</span>` : ''}
            ${riser ? `<span>Prumada ≈ <b>${riser} m</b></span>` : ''}
        </div>
        ${boxes.length ? `<ul class="building-boxes">${rows}</ul>` : '<p class="map-tool-help">Nenhuma caixa neste prédio ainda.</p>'}
        ${canEdit ? `<div class="building-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-building-add="CTO">+ CTO neste prédio</button>
            <button type="button" class="btn btn-secondary btn-sm" data-building-add="CEO">+ CEO neste prédio</button>
        </div>` : ''}`;
}

//Nova caixa já dentro do prédio: abre o painel de criação com o prédio escolhido e posiciona no ponto dele
function addBoxToBuilding(building, type) {
    if (!building || !requireEdit('adicionar caixas')) return;
    const pos = building.marker.getPosition();
    resetMarkerModal();
    setActiveFolder(building.folderId);
    if (typeof openMarkerCreatePanel === 'function') openMarkerCreatePanel(type);
    pendingMarkerPosition = pos;
    fillBoxBuildingFields({ buildingUid: building.uid, tower: '', floor: '' }, building);
}

//Campos "Prédio / Torre / Andar" no painel da CTO/CEO
function fillBoxBuildingFields(box, near) {
    const group = document.getElementById('boxBuildingGroup');
    if (!group) return;
    const buildings = getProjectBuildings(near || box);
    const select = document.getElementById('boxBuildingSelect');
    select.innerHTML = '<option value="">Fora de prédio</option>' + buildings.map(b =>
        `<option value="${escapeHtml(b.uid)}">${escapeHtml(b.name)}</option>`).join('');
    select.value = buildings.some(b => b.uid === box?.buildingUid) ? box.buildingUid : '';
    document.getElementById('boxBuildingTower').value = box?.tower || '';
    document.getElementById('boxBuildingFloor').value = box?.floor || '';
    syncBoxBuildingFields();
}

function syncBoxBuildingFields() {
    const group = document.getElementById('boxBuildingGroup');
    if (!group) return;
    const type = typeof getMarkerPanelType === 'function' ? getMarkerPanelType() : null;
    const hasBuildings = document.getElementById('boxBuildingSelect').options.length > 1;
    group.classList.toggle('hidden', !BUILDING_BOX_TYPES.includes(type) || !hasBuildings);
    const inside = !!document.getElementById('boxBuildingSelect').value;
    group.querySelectorAll('.box-building__where').forEach(el => el.classList.toggle('hidden', !inside));
}

function readBoxBuildingFields() {
    const select = document.getElementById('boxBuildingSelect');
    if (!select || document.getElementById('boxBuildingGroup').classList.contains('hidden')) return null;
    return {
        building: markers.find(m => m.uid === select.value && isBuildingMarker(m)) || null,
        tower: document.getElementById('boxBuildingTower').value.trim(),
        floor: document.getElementById('boxBuildingFloor').value.trim(),
    };
}

//Durante o desenho do cabo: clicar no prédio pergunta em qual caixa ligar
function chooseBuildingBoxForCable(building) {
    const boxes = getBuildingBoxes(building);
    if (!boxes.length) {
        showToast('Prédio sem caixas', `Adicione uma CTO ou CEO em "${building.name}" para ligar o cabo.`, 'progress');
        return;
    }
    if (boxes.length === 1) { handleAnchorMarkerClickDuringCableDraw(boxes[0]); return; }
    let modal = document.getElementById('buildingChooseModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'buildingChooseModal';
        modal.className = 'modal';
        modal.innerHTML = `<div class="modal-content building-choose" role="dialog" aria-labelledby="buildingChooseTitle">
            <div class="modal-header-v2 rm-head rm-head--proj"><div class="rm-head__text"><h2 id="buildingChooseTitle">Ligar em qual caixa?</h2>
            <p class="rm-head__sub" id="buildingChooseSub"></p></div></div>
            <ul class="building-boxes" id="buildingChooseList"></ul>
            <div class="modal-footer"><button type="button" class="btn btn-secondary" data-building-choose="cancel">Cancelar</button></div></div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            const pick = e.target.closest('[data-building-pick]');
            if (pick || e.target === modal || e.target.closest('[data-building-choose="cancel"]')) modal.style.display = 'none';
            if (pick) {
                const target = markers.find(m => m.uid === pick.dataset.buildingPick);
                if (target) handleAnchorMarkerClickDuringCableDraw(target);
            }
        });
    }
    document.getElementById('buildingChooseSub').textContent = building.name;
    document.getElementById('buildingChooseList').innerHTML = boxes.map(b => `<li class="building-box">
        <span class="building-box__floor">${escapeHtml([b.tower ? `Torre ${b.tower}` : '', formatBuildingFloor(b.floor) || '—'].filter(Boolean).join(' · '))}</span>
        <strong class="building-box__name">${escapeHtml(b.name)}</strong><small>${b.type}</small>
        <button type="button" class="btn btn-success btn-sm" data-building-pick="${escapeHtml(b.uid)}">Ligar aqui</button></li>`).join('');
    modal.style.display = 'flex';
}

function setupBuildings() {
    document.addEventListener('click', (e) => {
        const open = e.target.closest('[data-building-open]');
        if (open) {
            const box = markers.find(m => m.uid === open.dataset.buildingOpen);
            if (box) { resetMarkerModal(); openMarkerFromUserAction(box); }
            return;
        }
        const add = e.target.closest('[data-building-add]');
        if (add && editingMarkerInfo && isBuildingMarker(editingMarkerInfo)) addBoxToBuilding(editingMarkerInfo, add.dataset.buildingAdd);
    });
    document.getElementById('boxBuildingSelect')?.addEventListener('change', syncBoxBuildingFields);
}

document.addEventListener('DOMContentLoaded', setupBuildings);
