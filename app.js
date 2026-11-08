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
const MONTHS = {
    enero: 0, ene: 0, febrero: 1, feb: 1, marzo: 2, mar: 2, abril: 3, abr: 3,
    mayo: 4, may: 4, junio: 5, jun: 5, julio: 6, jul: 6, agosto: 7, ago: 7,
    septiembre: 8, setiembre: 8, septiembre: 8, sept: 8, sep: 8,
    octubre: 9, oct: 9, noviembre: 10, nov: 10, diciembre: 11, dic: 11
};
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

let horariosData = {};
let frasesData = {};
let versionData = null;
let circuitoActual = localStorage.getItem(STORAGE_KEYS.circuit);
let eventoSeleccionado = null;
let fraseSeleccionada = '';

document.addEventListener('DOMContentLoaded', iniciarApp);

async function iniciarApp() {
    enlazarEventos();
    aplicarPreferencias();
    window.addEventListener('onesignal-ready', actualizarEstadoPush);
    window.addEventListener('onesignal-error', () => {
        setPushStatus('No se pudo conectar con el servicio de notificaciones. Comprueba tu conexión e inténtalo de nuevo.');
        document.getElementById('btn-enable-push').disabled = false;
    });
    await Promise.all([registrarServiceWorker(), cargarDatosJSON(), cargarVersion()]);
    renderizarHorarioIfNeeded();
    if (window.apagoniaOneSignal) actualizarEstadoPush();
    if (window.apagoniaOneSignalError) {
        setPushStatus('No se pudo conectar con el servicio de notificaciones. Comprueba tu conexión e inténtalo de nuevo.');
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
    document.getElementById('btn-legal').addEventListener('click', () => toggleModal('modal-legal', true));
    document.getElementById('link-legal-cover').addEventListener('click', (event) => {
        event.preventDefault();
        toggleModal('modal-legal', true);
    });
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
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') document.querySelectorAll('.modal-overlay.active').forEach((modal) => toggleModal(modal.id, false));
    });
}

async function registrarServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
        await navigator.serviceWorker.register('./service-worker.js');
    } catch (error) {
        console.error('No se pudo registrar el almacenamiento offline:', error);
        setDataStatus('No se pudo activar el modo offline. Comprueba que la app esté publicada por HTTPS.');
    }
}

async function obtenerJSON(ruta) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(new URL(ruta, document.baseURI), { cache: 'no-cache', signal: controller.signal });
        if (!response.ok) throw new Error(`Error HTTP ${response.status} al cargar ${ruta}`);
        return {
            data: await response.json(),
            fromCache: response.headers.get('X-Offline-Cache') === 'true'
        };
    } finally {
        window.clearTimeout(timeout);
    }
}

function datosValidos(horarios, frases) {
    return horarios && typeof horarios === 'object' && Object.keys(horarios).length > 0
        && frases && typeof frases === 'object';
}

async function cargarDatosJSON() {
    try {
        const [horariosResult, frasesResult] = await Promise.all([
            obtenerJSON('horarios.json'),
            obtenerJSON('frases.json')
        ]);
        if (!datosValidos(horariosResult.data, frasesResult.data)) throw new Error('Los archivos JSON no tienen el formato esperado.');
        horariosData = horariosResult.data;
        frasesData = frasesResult.data;
        try {
            localStorage.setItem(STORAGE_KEYS.schedules, JSON.stringify(horariosData));
            localStorage.setItem(STORAGE_KEYS.phrases, JSON.stringify(frasesData));
            if (!horariosResult.fromCache && !frasesResult.fromCache) localStorage.setItem(STORAGE_KEYS.syncedAt, new Date().toISOString());
        } catch (error) {
            console.error('No se pudieron guardar los datos descargados:', error);
        }
        if (horariosResult.fromCache || frasesResult.fromCache || !navigator.onLine) {
            const lastSync = localStorage.getItem(STORAGE_KEYS.syncedAt);
            setDataStatus(`Sin conexión: usando los datos disponibles.${lastSync ? ` Última descarga: ${formatearFecha(lastSync)}.` : ''}`);
        } else {
            setDataStatus('Datos descargados y guardados para usar sin conexión. Confirma su vigencia con el proveedor.');
        }
    } catch (error) {
        console.warn('No se pudieron descargar los datos publicados; se usará la copia local si existe:', error);
        const savedSchedules = leerJSONLocal(STORAGE_KEYS.schedules);
        const savedPhrases = leerJSONLocal(STORAGE_KEYS.phrases);
        if (datosValidos(savedSchedules, savedPhrases)) {
            horariosData = savedSchedules;
            frasesData = savedPhrases;
            const lastSync = localStorage.getItem(STORAGE_KEYS.syncedAt);
            setDataStatus(`Sin conexión: usando la última copia guardada.${lastSync ? ` Última descarga: ${formatearFecha(lastSync)}.` : ''}`);
        } else {
            horariosData = {};
            frasesData = {};
            setDataStatus('No se pudieron cargar los horarios. Conéctate a internet para descargarlos.');
        }
    }
}

async function cargarVersion() {
    try {
        const result = await obtenerJSON('version.json');
        if (!result.data || typeof result.data.latest_version !== 'string' || !Array.isArray(result.data.history)) {
            throw new Error('version.json no tiene el formato esperado.');
        }
        versionData = result.data;
        try {
            localStorage.setItem(STORAGE_KEYS.version, JSON.stringify(versionData));
        } catch (storageError) {
            console.error('No se pudo guardar version.json para uso offline:', storageError);
        }
    } catch (error) {
        console.warn('No se pudo cargar version.json:', error);
        versionData = leerJSONLocal(STORAGE_KEYS.version);
    }
    if (!versionData) return;
    establecerEnlaceTelegram(versionData.url_telegram);
    renderizarHistorial(versionData.history);
    if (compararVersiones(versionData.latest_version, APP_VERSION) > 0 && versionData.url_apk) {
        document.getElementById('update-link').href = versionData.url_apk;
        document.getElementById('update-banner').hidden = false;
    }
}

function establecerEnlaceTelegram(url) {
    if (!url) return;
    ['cover-telegram', 'donation-telegram'].forEach((id) => {
        const link = document.getElementById(id);
        link.href = url;
        link.hidden = false;
    });
}

function renderizarHistorial(history) {
    const container = document.getElementById('version-history');
    container.replaceChildren();
    history.forEach((entry) => {
        const article = document.createElement('article');
        article.className = 'history-entry';
        const title = document.createElement('h4');
        title.textContent = `Versión ${entry.version || '—'}`;
        article.appendChild(title);
        if (entry.date) {
            const date = document.createElement('p');
            date.textContent = entry.date;
            article.appendChild(date);
        }
        const list = document.createElement('ul');
        (Array.isArray(entry.changes) ? entry.changes : []).forEach((change) => {
            const item = document.createElement('li');
            item.textContent = change;
            list.appendChild(item);
        });
        article.appendChild(list);
        container.appendChild(article);
    });
}

function compararVersiones(left, right) {
    const parse = (value) => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
    const a = parse(left);
    const b = parse(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
    }
    return 0;
}

function leerJSONLocal(key) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
    } catch (error) {
        console.error(`No se pudo leer la copia local ${key}:`, error);
        return null;
    }
}

function formatearFecha(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'fecha desconocida' : date.toLocaleString('es-CU', { dateStyle: 'short', timeStyle: 'short' });
}

function setDataStatus(message) {
    ['cover-data-status', 'data-status'].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.textContent = message;
    });
}

async function actualizarDatos() {
    const button = document.getElementById('btn-refresh');
    button.disabled = true;
    button.classList.add('spinning');
    await cargarDatosJSON();
    renderizarHorarioIfNeeded();
    button.disabled = false;
    button.classList.remove('spinning');
}

function mostrarCover() {
    document.getElementById('view-cover').classList.add('active');
    document.getElementById('view-dashboard').classList.remove('active');
}

function mostrarDashboard() {
    document.getElementById('view-cover').classList.remove('active');
    document.getElementById('view-dashboard').classList.add('active');
    document.getElementById('current-circuit').textContent = circuitoActual;
    renderizarHorario();
}

function renderizarHorarioIfNeeded() {
    if (circuitoActual) mostrarDashboard();
    else mostrarCover();
}

function selectCircuit(id) {
    circuitoActual = id;
    localStorage.setItem(STORAGE_KEYS.circuit, id);
    mostrarDashboard();
}

function logout() {
    localStorage.removeItem(STORAGE_KEYS.circuit);
    circuitoActual = null;
    mostrarCover();
}

function renderizarHorario() {
    const container = document.getElementById('contenedor-horario');
    const circuit = horariosData[circuitoActual];
    if (!circuit || !Array.isArray(circuit.semanas)) {
        document.getElementById('current-month').textContent = 'Horario no disponible';
        container.innerHTML = '<p class="empty-state">No hay datos para este circuito en la copia disponible. Actualiza con internet o revisa el circuito elegido.</p>';
        return;
    }
    const now = new Date();
    document.getElementById('current-month').textContent = `${circuit.mes || 'Horario publicado'} · ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
    if (localStorage.getItem(STORAGE_KEYS.layout) === 'calendar') renderizarCalendario(container, circuit);
    else renderizarLista(container, circuit);
}

function renderizarLista(container, circuit) {
    const fragment = document.createDocumentFragment();
    circuit.semanas.forEach((week) => {
        const card = document.createElement('section');
        card.className = 'week-card';
        const title = document.createElement('h3');
        title.className = 'week-title';
        title.textContent = week.titulo || 'Semana';
        card.appendChild(title);
        (Array.isArray(week.dias) ? week.dias : []).forEach((day) => {
            const row = document.createElement('div');
            row.className = 'day-row';
            const label = document.createElement('p');
            label.className = 'date-label';
            label.textContent = day.fecha || 'Día';
            row.appendChild(label);
            const bar = document.createElement('div');
            bar.className = 'bar-container';
            (Array.isArray(day.bloques) ? day.bloques : []).forEach((block) => {
                bar.appendChild(crearBotonBloque(block, day, week.titulo));
            });
            row.appendChild(bar);
            card.appendChild(row);
        });
        fragment.appendChild(card);
    });
    container.className = '';
    container.replaceChildren(fragment);
}

function renderizarCalendario(container, circuit) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const scheduleByDate = new Map();
    circuit.semanas.forEach((week) => {
        (Array.isArray(week.dias) ? week.dias : []).forEach((day) => {
            const date = obtenerFechaDia(week.titulo || '', day.fecha || '');
            if (!date || date.getFullYear() !== year || date.getMonth() !== month) return;
            const key = fechaISO(date);
            if (!scheduleByDate.has(key)) scheduleByDate.set(key, []);
            (Array.isArray(day.bloques) ? day.bloques : []).forEach((block) => scheduleByDate.get(key).push({ block, day, title: week.titulo }));
        });
    });
    const wrapper = document.createElement('div');
    wrapper.className = 'layout-calendar';
    const grid = document.createElement('div');
    grid.className = 'calendar-grid';
    WEEKDAYS.forEach((weekday) => {
        const header = document.createElement('div');
        header.className = 'calendar-weekday';
        header.textContent = weekday;
        grid.appendChild(header);
    });
    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    for (let index = 0; index < offset; index += 1) {
        const blank = document.createElement('div');
        blank.className = 'calendar-cell is-empty';
        grid.appendChild(blank);
    }
    const totalDays = new Date(year, month + 1, 0).getDate();
    for (let dayNumber = 1; dayNumber <= totalDays; dayNumber += 1) {
        const date = new Date(year, month, dayNumber);
        const cell = document.createElement('section');
        cell.className = 'calendar-cell';
        const number = document.createElement('p');
        number.className = 'calendar-day';
        number.textContent = String(dayNumber);
        cell.appendChild(number);
        (scheduleByDate.get(fechaISO(date)) || []).forEach((item) => {
            const button = crearBotonBloque(item.block, item.day, item.title, true);
            cell.appendChild(button);
        });
        grid.appendChild(cell);
    }
    wrapper.appendChild(grid);
    container.className = '';
    container.replaceChildren(wrapper);
}

function crearBotonBloque(block, day, weekTitle, compact = false) {
    const state = ['luz', 'apagon', 'milagro'].includes(block.estado) ? block.estado : 'apagon';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${compact ? 'calendar-block' : 'segment'} ${state}`;
    const label = state === 'luz' ? 'Luz' : state === 'apagon' ? 'Apagón' : '24 h';
    button.textContent = compact ? `${block.hora || 'Horario'} · ${label}` : `${block.hora || 'Horario'} ${label}`;
    button.setAttribute('aria-label', `${day.fecha || 'Día'}, ${block.hora || 'horario'}: ${label}`);
    button.addEventListener('click', () => abrirFrase(state, { block, day, weekTitle }));
    return button;
}

function abrirFrase(type, eventData) {
    const options = frasesData[type];
    fraseSeleccionada = '';
    if (Array.isArray(options) && options.length) {
        const phrase = options[Math.floor(Math.random() * options.length)];
        fraseSeleccionada = phrase.autor ? `“${phrase.texto || ''}” — ${phrase.autor}` : `“${phrase.texto || ''}”`;
        document.getElementById('frase-texto').textContent = `“${phrase.texto || ''}”`;
        document.getElementById('frase-autor').textContent = phrase.autor ? `— ${phrase.autor}` : '';
    } else {
        document.getElementById('frase-texto').textContent = type === 'apagon'
            ? 'Consulta el horario con frecuencia: puede cambiar según las condiciones del servicio.'
            : 'Aprovecha este momento y mantente al tanto de las actualizaciones.';
        document.getElementById('frase-autor').textContent = '';
    }
    eventoSeleccionado = eventData;
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
    document.documentElement.dataset.theme = ['dark', 'light', 'contrast'].includes(theme) ? theme : 'dark';
    syncPreferenceControls(theme, layout);
}

function syncPreferenceControls(theme = localStorage.getItem(STORAGE_KEYS.theme) || 'dark', layout = localStorage.getItem(STORAGE_KEYS.layout) || 'list') {
    document.querySelectorAll('input[name="theme"]').forEach((input) => { input.checked = input.value === theme; });
    document.querySelectorAll('input[name="layout"]').forEach((input) => { input.checked = input.value === layout; });
}

function guardarPreferencia(kind, value) {
    if (kind === 'theme') {
        if (!['dark', 'light', 'contrast'].includes(value)) return;
        localStorage.setItem(STORAGE_KEYS.theme, value);
        document.documentElement.dataset.theme = value;
    } else {
        if (!['list', 'calendar'].includes(value)) return;
        localStorage.setItem(STORAGE_KEYS.layout, value);
        if (circuitoActual) renderizarHorario();
    }
}

function abrirRecordatorios() {
    actualizarEstadoPush();
    toggleModal('modal-recordatorios', true);
}

function actualizarEstadoPush() {
    const oneSignal = window.apagoniaOneSignal;
    const button = document.getElementById('btn-enable-push');
    if (!oneSignal) {
        setPushStatus('Las notificaciones push no están disponibles todavía. Comprueba tu conexión y vuelve a intentarlo.');
        button.textContent = 'Activar Notificaciones';
        return;
    }
    const enabled = oneSignal.Notifications.permission === true;
    button.textContent = enabled ? 'Notificaciones Activadas ✅' : 'Activar Notificaciones';
    setPushStatus(enabled
        ? 'Las notificaciones están activadas en este dispositivo.'
        : 'Para recibir avisos, permite las notificaciones push cuando el teléfono lo solicite.');
}

function setPushStatus(message) {
    const element = document.getElementById('push-status');
    if (element) element.textContent = message;
}

function activarNotificacionesPush() {
    const button = document.getElementById('btn-enable-push');
    if (window.apagoniaOneSignalError) {
        setPushStatus('No se pudo conectar con el servicio de notificaciones. Comprueba tu conexión e inténtalo de nuevo.');
        return;
    }
    button.disabled = true;
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (oneSignal) => {
        try {
            if (oneSignal.Notifications.permission === true) {
                setPushStatus('Las notificaciones ya están activadas ✅');
                button.textContent = 'Notificaciones Activadas ✅';
                return;
            }
            await oneSignal.Notifications.requestPermission();
            actualizarEstadoPush();
            if (oneSignal.Notifications.permission !== true) {
                setPushStatus('No se activaron las notificaciones. Revisa los permisos del navegador o del teléfono.');
            }
        } catch (error) {
            console.error('No se pudo solicitar permiso para las notificaciones push:', error);
            setPushStatus('No se pudo activar el permiso. Comprueba la conexión y los ajustes de notificaciones del dispositivo.');
        } finally {
            button.disabled = false;
        }
    });
}

async function copiarNumeroTarjeta() {
    const number = document.getElementById('donation-card-number').textContent.trim();
    const status = document.getElementById('copy-status');
    const button = document.getElementById('btn-copy-card');
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(number);
        } else {
            const field = document.createElement('textarea');
            field.value = number;
            field.setAttribute('readonly', '');
            field.style.position = 'fixed';
            field.style.opacity = '0';
            document.body.appendChild(field);
            field.select();
            const copied = document.execCommand('copy');
            field.remove();
            if (!copied) throw new Error('El dispositivo no permitió copiar el número.');
        }
        status.textContent = 'Número copiado.';
        button.textContent = 'Copiado';
    } catch (error) {
        console.error('No se pudo copiar el número de tarjeta:', error);
        status.textContent = 'No se pudo copiar automáticamente. Mantén pulsado el número para copiarlo.';
        button.textContent = 'Reintentar';
    }
}

function guardarEventoGoogleCalendar() {
    if (!eventoSeleccionado) return;
    const date = obtenerFechaDia(eventoSeleccionado.weekTitle || '', eventoSeleccionado.day.fecha || '');
    if (!date) {
        document.getElementById('calendar-status').textContent = 'No se pudo interpretar la fecha de este bloque; revisa el cronograma antes de guardarlo.';
        return;
    }
    const time = obtenerRangoHorario(eventoSeleccionado.block.hora || '');
    const start = new Date(date);
    const end = new Date(date);
    start.setHours(time.startHour, time.startMinute, 0, 0);
    end.setDate(end.getDate() + time.endDayOffset);
    end.setHours(time.endHour, time.endMinute, 0, 0);
    const details = `${fraseSeleccionada ? `${fraseSeleccionada}\n\n` : ''}Circuito C-${circuitoActual}. Estado: ${eventoSeleccionado.block.estado || 'apagón'}. Horario publicado sujeto a cambios.`;
    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: `Horario de apagón · C-${circuitoActual}`,
        dates: `${formatoGoogleDate(start)}/${formatoGoogleDate(end)}`,
        details
    });
    window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, '_blank');
}

function exportarMesICS() {
    if (!circuitoActual || !horariosData[circuitoActual]) {
        setPushStatus('Selecciona un circuito para exportar su cronograma.');
        return;
    }
    const now = new Date();
    const events = obtenerEventosMes(now.getFullYear(), now.getMonth())
        .filter((entry) => entry.block.estado === 'apagon');
    if (!events.length) {
        setPushStatus('No hay apagones con fecha concreta para exportar en este mes.');
        return;
    }
    const stamp = formatoUTC(new Date());
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Apagonia CFG//Horarios de apagones//ES',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH'
    ];
    events.forEach((entry, index) => {
        const range = obtenerRangoHorario(entry.block.hora || '');
        const start = new Date(entry.date);
        const end = new Date(entry.date);
        start.setHours(range.startHour, range.startMinute, 0, 0);
        end.setDate(end.getDate() + range.endDayOffset);
        end.setHours(range.endHour, range.endMinute, 0, 0);
        lines.push(
            'BEGIN:VEVENT',
            `UID:${fechaISO(entry.date)}-${circuitoActual}-${index}@apagonia-cfg`,
            `DTSTAMP:${stamp}`,
            `DTSTART:${formatoLocalICS(start)}`,
            `DTEND:${formatoLocalICS(end)}`,
            `SUMMARY:${escaparICS(`Apagón · C-${circuitoActual}`)}`,
            `DESCRIPTION:${escaparICS(`${entry.block.hora || 'Horario'} · ${entry.day.fecha || ''}. Confirma la vigencia del cronograma.`)}`,
            'END:VEVENT'
        );
    });
    lines.push('END:VCALENDAR');
    const dataUri = `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
    window.location.href = dataUri;
}

function obtenerEventosMes(year, month) {
    const circuit = horariosData[circuitoActual];
    const events = [];
    if (!circuit || !Array.isArray(circuit.semanas)) return events;
    circuit.semanas.forEach((week) => {
        (Array.isArray(week.dias) ? week.dias : []).forEach((day) => {
            const date = obtenerFechaDia(week.titulo || '', day.fecha || '');
            if (!date || date.getFullYear() !== year || date.getMonth() !== month) return;
            (Array.isArray(day.bloques) ? day.bloques : []).forEach((block) => events.push({ date, day, block }));
        });
    });
    return events;
}

function obtenerFechaDia(weekTitle, dayLabel) {
    const label = normalizarTexto(dayLabel);
    const dayMatch = String(dayLabel).match(/\b(\d{1,2})\b/);
    const title = normalizarTexto(weekTitle);
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
    const now = new Date();
    let month = now.getMonth();
    let year = now.getFullYear();
    if (monthMatches.length > 1) {
        const rangeStart = title.match(/(\d{1,2})\s+(?:de\s+)?[a-z]+\s+(?:al|a)\s+(\d{1,2})\s+(?:de\s+)?[a-z]+/);
        const firstMonth = monthMatches[0];
        const secondMonth = monthMatches[monthMatches.length - 1];
        const firstDay = rangeStart ? Number(rangeStart[1]) : 1;
        month = dayNumber >= firstDay ? firstMonth.index : secondMonth.index;
    } else if (monthMatches.length === 1) {
        month = monthMatches[0].index;
    } else if (title.includes('siguiente') && dayNumber <= 7) {
        month += 1;
    }
    if (month > 11) {
        month -= 12;
        year += 1;
    }
    return new Date(year, month, dayNumber);
}

function normalizarTexto(value) {
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function obtenerRangoHorario(value) {
    if (/24\s*horas/i.test(value)) return { startHour: 0, startMinute: 0, endHour: 0, endMinute: 0, endDayOffset: 1 };
    const match = String(value).match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!match) return { startHour: 0, startMinute: 0, endHour: 23, endMinute: 59, endDayOffset: 0 };
    const start = convertirHora(match[1], match[2], match[3]);
    const end = convertirHora(match[4], match[5], match[6]);
    let endDayOffset = 0;
    if (end.hour < start.hour || (end.hour === start.hour && end.minute <= start.minute)) endDayOffset = 1;
    return { startHour: start.hour, startMinute: start.minute, endHour: end.hour, endMinute: end.minute, endDayOffset };
}

function convertirHora(hourValue, minuteValue, meridiem) {
    let hour = Number(hourValue) % 24;
    const minute = Number(minuteValue || 0);
    if (meridiem) {
        const suffix = meridiem.toUpperCase();
        hour %= 12;
        if (suffix === 'PM') hour += 12;
    }
    return { hour, minute };
}

function fechaISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatoGoogleDate(date) {
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}00`;
}

function formatoLocalICS(date) {
    return formatoGoogleDate(date);
}

function formatoUTC(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escaparICS(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
