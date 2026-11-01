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
            ${boxes.length >= 2 ? '<button type="button" class="btn btn-secondary btn-sm" data-building-riser="1">+ Cabo entre caixas</button>' : ''}
        </div>` : ''}
        ${renderBuildingRiserCablesHtml(building)}`;
}

// ---------------------------------------------------------------
// Cabo entre caixas do prédio (prumada): não tem desenho no mapa (as caixas estão no mesmo ponto); a
// metragem é a diferença de andares × altura do andar + sobra, e pode ser corrigida à mão.
// ---------------------------------------------------------------

const BUILDING_RISER_FIBERS = ['FO-06', 'FO-12', 'FO-24', 'FO-36', 'FO-48', 'FO-72', 'FO-144', 'DROP'];
const BUILDING_RISER_SLACK_M = 5;

function getBuildingRiserCables(building) {
    const uids = new Set(getBuildingBoxes(building).map(b => b.uid));
    return savedCables.filter(c => c.riserMeters && uids.has(c.startAnchorUid) && uids.has(c.endAnchorUid));
}

function renderBuildingRiserCablesHtml(building) {
    const cables = getBuildingRiserCables(building);
    if (!cables.length) return '';
    const name = (uid) => markers.find(m => m.uid === uid)?.name || '?';
    return `<div class="building-risers"><small>Cabos dentro do prédio</small>${cables.map(c =>
        `<div class="building-riser"><strong>${escapeHtml(c.name)}</strong><span>${escapeHtml(name(c.startAnchorUid))} → ${escapeHtml(name(c.endAnchorUid))} · ${c.riserMeters} m</span></div>`).join('')}</div>`;
}

function suggestBuildingRiserMeters(building, a, b) {
    const height = Number(building.building?.floorHeight) || BUILDING_DEFAULT_FLOOR_HEIGHT;
    const floors = Math.abs(floorSortValue(a?.floor) - floorSortValue(b?.floor));
    return Math.max(1, Math.round(floors * height + BUILDING_RISER_SLACK_M));
}

function openBuildingRiserModal(building) {
    if (!requireEdit('cadastrar cabos')) return;
    const boxes = getBuildingBoxes(building);
    if (boxes.length < 2) return;
    let modal = document.getElementById('buildingRiserModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'buildingRiserModal';
        modal.className = 'modal';
        modal.innerHTML = `<div class="modal-content building-riser-modal" role="dialog" aria-labelledby="buildingRiserTitle">
            <div class="modal-header-v2 rm-head rm-head--proj"><div class="rm-head__text"><h2 id="buildingRiserTitle">Cabo entre caixas do prédio</h2>
            <p class="rm-head__sub" id="buildingRiserSub"></p></div></div>
            <div class="modal-body-content building-riser-form">
                <label><span>De</span><select id="buildingRiserFrom"></select></label>
                <label><span>Para</span><select id="buildingRiserTo"></select></label>
                <label><span>Fibras</span><select id="buildingRiserFiber">${BUILDING_RISER_FIBERS.map(f => `<option value="${f}"${f === 'FO-12' ? ' selected' : ''}>${f === 'DROP' ? 'Drop' : `${f.replace('FO-', '')} fibras`}</option>`).join('')}</select></label>
                <label><span>Metragem (m)</span><input type="number" id="buildingRiserMeters" min="1" step="1" /></label>
                <p class="map-tool-help">A metragem sai da diferença de andares × altura do andar, mais ${BUILDING_RISER_SLACK_M} m de sobra. Pode corrigir.</p>
            </div>
            <div class="modal-footer"><button type="button" class="btn btn-secondary" data-building-riser-act="cancel">Cancelar</button>
            <button type="button" class="btn btn-success" data-building-riser-act="save">Cadastrar cabo</button></div></div>`;
        document.body.appendChild(modal);
        const suggest = () => {
            const b = modal._building;
            const a = markers.find(m => m.uid === document.getElementById('buildingRiserFrom').value);
            const z = markers.find(m => m.uid === document.getElementById('buildingRiserTo').value);
            document.getElementById('buildingRiserMeters').value = suggestBuildingRiserMeters(b, a, z);
        };
        modal.addEventListener('change', (e) => { if (/buildingRiser(From|To)/.test(e.target.id)) suggest(); });
        modal.addEventListener('click', (e) => {
            const act = e.target.closest('[data-building-riser-act]')?.dataset.buildingRiserAct;
            if (e.target === modal || act === 'cancel') modal.style.display = 'none';
            if (act === 'save') {
                const cable = createBuildingRiserCable(modal._building, {
                    fromUid: document.getElementById('buildingRiserFrom').value,
                    toUid: document.getElementById('buildingRiserTo').value,
                    fiber: document.getElementById('buildingRiserFiber').value,
                    meters: parseFloat(document.getElementById('buildingRiserMeters').value),
                });
                if (cable) modal.style.display = 'none';
            }
        });
        modal._suggest = suggest;
    }
    modal._building = building;
    const options = boxes.map(b => `<option value="${escapeHtml(b.uid)}">${escapeHtml(`${b.name} · ${[b.tower ? `Torre ${b.tower}` : '', formatBuildingFloor(b.floor) || 'andar ?'].filter(Boolean).join(' · ')}`)}</option>`).join('');
    document.getElementById('buildingRiserFrom').innerHTML = options;
    document.getElementById('buildingRiserTo').innerHTML = options;
    document.getElementById('buildingRiserTo').selectedIndex = 1;
    document.getElementById('buildingRiserSub').textContent = building.name;
    modal._suggest();
    modal.style.display = 'flex';
}

//Cria o cabo ligado nas duas caixas (aparece no plano de fusão delas e na lista de materiais)
function createBuildingRiserCable(building, { fromUid, toUid, fiber = 'FO-12', meters }) {
    const from = markers.find(m => m.uid === fromUid), to = markers.find(m => m.uid === toUid);
    if (!from || !to || from === to) { showToast('Escolha duas caixas', 'O cabo precisa ligar duas caixas diferentes do prédio.', 'progress'); return null; }
    const riserMeters = Math.max(1, Math.round(Number(meters) || suggestBuildingRiserMeters(building, from, to)));
    const pos = building.marker.getPosition();
    const base = `${fiber}-${to.name}`;
    let name = base;
    for (let i = 2; savedCables.some(c => c.name === name); i++) name = `${base} (${i})`;
    rebuildCable({
        folderId: building.folderId, name, type: buildCableTypeString('AS 80', fiber), width: 4,
        color: getCableColor(fiber), status: 'Novo', riserMeters,
        path: [{ lat: pos.lat(), lng: pos.lng() }, { lat: pos.lat(), lng: pos.lng() }],
        startAnchorUid: from.uid, endAnchorUid: to.uid, startAnchorMarkerName: from.name, endAnchorMarkerName: to.name,
    });
    const cable = savedCables[savedCables.length - 1];
    syncProjectCableMeasurements([cable]);
    refreshBomAfterProjectChange();
    if (editingMarkerInfo === building) renderBuildingBoxesPanel(building);
    showToast('Cabo cadastrado', `${cable.name}: ${from.name} → ${to.name}, ${riserMeters} m dentro do prédio.`);
    return cable;
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
        if (e.target.closest('[data-building-riser]') && editingMarkerInfo && isBuildingMarker(editingMarkerInfo)) openBuildingRiserModal(editingMarkerInfo);
    });
    document.getElementById('boxBuildingSelect')?.addEventListener('change', syncBoxBuildingFields);
}

document.addEventListener('DOMContentLoaded', setupBuildings);

// ---------------------------------------------------------------
// Excluir o prédio leva junto as caixas dele e os cabos entre elas (cabo da rua que chega numa caixa fica,
// sem a ponta presa; cliente da caixa fica sem CTO, como ao excluir a caixa sozinha)
// ---------------------------------------------------------------

function getBuildingContents(building) {
    if (!isBuildingMarker(building)) return { boxes: [], cables: [] };
    return { boxes: getBuildingBoxes(building), cables: getBuildingRiserCables(building) };
}

//Texto para a confirmação: " As 3 caixas e 2 cabos dentro dele também saem."
function describeBuildingContents(building) {
    const { boxes, cables } = getBuildingContents(building);
    if (!boxes.length && !cables.length) return '';
    const parts = [];
    if (boxes.length) parts.push(`${boxes.length === 1 ? 'a caixa' : `as ${boxes.length} caixas`} (${boxes.map(b => b.name).join(', ')})`);
    if (cables.length) parts.push(`${cables.length === 1 ? 'o cabo' : `os ${cables.length} cabos`} entre elas`);
    return ` ${parts.join(' e ')} dentro dele também ${boxes.length + cables.length === 1 ? 'sai' : 'saem'}.`;
}

function removeBuildingContents(building) {
    const { boxes, cables } = getBuildingContents(building);
    cables.forEach(cable => {
        const usage = typeof checkCableUsageInFusionPlans === 'function' ? checkCableUsageInFusionPlans(cable) : null;
        if (usage?.isInPlan) removeCableFromSavedFusionPlans(cable, usage.boxes);
        cable.polyline?.setMap(null);
        cable.item?.remove();
    });
    boxes.forEach(box => {
        if (typeof focusedMapMarkerInfo !== 'undefined' && focusedMapMarkerInfo === box) clearMapMarkerHighlight();
        box.marker?.setMap(null);
        box.listItem?.remove();
    });
    if (cables.length) savedCables = savedCables.filter(c => !cables.includes(c));
    if (boxes.length) markers = markers.filter(m => !boxes.includes(m));
    return { boxes, cables };
}
