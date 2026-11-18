"use strict";

const E = window.ExamEngine;
const bank = E.buildBank(window.questionBatches);
const sources = new Map(window.sourceInventory.map((source) => [source.id, source]));
const lookup = E.byId(bank);
const modes = new Map(E.modes.map(([key, name, description]) => [key, { name, description }]));
const subjects = [...new Set(bank.map((q) => q.subject))];
const topics = [...new Map(bank.map((q) => [E.topicKey(q), q])).values()];
const concepts = [...new Map(bank.map((q) => [E.conceptKey(q), q])).values()];
const screen = document.querySelector("#screen");
const notice = document.querySelector("#notice");
const storageKey = "practica-ia-exam-v1";
const dark = matchMedia("(prefers-color-scheme: dark)");
const config = { mode: "general", subject: subjects[0], topic: E.topicKey(topics[0]), timer: 0 };
let state = E.empty();
let storageProblem = "";
let fallback = null;
let resetDialog;

const esc = (v) => String(v).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const pct = (v) => v === null ? "Sin datos" : v + " %";
const date = (v) => new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(v);
const formatTime = (ms) => {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
};
const displayRate = (stats) => pct(stats.count ? Math.round(100 * stats.hits / stats.count) : null);
const examined = (answers) => [...new Set(answers.map(({ id }) => E.topicKey(lookup.get(id))))];

try {
  const saved = localStorage.getItem(storageKey);
  if (saved) state = E.restore(JSON.parse(saved), bank);
} catch {
  storageProblem = "No se pudo leer el progreso guardado. Puedes recuperar una copia JSON desde Progreso.";
}

function announce(message = "") {
  notice.textContent = [storageProblem, message].filter(Boolean).join(" ");
  notice.hidden = !notice.textContent;
}

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    storageProblem = "";
  } catch {
    storageProblem = "El navegador no pudo guardar el progreso. Exporta una copia JSON antes de cerrar la página.";
  }
  announce();
}

function theme() {
  const value = state.theme || (dark.matches ? "dark" : "light");
  document.documentElement.dataset.theme = value;
  document.querySelector("#theme").textContent = value === "dark" ? "Modo claro" : "Modo oscuro";
}

function intro(title, lead) {
  return `<header class="intro"><h1 tabindex="-1">${esc(title)}</h1><p class="lead">${esc(lead)}</p></header>`;
}

function metric(value, label) {
  return `<div><strong class="metric-value">${esc(value)}</strong><span class="small muted">${esc(label)}</span></div>`;
}

function progress(value, max, label) {
  return `<progress value="${value}" max="${max}" aria-label="${esc(label)}"></progress>`;
}

function activePrompt() {
  if (!state.active) return "";
  return `<section class="callout">
    <strong>Examen en curso</strong>
    <p class="small">${esc(modes.get(state.active.mode).name)} · ${state.active.answers.length} de 10 respuestas registradas</p>
    <div class="actions">
      <a class="button primary" href="#examen">Continuar examen</a>
      <button class="button" data-action="abandon">Abandonar examen</button>
    </div>
  </section>`;
}

function home() {
  const stats = E.summarize(bank, state);
  const shown = E.eligible(bank, config, stats).length;
  return intro("Practica para el examen", "Responde 10 preguntas por sesión y revisa la explicación antes de pasar a la siguiente.") +
    activePrompt() + `<div class="split">
      <section class="box">
        <h2>Configura tu práctica</h2>
        <form id="setup">
          <div class="field">
            <label for="mode">Modo de estudio</label>
            <select id="mode" name="mode" aria-describedby="mode-help">${E.modes.map(([id, title]) =>
              `<option value="${id}" ${config.mode === id ? "selected" : ""}>${esc(title)}</option>`).join("")}</select>
            <p id="mode-help" class="small muted mode-help">${esc(modes.get(config.mode).description)}</p>
          </div>
          ${["subject", "topic"].includes(config.mode) ? `<div class="field">
            <label for="subject">Materia</label>
            <select id="subject" name="subject">${subjects.map((subject) => `<option ${config.subject === subject ? "selected" : ""}>${esc(subject)}</option>`).join("")}</select>
          </div>` : ""}
          ${config.mode === "topic" ? `<div class="field">
            <label for="topic">Tema</label>
            <select id="topic" name="topic">${topics.filter((q) => q.subject === config.subject).map((q) =>
              `<option value="${esc(E.topicKey(q))}" ${config.topic === E.topicKey(q) ? "selected" : ""}>${esc(q.topic)}</option>`).join("")}</select>
          </div>` : ""}
          ${config.mode === "mock" ? `<div class="field">
            <label for="timer">Límite orientativo</label>
            <select id="timer" name="timer" aria-describedby="timer-help">${[0, 5, 10, 15, 20, 30].map((n) =>
              `<option value="${n}" ${config.timer === n ? "selected" : ""}>${n ? n + " minutos" : "Sin temporizador"}</option>`).join("")}</select>
            <p id="timer-help" class="small muted">Al terminar el tiempo podrás seguir respondiendo y leer las explicaciones.</p>
          </div>` : ""}
          <p class="small muted">${shown} preguntas disponibles en este modo.</p>
          <div class="actions"><button type="submit" class="button primary" ${state.active ? "disabled" : ""}>Iniciar examen</button></div>
        </form>
        ${fallback !== null ? `<div class="callout section" id="limited" tabindex="-1">
          <strong>Hay ${fallback} preguntas que cumplen la selección.</strong>
          <p>El examen requiere 10. Puedes completar la sesión con preguntas del banco general.</p>
          <div class="actions"><button class="button" data-action="fallback" ${bank.length < E.size ? "disabled" : ""}>Completar con el banco general</button></div>
        </div>` : ""}
      </section>
      <section class="box">
        <h2>Avance de estudio</h2>
        <div class="stat-line"><span>Banco practicado</span><strong>${stats.questions.size} / ${bank.length}</strong></div>
        ${progress(stats.questions.size, bank.length, "Preguntas distintas respondidas")}
        <div class="metrics">
          ${metric(stats.exams, "Exámenes completos")}
          ${metric(displayRate(stats), "Aciertos históricos")}
          ${metric(bank.length - stats.questions.size, "Preguntas pendientes")}
          ${metric(topics.length, "Temas disponibles")}
        </div>
        <a href="#progreso">Ver mi progreso</a>
      </section>
    </div>`;
}

function referenceList(q) {
  return `<ul class="sources">${q.refs.map(({ sourceId, location }) => {
    const src = sources.get(sourceId);
    let url = src.sections?.[location] || src.url || src.file;
    let locator = location;
    if (src.kind === "PDF") {
      const page = location.match(/^\d+/)?.[0];
      url += page ? "#page=" + page : "";
      locator = "pág. " + location;
    }
    if (src.kind === "Video") {
      const [minutes, seconds] = location.split(/[–,]/)[0].split(":").map(Number);
      if (Number.isFinite(minutes + seconds)) url += "&t=" + (minutes * 60 + seconds) + "s";
    }
    return `<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(src.title)}</a>
      <span> · ${esc(locator)}${src.origin === "Complementaria" ? " · Complementaria" : ""}</span></li>`;
  }).join("")}</ul>`;
}

function feedback(q, choice) {
  const incorrect = q.distractorNotes[choice];
  return `<p>${esc(q.explanation)}</p>
    ${choice !== q.correct && incorrect ? `<p><strong>Tu error:</strong> ${esc(incorrect)}</p>` : ""}
    ${q.distractorNotes.some(Boolean) ? `<details><summary>Revisar las otras opciones</summary><ul>
      ${q.distractorNotes.map((note, i) => note && i !== q.correct ? `<li><strong>${esc(q.options[i])}</strong> · ${esc(note)}</li>` : "").join("")}
    </ul></details>` : ""}
    <strong class="small">Fuentes</strong>${referenceList(q)}`;
}

function exam(session) {
  const item = session.items[session.index];
  const q = lookup.get(item.id);
  const selected = session.answers[session.index];
  const final = session.index === E.size - 1;
  return `<div class="exam">
    <header class="exam-top">
      <div class="exam-meta"><strong>Pregunta ${session.index + 1} de ${E.size}</strong>
      <span class="meta">${esc(modes.get(session.mode).name)}${session.fallback ? " · Banco general incluido" : ""}</span>
      ${session.timer ? '<span class="timer" id="timer-display" aria-label="Tiempo del simulacro"></span>' : ""}</div>
      ${progress(session.index + 1, E.size, "Posición de la pregunta")}
      <p id="timer-expired" class="small" role="status" hidden>Tiempo cumplido. Puedes continuar.</p>
    </header>
    <article class="box question">
      <p class="meta">${esc(q.subject)} · ${esc(q.topic)} · ${esc(E.difficulties[q.level])}</p>
      <h1 tabindex="-1">${esc(q.stem)}</h1>
      <div class="answers" aria-label="Opciones de respuesta">${item.order.map((choice, index) => {
        const status = selected && (q.correct === choice ? (selected.ok ? "Tu respuesta · Correcta" : "Respuesta correcta") :
          selected.choice === choice ? "Tu respuesta · Incorrecta" : "");
        const style = status && (q.correct === choice ? "correct" : "wrong");
        return `<button class="option ${style || ""}" data-choice="${choice}" ${selected ? "disabled" : ""}>
          <span class="letter" aria-hidden="true">${"ABCD"[index]}</span>
          <span>${esc(q.options[choice])}${status ? `<strong>${status}</strong>` : ""}</span>
        </button>`;
      }).join("")}</div>
    </article>
    ${selected ? `<section class="box feedback ${selected.ok ? "correct" : "wrong"}">
      <h2 tabindex="-1">${selected.ok ? "Respuesta correcta" : "Respuesta incorrecta"}</h2>
      ${selected.ok ? "" : `<p><strong>Opción correcta</strong><br>${esc(q.options[q.correct])}</p>`}
      ${feedback(q, selected.choice)}
      <div class="actions"><button class="button primary" data-action="next">${final ? "Ver resultados" : "Siguiente pregunta"}</button></div>
    </section>` : ""}
  </div>`;
}

function recommendation(stats, session) {
  if (session.answers.some((answer) => !answer.ok)) return ["errors", "Repasa los conceptos de las preguntas que fallaste en esta sesión."];
  if (examined(session.answers).some((key) => E.weak(stats.topics.get(key)))) {
    return ["smart", "Repasa los temas de esta sesión que aún requieren refuerzo en tu historial."];
  }
  if (stats.questions.size < bank.length) return ["new", "Amplía la cobertura con preguntas nuevas."];
  return ["smart", "Mezcla repasos pendientes y conceptos de todo el temario."];
}

function listTopics(items, empty = "Aún no hay temas en esta categoría.") {
  return items.length ? `<ul class="text-list">${items.map((label) => `<li>${esc(label)}</li>`).join("")}</ul>` : `<p class="muted">${esc(empty)}</p>`;
}

function results(session) {
  const stats = E.summarize(bank, state);
  const evaluated = examined(session.answers);
  const misses = session.answers.filter((a) => !a.ok);
  const missedTopics = new Set(examined(misses));
  const [mode, description] = recommendation(stats, session);
  return intro(session.abandoned ? "Sesión abandonada" : "Resultados del examen", modes.get(session.mode).name + " · " + date(session.ended)) +
    `<section class="box"><h2>Resumen de la sesión</h2>
      <div class="metrics wide">
        ${metric(session.abandoned ? E.score(session) + " / " + session.answers.length : E.score(session) + " / 10", session.abandoned ? "Aciertos registrados" : "Calificación")}
        ${metric(pct(session.answers.length ? Math.round(100 * E.score(session) / session.answers.length) : null), "Aciertos")}
        ${metric(misses.length, "Errores")}
        ${metric(formatTime(session.ended - session.started), "Tiempo empleado")}
      </div>
      <details><summary>Temas evaluados</summary>${listTopics(evaluated)}</details>
      <details><summary>Temas dominados en tu progreso actual</summary>${listTopics(evaluated.filter((key) => E.mastered(stats.topics.get(key))))}</details>
      <details open><summary>Temas para reforzar</summary>${listTopics(evaluated.filter((key) => missedTopics.has(key) || E.weak(stats.topics.get(key))))}</details>
    </section>
    <section class="box"><h2>Revisión de errores</h2>
      ${misses.length ? misses.map((a) => {
        const q = lookup.get(a.id);
        return `<details><summary>${esc(q.stem)}</summary>
          <p><strong>Elegiste:</strong> ${esc(q.options[a.choice])}</p>
          <p><strong>Correcta:</strong> ${esc(q.options[q.correct])}</p>${feedback(q, a.choice)}</details>`;
      }).join("") : '<p class="muted">No hay errores en las respuestas registradas.</p>'}
    </section>
    <section class="box"><h2>Siguiente práctica</h2><p>${esc(description)}</p>
      <button class="button primary" data-action="recommend" data-mode="${mode}">Configurar ${esc(modes.get(mode).name.toLowerCase())}</button>
    </section>`;
}

function topicRows(stats) {
  return topics.map((q) => {
    const row = stats.topics.get(E.topicKey(q));
    const total = bank.filter((item) => E.topicKey(item) === E.topicKey(q)).length;
    const status = E.mastered(row) ? "Dominado" : E.weak(row) ? "Reforzar" : row ? "En práctica" : "Pendiente";
    return `<tr><th scope="row">${esc(q.topic)}<br><span class="small muted">${esc(q.subject)}</span></th>
      <td>${row?.ids.size || 0}/${total}</td><td>${pct(E.rate(row))}</td><td>${status}</td></tr>`;
  }).join("");
}

function progressView() {
  const stats = E.summarize(bank, state);
  const last = state.sessions.filter((s) => !s.abandoned).slice(-12);
  const weakList = concepts.filter((q) => E.weak(stats.concepts.get(E.conceptKey(q))));
  const due = concepts.filter((q) => stats.concepts.get(E.conceptKey(q))?.due <= Date.now());
  return intro("Tu progreso", "Consulta tu cobertura, rendimiento y repasos pendientes.") +
    `<section class="box"><h2>Resumen de aprendizaje</h2>
      <div class="metrics wide">
        ${metric(stats.exams, "Exámenes completos")}
        ${metric(stats.count, "Respuestas registradas")}
        ${metric(displayRate(stats), "Aciertos históricos")}
        ${metric(bank.length - stats.questions.size, "Preguntas pendientes")}
      </div>
      <div class="stat-line"><span>Cobertura de temas</span><strong>${stats.topics.size} / ${topics.length}</strong></div>
      ${progress(stats.topics.size, topics.length, "Temas practicados")}
      <div class="stat-line"><span>Preguntas distintas</span><strong>${stats.questions.size} / ${bank.length}</strong></div>
      ${progress(stats.questions.size, bank.length, "Preguntas distintas respondidas")}
    </section>
    <section class="box"><h2>Rendimiento por materia</h2>
      ${subjects.map((name) => `<div class="stat-line"><span>${esc(name)}</span><strong>${pct(E.rate(stats.subjects.get(name)))}</strong></div>`).join("")}
    </section>
    <section class="box"><h2>Rendimiento por tema</h2>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Tabla de rendimiento por tema"><table><thead><tr><th scope="col">Tema</th><th scope="col">Vistas</th><th scope="col">Aciertos</th><th scope="col">Estado</th></tr></thead><tbody>${topicRows(stats)}</tbody></table></div>
    </section>
    <section class="box"><h2>Conceptos por reforzar</h2>
      ${listTopics(weakList.map((q) => q.topic + " · " + q.subtopic), "Completa preguntas para identificar tus conceptos débiles.")}
      <p class="small muted">Repasos disponibles hoy · ${due.length}</p>
      <button class="button" data-action="recommend" data-mode="smart">Configurar repaso inteligente</button>
    </section>
    <section class="box"><h2>Evolución del rendimiento</h2>
      ${last.length ? last.map((s) => `<div class="stat-line"><span>${esc(date(s.ended))}</span><strong>${E.score(s)}/10</strong></div>
        ${progress(E.score(s), E.size, "Calificación sobre 10")}`).join("") : '<p class="muted">Completa un examen para empezar a ver tu evolución.</p>'}
    </section>
    <section class="box"><h2>Gestionar progreso</h2>
      <p class="small muted">La exportación incluye el historial y el examen en curso. Importar reemplaza el progreso guardado en este navegador.</p>
      <div class="actions">
        <button class="button" data-action="export">Exportar JSON</button>
        <button class="button" data-action="import">Importar JSON</button>
        <button class="button danger" data-action="reset">Reiniciar estadísticas</button>
      </div>
    </section>`;
}

function history() {
  return intro("Historial de sesiones", "Abre una sesión para volver a sus resultados y explicaciones.") +
    activePrompt() + `<section class="box"><h2>Sesiones guardadas</h2>
      ${state.sessions.length ? `<ul class="history">${[...state.sessions].reverse().map((s) => `<li>
        <div><strong>${esc(modes.get(s.mode).name)}</strong><p class="small muted">${esc(date(s.ended))} ·
        ${s.abandoned ? "Abandonado · " + s.answers.length + " respuestas" : E.score(s) + "/10 · " + formatTime(s.ended - s.started)}</p></div>
        <a class="button" href="#resultado/${s.id}" aria-label="Ver sesión de ${esc(date(s.ended))}">Ver sesión</a>
      </li>`).join("")}</ul>` : '<p class="muted">Tus sesiones aparecerán aquí después de practicar.</p>'}
    </section>`;
}

function syllabus() {
  const stats = E.summarize(bank, state);
  return intro("Temario y fuentes", "Explora los conceptos del banco y consulta de dónde sale cada pregunta.") +
    subjects.map((subject) => `<section class="box"><h2>${esc(subject)}</h2>
      ${[...new Set(bank.filter((q) => q.subject === subject).map((q) => q.unit))].map((unit) => `<h3>${esc(unit)}</h3>
        ${topics.filter((q) => q.subject === subject && q.unit === unit).map((q) => {
          const rows = bank.filter((item) => E.topicKey(item) === E.topicKey(q));
          return `<details><summary>${esc(q.topic)} · ${rows.length} preguntas</summary>
            <ul class="text-list">${concepts.filter((c) => E.topicKey(c) === E.topicKey(q)).map((c) => {
              const group = rows.filter((item) => E.conceptKey(item) === E.conceptKey(c));
              return `<li>${esc(c.subtopic)} · ${stats.concepts.get(E.conceptKey(c))?.ids.size || 0}/${group.length} practicadas</li>`;
            }).join("")}</ul>
            <button class="button" data-action="topic" data-topic="${esc(E.topicKey(q))}">Configurar práctica del tema</button>
          </details>`;
        }).join("")}`).join("")}
    </section>`).join("") +
    `<section class="box"><h2>Inventario de fuentes</h2>
      <p class="small muted">Las referencias web y los videos requieren conexión para abrirse. Sus preguntas y explicaciones están disponibles localmente.</p>
      ${[...sources.values()].map((src) => `<details><summary>${esc(src.title)} · ${esc(src.status)}</summary>
        <p class="small">${esc(src.origin)} · ${esc(src.kind)}. ${esc(src.note)}</p>
        <a href="${esc(src.url || src.file)}" target="_blank" rel="noopener noreferrer">Abrir fuente</a>
        ${src.alternate ? ` · <a href="${esc(src.alternate)}" target="_blank" rel="noopener noreferrer">Consultar ficha en inglés</a>` : ""}
      </details>`).join("")}
    </section>`;
}

function clock() {
  const target = document.querySelector("#timer-display");
  if (!target || !state.active) return;
  const ms = state.active.started + state.active.timer * 60000 - Date.now();
  target.textContent = formatTime(Math.ceil(ms / 1000) * 1000) + " restantes";
  document.querySelector("#timer-expired").hidden = ms > 0;
}

function render(focus = "heading") {
  let [view, id] = location.hash.slice(1).split("/");
  const saved = state.sessions.find((s) => s.id === id);
  const pages = { inicio: home, progreso: progressView, historial: history, temario: syllabus };
  if (view === "examen" && state.active) screen.innerHTML = exam(state.active);
  else if (view === "resultado" && saved) screen.innerHTML = results(saved);
  else {
    view = Object.hasOwn(pages, view) ? view : "inicio";
    screen.innerHTML = pages[view]();
  }
  for (const link of document.querySelectorAll("[data-nav]")) {
    const active = link.dataset.nav === (view === "examen" ? "inicio" : view === "resultado" ? "historial" : view);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (focus === "heading") {
    screen.querySelector("h1")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } else if (focus) document.querySelector(focus)?.focus();
  clock();
}

function go(path) {
  if (location.hash === "#" + path) render();
  else location.hash = path;
}

function confirmAction(title, body, label, callback) {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-labelledby", "confirm-title");
  dialog.setAttribute("aria-describedby", "confirm-text");
  dialog.innerHTML = `<h2 id="confirm-title">${esc(title)}</h2><p id="confirm-text">${esc(body)}</p>
    <form method="dialog" class="actions"><button class="button" value="cancel" autofocus>Cancelar</button>
    <button class="button danger" value="accept">${esc(label)}</button></form>`;
  document.body.append(dialog);
  resetDialog = dialog;
  dialog.addEventListener("close", () => {
    const accepted = dialog.returnValue === "accept";
    dialog.remove();
    resetDialog = null;
    if (accepted) callback();
  }, { once: true });
  dialog.showModal();
}

function start(allowFallback) {
  if (state.active) return go("examen");
  const outcome = E.generate(bank, state, config, { fallback: allowFallback });
  if (!outcome.session) {
    fallback = outcome.available;
    return render("#limited");
  }
  state.active = outcome.session;
  fallback = null;
  save();
  go("examen");
}

screen.addEventListener("change", (event) => {
  const control = event.target;
  if (!["mode", "subject", "topic", "timer"].includes(control.id)) return;
  config[control.id] = control.id === "timer" ? Number(control.value) : control.value;
  if (control.id === "subject") config.topic = E.topicKey(topics.find((q) => q.subject === config.subject));
  fallback = null;
  render("#" + control.id);
});
screen.addEventListener("submit", (event) => {
  if (event.target.id === "setup") {
    event.preventDefault();
    start(false);
  }
});

screen.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.hasAttribute("data-choice")) {
    if (E.answer(state.active, lookup, Number(button.dataset.choice))) {
      save();
      render(".feedback h2");
    }
    return;
  }
  switch (button.dataset.action) {
    case "fallback": start(true); break;
    case "next":
      if (!E.next(state.active)) break;
      if (state.active.ended !== null) {
        const session = state.active;
        state.sessions.push(session);
        state.active = null;
        save();
        go("resultado/" + session.id);
      } else {
        save();
        render();
      }
      break;
    case "abandon":
      confirmAction("¿Abandonar el examen?", "Las respuestas registradas seguirán contando en tu progreso.", "Abandonar", () => {
        if (!state.active) return;
        state.sessions.push({ ...state.active, abandoned: true, ended: Date.now() });
        state.active = null;
        save();
        render();
      });
      break;
    case "recommend":
      config.mode = button.dataset.mode;
      fallback = null;
      go("inicio");
      break;
    case "topic": {
      const q = topics.find((item) => E.topicKey(item) === button.dataset.topic);
      Object.assign(config, { mode: "topic", subject: q.subject, topic: E.topicKey(q) });
      fallback = null;
      go("inicio");
      break;
    }
    case "export": {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "practica-ia-progreso.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      break;
    }
    case "import": document.querySelector("#import").click(); break;
    case "reset":
      confirmAction("¿Reiniciar las estadísticas?", "Se eliminarán el historial, las respuestas y el examen en curso de este navegador.", "Reiniciar", () => {
        const selectedTheme = state.theme;
        state = E.empty();
        state.theme = selectedTheme;
        save();
        render();
        announce("Estadísticas reiniciadas.");
      });
      break;
  }
});

document.querySelector("#import").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const candidate = E.restore(JSON.parse(await file.text()), bank);
    confirmAction("¿Importar este progreso?", "Se reemplazarán las sesiones y respuestas actuales con la copia seleccionada.", "Importar", () => {
      state = candidate;
      save();
      theme();
      render();
      announce("Progreso importado.");
    });
  } catch (error) {
    announce(error instanceof SyntaxError ? "El archivo no contiene JSON válido." : error.message);
  }
});

document.querySelector("#theme").addEventListener("click", () => {
  state.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  theme();
  save();
});
dark.addEventListener("change", theme);
document.querySelector(".skip").addEventListener("click", (event) => {
  event.preventDefault();
  screen.focus();
});
window.addEventListener("hashchange", () => {
  if (resetDialog) resetDialog.close();
  render();
});
window.addEventListener("storage", (event) => {
  if (event.key !== storageKey) return;
  try {
    state = event.newValue ? E.restore(JSON.parse(event.newValue), bank) : E.empty();
    theme();
    if (resetDialog) resetDialog.close();
    render(false);
    announce("El progreso se actualizó desde otra pestaña.");
  } catch {
    announce("No se pudo sincronizar la actualización de otra pestaña.");
  }
});
theme();
announce();
render(false);
setInterval(clock, 1000);
