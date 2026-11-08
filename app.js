const STORAGE_KEYS = {
    circuit: 'circuitoSeleccionado',
    schedules: 'horariosOffline',
    phrases: 'frasesOffline',
    syncedAt: 'datosSincronizadosEn',
    notificationEnabled: 'recordatoriosActivos',
    notificationTime: 'horaRecordatorio',
    notificationPhrase: 'fraseEnRecordatorio',
    lastNotification: 'ultimaNotificacion'
};

let horariosData = {};
let frasesData = {};
let circuitoActual = localStorage.getItem(STORAGE_KEYS.circuit);

document.addEventListener('DOMContentLoaded', iniciarApp);

async function iniciarApp() {
    document.querySelectorAll('[data-circuit]').forEach((button) => {
        button.addEventListener('click', () => selectCircuit(button.dataset.circuit));
    });
    document.getElementById('btn-back').addEventListener('click', logout);
    document.getElementById('btn-refresh').addEventListener('click', actualizarDatos);
    document.getElementById('btn-noti').addEventListener('click', abrirConfiguracionNotificaciones);
    document.getElementById('btn-donar').addEventListener('click', () => toggleModal('modal-donar'));
    document.getElementById('btn-copy-card').addEventListener('click', copiarNumeroTarjeta);
    document.getElementById('btn-save-noti').addEventListener('click', guardarConfiguracionNotificaciones);
    document.querySelectorAll('[data-close-modal]').forEach((button) => {
        button.addEventListener('click', () => toggleModal(button.dataset.closeModal, false));
    });
    document.querySelectorAll('.modal-overlay').forEach((modal) => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) toggleModal(modal.id, false);
        });
    });

    await registrarServiceWorker();
    await cargarDatosJSON();
    configurarEstadoNotificaciones();

    if (circuitoActual) mostrarDashboard();
    else mostrarCover();

    window.setInterval(comprobarRecordatorio, 30000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) comprobarRecordatorio();
    });
}

async function registrarServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!window.isSecureContext) return;

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
        const response = await fetch(new URL(ruta, document.baseURI), {
            cache: 'no-cache',
            signal: controller.signal
        });
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
        const horarios = horariosResult.data;
        const frases = frasesResult.data;
        if (!datosValidos(horarios, frases)) throw new Error('Los archivos de datos no tienen el formato esperado.');

        horariosData = horarios;
        frasesData = frases;
        try {
            localStorage.setItem(STORAGE_KEYS.schedules, JSON.stringify(horarios));
            localStorage.setItem(STORAGE_KEYS.phrases, JSON.stringify(frases));
            if (!horariosResult.fromCache && !frasesResult.fromCache) {
                localStorage.setItem(STORAGE_KEYS.syncedAt, new Date().toISOString());
            }
        } catch (error) {
            console.error('No se pudieron guardar los datos descargados:', error);
            setDataStatus('Horario actualizado, pero no se pudo guardar una copia offline en este dispositivo.');
            return;
        }
        if (horariosResult.fromCache || frasesResult.fromCache || !navigator.onLine) {
            const fecha = localStorage.getItem(STORAGE_KEYS.syncedAt);
            const etiquetaFecha = fecha ? ` Última conexión: ${formatearFecha(fecha)}.` : '';
            setDataStatus(`Sin conexión: usando la copia guardada para este dispositivo.${etiquetaFecha}`);
        } else {
            setDataStatus('Datos descargados y guardados para usar sin conexión. Confirma su vigencia con el proveedor.');
        }
    } catch (error) {
        console.warn('No se pudieron descargar los datos publicados:', error);
        const horariosGuardados = leerJSONLocal(STORAGE_KEYS.schedules);
        const frasesGuardadas = leerJSONLocal(STORAGE_KEYS.phrases);

        if (datosValidos(horariosGuardados, frasesGuardadas)) {
            horariosData = horariosGuardados;
            frasesData = frasesGuardadas;
            const fecha = localStorage.getItem(STORAGE_KEYS.syncedAt);
            const etiquetaFecha = fecha ? ` Última descarga: ${formatearFecha(fecha)}.` : '';
            setDataStatus(`Sin conexión: usando la última copia guardada.${etiquetaFecha}`);
        } else {
            horariosData = {};
            frasesData = {};
            setDataStatus('No se pudieron cargar los horarios. Abre la app con internet para descargarlos.');
        }
    }
}

function leerJSONLocal(clave) {
    try {
        const valor = localStorage.getItem(clave);
        return valor ? JSON.parse(valor) : null;
    } catch (error) {
        console.error(`La copia local "${clave}" no se pudo leer:`, error);
        return null;
    }
}

function formatearFecha(fecha) {
    const valor = new Date(fecha);
    return Number.isNaN(valor.getTime())
        ? 'fecha desconocida'
        : valor.toLocaleString('es-CU', { dateStyle: 'short', timeStyle: 'short' });
}

function setDataStatus(mensaje) {
    ['cover-data-status', 'data-status'].forEach((id) => {
        const elemento = document.getElementById(id);
        if (elemento) elemento.textContent = mensaje;
    });
}

async function actualizarDatos() {
    const button = document.getElementById('btn-refresh');
    button.disabled = true;
    button.classList.add('spinning');
    await cargarDatosJSON();
    if (circuitoActual) renderizarHorario();
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
    const contenedor = document.getElementById('contenedor-horario');
    const dataCircuito = horariosData[circuitoActual];

    if (!dataCircuito || !Array.isArray(dataCircuito.semanas)) {
        document.getElementById('current-month').textContent = 'Horario no disponible';
        contenedor.innerHTML = '<p class="empty-state">No hay datos para este circuito en la copia disponible. Actualiza con internet o revisa el circuito elegido.</p>';
        return;
    }

    document.getElementById('current-month').textContent = dataCircuito.mes || 'Horario publicado';
    const fragment = document.createDocumentFragment();

    dataCircuito.semanas.forEach((semana) => {
        const tarjeta = document.createElement('section');
        tarjeta.className = 'week-card';
        const titulo = document.createElement('h3');
        titulo.className = 'week-title';
        titulo.textContent = semana.titulo || 'Semana';
        tarjeta.appendChild(titulo);

        (Array.isArray(semana.dias) ? semana.dias : []).forEach((dia) => {
            const fila = document.createElement('div');
            fila.className = 'day-row';
            const fecha = document.createElement('p');
            fecha.className = 'date-label';
            fecha.textContent = dia.fecha || 'Día';
            fila.appendChild(fecha);

            const barra = document.createElement('div');
            barra.className = 'bar-container';
            (Array.isArray(dia.bloques) ? dia.bloques : []).forEach((bloque) => {
                const estado = ['luz', 'apagon', 'milagro'].includes(bloque.estado) ? bloque.estado : 'apagon';
                const segmento = document.createElement('button');
                segmento.type = 'button';
                segmento.className = `segment ${estado}`;
                segmento.dataset.estado = estado;
                segmento.addEventListener('click', () => abrirFrase(estado));
                segmento.append(document.createTextNode(bloque.hora || 'Horario'));

                const etiqueta = document.createElement('span');
                etiqueta.textContent = estado === 'luz' ? 'Luz' : estado === 'apagon' ? 'Apagón' : '24 h';
                segmento.appendChild(etiqueta);
                barra.appendChild(segmento);
            });
            fila.appendChild(barra);
            tarjeta.appendChild(fila);
        });
        fragment.appendChild(tarjeta);
    });

    contenedor.replaceChildren(fragment);
}

function abrirFrase(tipo) {
    const lista = frasesData[tipo];
    if (!Array.isArray(lista) || lista.length === 0) return;
    const frase = lista[Math.floor(Math.random() * lista.length)];
    document.getElementById('frase-texto').textContent = `“${frase.texto || ''}”`;
    document.getElementById('frase-autor').textContent = frase.autor ? `— ${frase.autor}` : '';
    toggleModal('modal-frase', true);
}

function toggleModal(id, visible) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.toggle('active', visible === undefined ? !modal.classList.contains('active') : visible);
}

async function copiarNumeroTarjeta() {
    const numero = document.getElementById('donation-card-number').textContent.trim();
    const estado = document.getElementById('copy-status');
    const boton = document.getElementById('btn-copy-card');

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(numero);
        } else {
            const campo = document.createElement('textarea');
            campo.value = numero;
            campo.setAttribute('readonly', '');
            campo.style.position = 'fixed';
            campo.style.opacity = '0';
            document.body.appendChild(campo);
            campo.select();
            const copiado = document.execCommand('copy');
            campo.remove();
            if (!copiado) throw new Error('El dispositivo no permitió copiar el número.');
        }
        estado.textContent = 'Número copiado.';
        boton.textContent = 'Copiado';
    } catch (error) {
        console.error('No se pudo copiar el número de tarjeta:', error);
        estado.textContent = 'No se pudo copiar automáticamente. Mantén pulsado el número para copiarlo.';
        boton.textContent = 'Reintentar';
    }
}

function abrirConfiguracionNotificaciones() {
    document.getElementById('noti-hora').value = localStorage.getItem(STORAGE_KEYS.notificationTime) || '07:00';
    document.getElementById('noti-frase').checked = localStorage.getItem(STORAGE_KEYS.notificationPhrase) !== 'false';
    document.getElementById('noti-activa').checked = localStorage.getItem(STORAGE_KEYS.notificationEnabled) === 'true';
    configurarEstadoNotificaciones();
    toggleModal('modal-config', true);
}

async function guardarConfiguracionNotificaciones() {
    const hora = document.getElementById('noti-hora').value;
    const activar = document.getElementById('noti-activa').checked;
    const incluirFrase = document.getElementById('noti-frase').checked;

    if (!hora) {
        setNotificationStatus('Selecciona una hora válida para el recordatorio.');
        return;
    }
    localStorage.setItem(STORAGE_KEYS.notificationTime, hora);
    localStorage.setItem(STORAGE_KEYS.notificationPhrase, String(incluirFrase));

    if (!activar) {
        localStorage.setItem(STORAGE_KEYS.notificationEnabled, 'false');
        configurarEstadoNotificaciones();
        setNotificationStatus('Recordatorio diario desactivado.');
        return;
    }

    if (!('Notification' in window)) {
        document.getElementById('noti-activa').checked = false;
        localStorage.setItem(STORAGE_KEYS.notificationEnabled, 'false');
        setNotificationStatus('Este navegador o contenedor no ofrece notificaciones web. Configura notificaciones locales en Median.co para avisos con la app cerrada.');
        return;
    }

    let permission = Notification.permission;
    try {
        if (permission === 'default') permission = await Notification.requestPermission();
    } catch (error) {
        document.getElementById('noti-activa').checked = false;
        localStorage.setItem(STORAGE_KEYS.notificationEnabled, 'false');
        setNotificationStatus(`No se pudo solicitar permiso para notificar: ${error.message || 'error del navegador'}`);
        return;
    }
    if (permission !== 'granted') {
        document.getElementById('noti-activa').checked = false;
        localStorage.setItem(STORAGE_KEYS.notificationEnabled, 'false');
        setNotificationStatus(permission === 'denied'
            ? 'Permiso denegado. Habilita las notificaciones en los ajustes del navegador o del teléfono.'
            : 'No se concedió permiso para las notificaciones.');
        return;
    }

    localStorage.setItem(STORAGE_KEYS.notificationEnabled, 'true');
    configurarEstadoNotificaciones();
    setNotificationStatus(`Recordatorio activado para las ${hora}. Se enviará cuando la app esté abierta.`);
    comprobarRecordatorio();
}

function configurarEstadoNotificaciones() {
    const activas = localStorage.getItem(STORAGE_KEYS.notificationEnabled) === 'true';
    document.getElementById('btn-noti').classList.toggle('is-active', activas);
}

function setNotificationStatus(mensaje) {
    document.getElementById('noti-ayuda').textContent = mensaje;
}

function comprobarRecordatorio() {
    if (document.hidden || localStorage.getItem(STORAGE_KEYS.notificationEnabled) !== 'true') return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const ahora = new Date();
    const horaElegida = localStorage.getItem(STORAGE_KEYS.notificationTime) || '07:00';
    const horaActual = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
    const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
    if (horaActual < horaElegida || localStorage.getItem(STORAGE_KEYS.lastNotification) === hoy) return;

    localStorage.setItem(STORAGE_KEYS.lastNotification, hoy);
    enviarNotificacion(`Horario del circuito C-${circuitoActual || 'seleccionado'}`, obtenerMensajeNotificacion(ahora))
        .catch((error) => {
            localStorage.removeItem(STORAGE_KEYS.lastNotification);
            console.error('No se pudo mostrar el recordatorio:', error);
            setNotificationStatus(`No se pudo mostrar el aviso: ${error.message || 'error de notificación'}`);
        });
}

function obtenerMensajeNotificacion(fecha) {
    const partes = [];
    if (localStorage.getItem(STORAGE_KEYS.notificationPhrase) !== 'false') {
        const todas = Object.values(frasesData).flatMap((lista) => Array.isArray(lista) ? lista : []);
        if (todas.length) {
            const frase = todas[Math.floor(Math.random() * todas.length)];
            partes.push(frase.autor ? `“${frase.texto}” — ${frase.autor}` : `“${frase.texto}”`);
        }
    }

    const bloques = buscarBloquesDeHoy(fecha);
    if (bloques) {
        partes.push(`Hoy: ${bloques.map((bloque) => {
            const estado = bloque.estado === 'luz' ? 'luz' : bloque.estado === 'milagro' ? '24 h de servicio' : 'apagón';
            return `${bloque.hora} ${estado}`;
        }).join('; ')}.`);
    } else {
        partes.push('Consulta en la app el horario descargado para hoy; los datos pueden cambiar.');
    }
    return partes.join(' ');
}

function buscarBloquesDeHoy(fecha) {
    const circuito = horariosData[circuitoActual];
    if (!circuito || !Array.isArray(circuito.semanas)) return null;
    const numeroDia = String(fecha.getDate());
    const nombreDia = new Intl.DateTimeFormat('es', { weekday: 'long' }).format(fecha);
    const mesActual = normalizarTexto(new Intl.DateTimeFormat('es', { month: 'long' }).format(fecha));

    for (const semana of circuito.semanas) {
        const titulo = normalizarTexto(semana.titulo || '');
        if (!titulo.includes('del mes') && !tituloIncluyeMes(titulo, mesActual)) continue;
        for (const dia of semana.dias || []) {
            const etiqueta = normalizarTexto(dia.fecha || '');
            const coincideDia = new RegExp(`\\b${numeroDia}\\b`).test(etiqueta);
            if (coincideDia && etiqueta.includes(normalizarTexto(nombreDia))) return dia.bloques || [];
        }
    }
    return null;
}

function tituloIncluyeMes(titulo, mes) {
    const variantes = {
        enero: ['enero', 'ene'],
        febrero: ['febrero', 'feb'],
        marzo: ['marzo', 'mar'],
        abril: ['abril', 'abr'],
        mayo: ['mayo', 'may'],
        junio: ['junio', 'jun'],
        julio: ['julio', 'jul'],
        agosto: ['agosto', 'ago'],
        septiembre: ['septiembre', 'setiembre', 'sept', 'sep'],
        octubre: ['octubre', 'oct'],
        noviembre: ['noviembre', 'nov'],
        diciembre: ['diciembre', 'dic']
    };
    return (variantes[mes] || [mes]).some((variante) => new RegExp(`\\b${variante}\\b`).test(titulo));
}

function normalizarTexto(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

async function enviarNotificacion(titulo, cuerpo) {
    if ('serviceWorker' in navigator) {
        const registro = await navigator.serviceWorker.ready;
        if (registro.showNotification) {
            await registro.showNotification(titulo, { body: cuerpo, icon: './images.png', badge: './images.png' });
            return;
        }
    }
    new Notification(titulo, { body: cuerpo, icon: './images.png' });
}
