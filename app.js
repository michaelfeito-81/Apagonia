const APP_VERSION = "1.0.0";
const STORAGE_KEYS = {
    circuit: 'circuitoSeleccionado',
    schedules: 'horariosOffline',
    phrases: 'frasesOffline',
    syncedAt: 'datosSincronizadosEn',
    version: 'versionOffline',
    theme: 'apagoniaTema',
    layout: 'apagoniaLayout'
};
const MONTHS = { enero: 0, ene: 0, febrero: 1, feb: 1, marzo: 2, mar: 2, abril: 3, abr: 3, mayo: 4, may: 4, junio: 5, jun: 5, julio: 6, jul: 6, agosto: 7, ago: 7, septiembre: 8, setiembre: 8, sept: 8, sep: 8, octubre: 9, oct: 9, noviembre: 10, nov: 10, diciembre: 11, dic: 11 };
const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

let horariosData = {};
let frasesData = {};
let versionData = null;
let circuitoActual = localStorage.getItem(STORAGE_KEYS.circuit);
let eventoSeleccionado = null;
let fraseSeleccionada = '';

document.addEventListener('DOMContentLoaded', iniciarApp);

async function iniciarApp() {
    try {
        enlazarEventos();
        aplicarPreferencias();
        await Promise.all([registrarServiceWorker(), cargarDatosJSON(), cargarVersion()]);
        renderizarHorarioIfNeeded();
    } catch (e) {
        console.error("Error al iniciar la app:", e);
    }
}

function enlazarEventos() {
    document.querySelectorAll('[data-circuit]').forEach((button) => {
        button.addEventListener('click', () => selectCircuit(button.dataset.circuit));
    });
    document.getElementById('btn-back').addEventListener('click', logout);
    document.getElementById('btn-refresh').addEventListener('click', actualizarDatos);
    document.getElementById('btn-noti').addEventListener('click', abrirRecordatorios);
    document.getElementById('btn-settings').addEventListener('click', () => {
        syncPreferenceControls();
        toggleModal('modal-ajustes', true);
    });
    document.getElementById('link-legal-cover').addEventListener('click', () => toggleModal('modal-legal', true));
    document.getElementById('btn-legal').addEventListener('click', () => toggleModal('modal-legal', true));
    document.getElementById('btn-donar').addEventListener('click', () => toggleModal('modal-donar', true));
    document.getElementById('btn-copy-card').addEventListener('click', copiarNumeroTarjeta);
    document.getElementById('btn-enable-push').addEventListener('click', activarNotificacionesPush);
    document.getElementById('btn-export-month-push').addEventListener('click', exportarMesICS);
    document.getElementById('btn-calendar-event').addEventListener('click', guardarEventoGoogleCalendar);
    document.getElementById('btn-news').addEventListener('click', () => toggleModal('modal-novedades', true));
    
    document.querySelectorAll('input[name="theme"]').forEach((input) => {
        input.addEventListener('change', () => guardarPreferencia('theme', input.value));
    });
    document.querySelectorAll('input[name="layout"]').forEach((input) => {
        input.addEventListener('change', () => guardarPreferencia('layout', input.value));
    });
    document.querySelectorAll('[data-close-modal]').forEach((button) => {
        button.addEventListener('click', () => toggleModal(button.dataset.closeModal, false));
    });
    document.querySelectorAll('.modal-overlay').forEach((modal) => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) toggleModal(modal.id, false);
        });
    });
}

async function registrarServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
        await navigator.serviceWorker.register('./service-worker.js');
    } catch (error) {
        console.error('No se pudo registrar el almacenamiento offline:', error);
    }
}

async function obtenerJSON(ruta) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(new URL(ruta, document.baseURI), { cache: 'no-cache', signal: controller.signal });
        if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
        return { data: await response.json(), fromCache: response.headers.get('X-Offline-Cache') === 'true' };
    } finally {
        window.clearTimeout(timeout);
    }
}

function datosValidos(horarios, frases) {
    return horarios && typeof horarios === 'object' && Object.keys(horarios).length > 0 && frases && typeof frases === 'object';
}

async function cargarDatosJSON() {
    try {
        const [hResult, fResult] = await Promise.all([obtenerJSON('horarios.json'), obtenerJSON('frases.json')]);
        if (!datosValidos(hResult.data, fResult.data)) throw new Error('Formato inválido');
        horariosData = hResult.data;
        frasesData = fResult.data;
        localStorage.setItem(STORAGE_KEYS.schedules, JSON.stringify(horariosData));
        localStorage.setItem(STORAGE_KEYS.phrases, JSON.stringify(frasesData));
        if (!hResult.fromCache && !fResult.fromCache) localStorage.setItem(STORAGE_KEYS.syncedAt, new Date().toISOString());
        setDataStatus('Datos actualizados.');
    } catch (error) {
        const sHorarios = leerJSONLocal(STORAGE_KEYS.schedules);
        const sFrases = leerJSONLocal(STORAGE_KEYS.phrases);
        if (datosValidos(sHorarios, sFrases)) {
            horariosData = sHorarios;
            frasesData = sFrases;
            setDataStatus('Sin conexión: usando copia local.');
        } else {
            setDataStatus('Error al cargar los horarios.');
        }
    }
}

async function cargarVersion() {
    try {
        const result = await obtenerJSON('version.json');
        versionData = result.data;
    } catch (error) {
        versionData = leerJSONLocal(STORAGE_KEYS.version);
    }
    if (!versionData) return;
    if (versionData.url_telegram) {
        ['cover-telegram', 'donation-telegram'].forEach(id => { const el = document.getElementById(id); if (el) { el.href = versionData.url_telegram; el.hidden = false; } });
    }
    if (versionData.history) renderizarHistorial(versionData.history);
    if (compararVersiones(versionData.latest_version, APP_VERSION) > 0 && versionData.url_apk) {
        document.getElementById('update-link').href = versionData.url_apk;
        document.getElementById('update-banner').hidden = false;
    }
}

function renderizarHistorial(history) {
    const container = document.getElementById('version-history');
    if (!container) return;
    container.innerHTML = history.map(entry => `
        <article class="history-entry">
            <h4>Versión ${entry.version}</h4>
            ${entry.date ? `<p>${entry.date}</p>` : ''}
            <ul>${entry.changes.map(c => `<li>${c}</li>`).join('')}</ul>
        </article>
    `).join('');
}

function compararVersiones(l, r) {
    const p = v => String(v).split('.').map(Number);
    const a = p(l), b = p(r);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0) ? 1 : -1;
    }
    return 0;
}

function leerJSONLocal(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
function setDataStatus(m) { ['cover-data-status', 'data-status'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = m; }); }

async function actualizarDatos() {
    const btn = document.getElementById('btn-refresh');
    btn.disabled = true; btn.classList.add('spinning');
    await cargarDatosJSON();
    renderizarHorarioIfNeeded();
    btn.disabled = false; btn.classList.remove('spinning');
}

function mostrarCover() { document.getElementById('view-cover').classList.add('active'); document.getElementById('view-dashboard').classList.remove('active'); }
function mostrarDashboard() { document.getElementById('view-cover').classList.remove('active'); document.getElementById('view-dashboard').classList.add('active'); document.getElementById('current-circuit').textContent = circuitoActual; renderizarHorario(); }
function renderizarHorarioIfNeeded() { if (circuitoActual) mostrarDashboard(); else mostrarCover(); }
function selectCircuit(id) { circuitoActual = id; localStorage.setItem(STORAGE_KEYS.circuit, id); mostrarDashboard(); }
function logout() { localStorage.removeItem(STORAGE_KEYS.circuit); circuitoActual = null; mostrarCover(); }

function renderizarHorario() {
    const container = document.getElementById('contenedor-horario');
    const circuit = horariosData[circuitoActual];
    if (!circuit || !Array.isArray(circuit.semanas)) {
        container.innerHTML = '<p class="empty-state">No hay datos disponibles.</p>';
        return;
    }
    document.getElementById('current-month').textContent = `Cronograma Completo`;
    if (localStorage.getItem(STORAGE_KEYS.layout) === 'calendar') renderizarCalendario(container, circuit);
    else renderizarLista(container, circuit);
}

function renderizarLista(container, circuit) {
    const fragment = document.createDocumentFragment();
    circuit.semanas.forEach(week => {
        const card = document.createElement('section'); card.className = 'week-card';
        card.innerHTML = `<h3 class="week-title">${week.titulo}</h3>`;
        (week.dias || []).forEach(day => {
            const row = document.createElement('div'); row.className = 'day-row';
            row.innerHTML = `<p class="date-label">${day.fecha}</p>`;
            const bar = document.createElement('div'); bar.className = 'bar-container';
            (day.bloques || []).forEach(block => bar.appendChild(crearBotonBloque(block, day, week.titulo)));
            row.appendChild(bar); card.appendChild(row);
        });
        fragment.appendChild(card);
    });
    container.replaceChildren(fragment);
}

function renderizarCalendario(container, circuit) {
    const scheduleByDate = new Map();
    const availableMonths = new Set();

    circuit.semanas.forEach((week) => {
        (week.dias || []).forEach((day) => {
            const date = obtenerFechaDia(week.titulo || '', day.fecha || '');
            if (!date) return;
            
            const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            availableMonths.add(ym);
            
            const key = fechaISO(date);
            if (!scheduleByDate.has(key)) scheduleByDate.set(key, []);
            (day.bloques || []).forEach((block) => {
                scheduleByDate.get(key).push({ block, day, title: week.titulo, date });
            });
        });
    });

    const wrapper = document.createElement('div');
    wrapper.className = 'layout-calendar';

    Array.from(availableMonths).sort().forEach(ym => {
        const [year, month] = ym.split('-').map(Number);
        const monthDiv = document.createElement('div');
        monthDiv.className = 'calendar-month-container';
        
        const title = document.createElement('h3');
        title.className = 'calendar-month-title';
        title.textContent = `${MONTH_NAMES[month - 1]} ${year}`;
        monthDiv.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'calendar-grid';
        
        WEEKDAYS.forEach(w => {
            const h = document.createElement('div'); h.className = 'calendar-weekday'; h.textContent = w; grid.appendChild(h);
        });
        
        const firstDay = new Date(year, month - 1, 1);
        const offset = (firstDay.getDay() + 6) % 7;
        for (let i = 0; i < offset; i++) {
            const blank = document.createElement('div'); blank.className = 'calendar-cell is-empty'; grid.appendChild(blank);
        }
        
        const totalDays = new Date(year, month, 0).getDate();
        for (let d = 1; d <= totalDays; d++) {
            const date = new Date(year, month - 1, d);
            const cell = document.createElement('section');
            cell.className = 'calendar-cell';
            cell.innerHTML = `<p class="calendar-day">${d}</p>`;
            
            (scheduleByDate.get(fechaISO(date)) || []).forEach(item => {
                const btn = crearBotonBloque(item.block, item.day, item.title, true);
                cell.appendChild(btn);
            });
            grid.appendChild(cell);
        }
        monthDiv.appendChild(grid);
        wrapper.appendChild(monthDiv);
    });
    
    container.replaceChildren(wrapper);
}

function crearBotonBloque(block, day, weekTitle, compact = false) {
    const state = ['luz', 'apagon', 'milagro'].includes(block.estado) ? block.estado : 'apagon';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${compact ? 'calendar-block' : 'segment'} ${state}`;
    const label = state === 'luz' ? 'Corriente' : state === 'apagon' ? 'Apagón' : '24 h';
    
    if (compact) {
        const timeStr = block.hora.replace(/\s*(AM|PM)/gi, '').replace(/\s*-\s*/, '-');
        btn.textContent = timeStr;
    } else {
        const marker = state === 'luz' ? '✓' : state === 'apagon' ? '×' : '24h';
        btn.textContent = `${marker} ${block.hora} · ${label}`;
    }
    
    btn.addEventListener('click', () => abrirFrase(state, { block, day, weekTitle }));
    return btn;
}

function abrirFrase(type, eventData) {
    const options = frasesData[type];
    fraseSeleccionada = '';
    if (Array.isArray(options) && options.length) {
        const phrase = options[Math.floor(Math.random() * options.length)];
        fraseSeleccionada = phrase.autor ? `“${phrase.texto}” — ${phrase.autor}` : `“${phrase.texto}”`;
        document.getElementById('frase-texto').textContent = `“${phrase.texto}”`;
        document.getElementById('frase-autor').textContent = phrase.autor ? `— ${phrase.autor}` : '';
    } else {
        document.getElementById('frase-texto').textContent = 'Consulta el horario con frecuencia.';
        document.getElementById('frase-autor').textContent = '';
    }
    eventoSeleccionado = eventData;
    const stateLabel = type === 'luz' ? 'Corriente' : type === 'apagon' ? 'Apagón' : 'Servicio 24 h';
    document.getElementById('block-summary').textContent = `${eventData.day.fecha} · ${eventData.block.hora} · ${stateLabel}`;
    document.getElementById('calendar-status').textContent = '';
    toggleModal('modal-frase', true);
}

function toggleModal(id, visible) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.toggle('active', visible === undefined ? !modal.classList.contains('active') : visible);
}

function aplicarPreferencias() {
    const theme = localStorage.getItem(STORAGE_KEYS.theme) || 'dark';
    const layout = localStorage.getItem(STORAGE_KEYS.layout) || 'list';
    document.documentElement.dataset.theme = ['dark', 'light', 'sport', 'girl', 'funny', 'contrast'].includes(theme) ? theme : 'dark';
    syncPreferenceControls(theme, layout);
}

function syncPreferenceControls(theme = localStorage.getItem(STORAGE_KEYS.theme) || 'dark', layout = localStorage.getItem(STORAGE_KEYS.layout) || 'list') {
    document.querySelectorAll('input[name="theme"]').forEach(i => i.checked = i.value === theme);
    document.querySelectorAll('input[name="layout"]').forEach(i => i.checked = i.value === layout);
}

function guardarPreferencia(kind, value) {
    if (kind === 'theme') {
        if (!['dark', 'light', 'sport', 'girl', 'funny', 'contrast'].includes(value)) return;
        localStorage.setItem(STORAGE_KEYS.theme, value);
        document.documentElement.dataset.theme = value;
    } else {
        if (!['list', 'calendar'].includes(value)) return;
        localStorage.setItem(STORAGE_KEYS.layout, value);
        if (circuitoActual) renderizarHorario();
    }
}

function abrirRecordatorios() {
    setPushStatus('Comprobando estado...');
    const btn = document.getElementById('btn-enable-push');
    btn.textContent = 'Activar Notificaciones';
    btn.disabled = false;

    if (window.median && median.firebaseMessaging) {
        try {
            median.firebaseMessaging.getPermissionStatus({
                callback: function(result) {
                    if (result && result.granted) {
                        setPushStatus('Las notificaciones ya están activadas ✅');
                        btn.textContent = 'Notificaciones Activadas ✅';
                        btn.disabled = true;
                    } else {
                        setPushStatus('Para recibir avisos, activa las notificaciones push.');
                    }
                }
            });
        } catch (e) {
            setPushStatus('No se pudo comprobar el estado. Intenta activar manualmente.');
        }
    } else {
        setPushStatus('Las notificaciones nativas solo están disponibles en la app instalada (APK).');
        btn.textContent = 'No disponible en web';
        btn.disabled = true;
    }
    toggleModal('modal-recordatorios', true);
}

function setPushStatus(m) { const el = document.getElementById('push-status'); if (el) el.textContent = m; }

function activarNotificacionesPush() {
    const btn = document.getElementById('btn-enable-push');
    if (!window.median || !median.firebaseMessaging) {
        setPushStatus('Error: El servicio nativo no está disponible.');
        return;
    }
    btn.disabled = true;
    setPushStatus('Solicitando permiso...');

    const timeoutId = setTimeout(() => {
        if (btn.disabled) {
            btn.disabled = false;
            setPushStatus('El sistema no respondió. Revisa los permisos en los ajustes de tu teléfono.');
        }
    }, 3000);

    try {
        median.firebaseMessaging.requestPermission({
            callback: function(permission) {
                clearTimeout(timeoutId);
                btn.disabled = false;
                if (permission && permission.granted) {
                    setPushStatus('¡Notificaciones activadas! ✅');
                    btn.textContent = 'Notificaciones Activadas ✅';
                    btn.disabled = true;
                    median.firebaseMessaging.register({
                        callback: function(regResult) {
                            console.log('Token FCM obtenido:', regResult ? regResult.token : 'desconocido');
                        }
                    });
                } else {
                    setPushStatus('No se concedió el permiso. Actívalo desde los ajustes de tu teléfono.');
                }
            }
        });
    } catch (error) {
        clearTimeout(timeoutId);
        btn.disabled = false;
        setPushStatus('Error al solicitar permiso. Revisa los ajustes de Android.');
    }
}

async function copiarNumeroTarjeta() {
    const num = document.getElementById('donation-card-number').textContent.trim();
    const status = document.getElementById('copy-status');
    const btn = document.getElementById('btn-copy-card');
    try {
        await navigator.clipboard.writeText(num);
        status.textContent = 'Copiado.'; btn.textContent = 'Copiado';
    } catch { status.textContent = 'Mantén pulsado para copiar.'; btn.textContent = 'Reintentar'; }
}

function guardarEventoGoogleCalendar() {
    if (!eventoSeleccionado) return;
    const date = obtenerFechaDia(eventoSeleccionado.weekTitle, eventoSeleccionado.day.fecha);
    if (!date) { document.getElementById('calendar-status').textContent = 'Fecha inválida.'; return; }
    const time = obtenerRangoHorario(eventoSeleccionado.block.hora);
    const start = new Date(date); const end = new Date(date);
    start.setHours(time.startHour, time.startMinute, 0, 0);
    end.setDate(end.getDate() + time.endDayOffset); end.setHours(time.endHour, time.endMinute, 0, 0);
    const details = `${fraseSeleccionada}\nCircuito C-${circuitoActual}.`;
    const params = new URLSearchParams({ action: 'TEMPLATE', text: `Apagón C-${circuitoActual}`, dates: `${formatoGoogleDate(start)}/${formatoGoogleDate(end)}`, details });
    window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, '_blank');
}

function exportarMesICS() {
    if (!circuitoActual || !horariosData[circuitoActual]) {
        setPushStatus('Selecciona un circuito para exportar.');
        return;
    }
    const events = [];
    horariosData[circuitoActual].semanas.forEach(w => (w.dias||[]).forEach(d => {
        const date = obtenerFechaDia(w.titulo, d.fecha);
        if (date) (d.bloques||[]).forEach(b => { if (b.estado === 'apagon') events.push({ date, block: b }); });
    }));

    if (!events.length) { 
        setPushStatus('No hay apagones programados para exportar.'); 
        return; 
    }
    
    let ics = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Apagonia CFG//ES\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH\n";
    events.forEach((e, i) => {
        const range = obtenerRangoHorario(e.block.hora);
        const s = new Date(e.date); const en = new Date(e.date);
        s.setHours(range.startHour, range.startMinute, 0, 0);
        en.setDate(en.getDate() + range.endDayOffset); en.setHours(range.endHour, range.endMinute, 0, 0);
        ics += `BEGIN:VEVENT\nUID:${fechaISO(e.date)}-${i}@apagonia\nDTSTAMP:${formatoLocalICS(new Date())}\nDTSTART:${formatoLocalICS(s)}\nDTEND:${formatoLocalICS(en)}\nSUMMARY:Apagón C-${circuitoActual}\nEND:VEVENT\n`;
    });
    ics += "END:VCALENDAR";

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Apagonia_C${circuitoActual}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    setPushStatus('✅ Archivo descargado. Revisa tus notificaciones o la carpeta de Descargas.');
}

function obtenerFechaDia(weekTitle, dayLabel) {
    const label = dayLabel.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const title = weekTitle.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const dayMatch = label.match(/\b(\d{1,2})\b/);
    const rangeStart = title.match(/^\s*(\d{1,2})\b/);
    const dayNumber = Number(dayMatch ? dayMatch[1] : label.includes('toda la semana') && rangeStart ? rangeStart[1] : NaN);
    if (dayNumber < 1 || dayNumber > 31) return null;
    
    const monthMatches = [];
    Object.entries(MONTHS).forEach(([name, index]) => {
        const match = new RegExp(`\\b${name}\\b`, 'g');
        let found;
        while ((found = match.exec(title))) monthMatches.push({ index, position: found.index });
    });
    monthMatches.sort((a, b) => a.position - b.position);
    
    const now = new Date(); let month = now.getMonth(); let year = now.getFullYear();
    if (monthMatches.length > 1) {
        const range = title.match(/(\d{1,2})\s+(?:de\s+)?[a-z]+\s+(?:al|a)\s+(\d{1,2})\s+(?:de\s+)?[a-z]+/);
        const firstMonth = monthMatches[0];
        const secondMonth = monthMatches[monthMatches.length - 1];
        const firstDay = range ? Number(range[1]) : 1;
        month = dayNumber >= firstDay ? firstMonth.index : secondMonth.index;
    } else if (monthMatches.length === 1) {
        month = monthMatches[0].index;
    } else if (title.includes('siguiente') && dayNumber <= 7) {
        month += 1;
    }
    if (month > 11) { month -= 12; year += 1; }
    return new Date(year, month, dayNumber);
}

function obtenerRangoHorario(value) {
    if (/24\s*horas/i.test(value)) return { startHour: 0, startMinute: 0, endHour: 0, endMinute: 0, endDayOffset: 1 };
    const match = String(value).match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!match) return { startHour: 0, startMinute: 0, endHour: 23, endMinute: 59, endDayOffset: 0 };
    const start = convertirHora(match[1], match[2], match[3]);
    const end = convertirHora(match[4], match[5], match[6]);
    const offset = (end.hour < start.hour || (end.hour === start.hour && end.minute <= start.minute)) ? 1 : 0;
    return { startHour: start.hour, startMinute: start.minute, endHour: end.hour, endMinute: end.minute, endDayOffset: offset };
}

function convertirHora(h, m, mer) {
    let hour = Number(h) % 24; const minute = Number(m || 0);
    if (mer) { hour %= 12; if (mer.toUpperCase() === 'PM') hour += 12; }
    return { hour, minute };
}

function fechaISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function formatoGoogleDate(d) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`; }
function formatoLocalICS(d) { return formatoGoogleDate(d); }