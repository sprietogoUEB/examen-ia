"use strict";

(function (root) {
  const size = 10;
  const day = 86400000;
  const difficulties = { b: "Básica", i: "Intermedia", a: "Avanzada" };
  const skills = {
    m: "Memorización", c: "Comprensión", a: "Aplicación y casos",
    e: "Detección de errores", d: "Comparación", x: "Detalle o excepción"
  };
  const modes = [
    ["general", "Examen general", "Combina materias y niveles."],
    ["subject", "Por materia", "Practica una materia completa."],
    ["topic", "Por tema", "Concéntrate en un tema del curso."],
    ["errors", "Repaso de errores", "Practica conceptos que requieren refuerzo."],
    ["new", "Preguntas nuevas", "Avanza por preguntas que aún no has visto."],
    ["hard", "Examen difícil", "Resuelve únicamente preguntas avanzadas."],
    ["smart", "Repaso inteligente", "Mezcla errores, preguntas pendientes y repasos programados."],
    ["mock", "Simulacro", "Haz un examen general con reloj opcional."]
  ];
  const clean = (line) => line.split("|").map((value) => value.trim());

  function buildBank(batches) {
    const bank = [];
    let hierarchy;
    for (const batch of batches) {
      for (const line of batch.trim().split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (line.startsWith("# ")) {
          hierarchy = clean(line.slice(2));
          if (hierarchy.length !== 4) throw Error("Encabezado inválido: " + line);
          continue;
        }
        const [id, refs, level, stem, answer, ...rest] = clean(line);
        const explanation = rest.pop();
        const choices = [answer, ...rest];
        if (!hierarchy || !skills[level?.[0]] || !difficulties[level?.[1]] ||
            ![2, 4].includes(choices.length) || choices.some((choice) => !choice) || !explanation) {
          throw Error("Formato de pregunta inválido: " + id);
        }
        const correct = [...id].reduce((hash, char) => hash * 31 + char.charCodeAt(0), 0) % choices.length;
        const distractorNotes = choices.map((choice) => choice.split(" ~ ")[1] || "");
        const options = choices.map((choice) => choice.split(" ~ ")[0]);
        options.splice(correct, 0, options.shift());
        distractorNotes.splice(correct, 0, distractorNotes.shift());
        const [subject, unit, topic, subtopic] = hierarchy;
        bank.push({
          id, subject, unit, topic, subtopic, stem, options, correct, explanation, distractorNotes,
          type: options.length === 2 ? "Verdadero o falso" : level[0] === "a" ? "Caso o aplicación" : "Selección única",
          skill: skills[level[0]], level: level[1], priority: level.endsWith("+") ? "Alta" : "Media",
          tags: [topic, subtopic, ...(level.includes("@") ? level.split("@")[1].replace(/\+$/, "").split(",") : [])],
          validation: "Revisada contra referencias",
          refs: refs.split(";").map((ref) => {
            const split = ref.indexOf(":");
            return { sourceId: ref.slice(0, split).trim(), location: ref.slice(split + 1).trim() };
          })
        });
      }
    }
    return bank;
  }

  const empty = () => ({ version: 1, theme: null, sessions: [], active: null });
  const topicKey = (q) => [q.subject, q.topic].join(" / ");
  const conceptKey = (q) => [q.subject, q.unit, q.topic, q.subtopic].join(" / ");
  const byId = (bank) => new Map(bank.map((q) => [q.id, q]));
  const score = (session) => session.answers.filter((answer) => answer.ok).length;
  const rate = (stat) => stat?.count ? Math.round(100 * stat.hits / stat.count) : null;
  const mastered = (stat) => stat?.ids.size >= 3 && stat.hits / stat.count >= .8 && stat.lastCorrect;
  const weak = (stat) => stat?.count > 0 && (!stat.lastCorrect || stat.hits / stat.count < .7);

  function summarize(bank, state) {
    const lookup = byId(bank);
    const stats = { questions: new Map(), concepts: new Map(), topics: new Map(), subjects: new Map(),
      count: 0, hits: 0, exams: state.sessions.filter((s) => s.ended && !s.abandoned).length };
    const sessions = [...state.sessions, ...(state.active ? [state.active] : [])];
    const answers = sessions.flatMap((s) => s.answers).sort((a, b) => a.at - b.at);
    for (const answer of answers) {
      const q = lookup.get(answer.id);
      if (!q) continue;
      stats.count += 1;
      stats.hits += Number(answer.ok);
      const routes = [
        ["questions", q.id], ["concepts", conceptKey(q)], ["topics", topicKey(q)], ["subjects", q.subject]
      ];
      for (const [map, key] of routes) {
        const row = stats[map].get(key) || { count: 0, hits: 0, streak: 0, ids: new Set() };
        row.count += 1;
        row.hits += Number(answer.ok);
        row.last = answer.at;
        row.lastCorrect = answer.ok;
        row.streak = answer.ok ? row.streak + 1 : 0;
        row.ids.add(q.id);
        row.due = answer.at + (answer.ok ? [1, 3, 7, 14, 30][Math.min(row.streak - 1, 4)] * day : 0);
        stats[map].set(key, row);
      }
    }
    return stats;
  }

  function shuffle(items, random) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function eligible(bank, config, stats) {
    switch (config.mode) {
      case "subject": return bank.filter((q) => q.subject === config.subject);
      case "topic": return bank.filter((q) => topicKey(q) === config.topic);
      case "hard": return bank.filter((q) => q.level === "a");
      case "new": return bank.filter((q) => !stats.questions.has(q.id));
      case "errors": return bank.filter((q) => {
        const own = stats.questions.get(q.id);
        return (own && !own.lastCorrect) || weak(stats.concepts.get(conceptKey(q)));
      });
      default: return bank;
    }
  }

  function generate(bank, state, config, options = {}) {
    const { fallback = false, now = Date.now(), random = Math.random } = options;
    const stats = summarize(bank, state);
    const primary = eligible(bank, config, stats);
    if (primary.length < size && !fallback) return { available: primary.length };
    const previous = new Set(state.sessions.at(-1)?.items.map((q) => q.id) || []);
    const primaryIds = new Set(primary.map((q) => q.id));
    const keep = primary.length < size && fallback;
    const remaining = [...(keep ? bank : primary)];
    if (remaining.length < size) return { available: remaining.length };
    const plan = shuffle(["b", "b", "b", "i", "i", "i", "i", "a", "a", "a"], random);
    const topics = new Map();
    const concepts = new Map();
    const subjects = new Map();
    const picks = [];
    for (const level of plan) {
      let pool = remaining;
      if (keep && remaining.some((q) => primaryIds.has(q.id))) {
        pool = remaining.filter((q) => primaryIds.has(q.id));
      }
      const unseenLast = pool.filter((q) => !previous.has(q.id));
      if (unseenLast.length >= size - picks.length) pool = unseenLast;
      const matching = pool.filter((q) => q.level === level);
      if (matching.length) pool = matching;
      let winner;
      let best = -Infinity;
      for (const q of pool) {
        const question = stats.questions.get(q.id);
        const concept = stats.concepts.get(conceptKey(q));
        const topic = stats.topics.get(topicKey(q));
        let weight = q.priority === "Alta" ? 1.3 : 1;
        weight *= 1 / (1 + 2 * (topics.get(topicKey(q)) || 0));
        weight *= 1 / (1 + 3 * (concepts.get(conceptKey(q)) || 0));
        weight *= 1 / (1 + .4 * (subjects.get(q.subject) || 0));
        if (!topic) weight *= 1.5;
        if (previous.has(q.id)) weight *= .08;
        if (!question) weight *= config.mode === "new" ? 4 : 1.7;
        else if (now - question.last < day) weight *= .33;
        if (question && !question.lastCorrect) weight *= config.mode === "errors" ? 5 : 2;
        if (weak(concept)) weight *= config.mode === "smart" ? 3 : 1.7;
        if (concept?.due <= now) weight *= config.mode === "smart" ? 2.7 : 1.4;
        const priority = Math.log(Math.max(random(), Number.MIN_VALUE)) / weight;
        if (priority > best) {
          winner = q;
          best = priority;
        }
      }
      remaining.splice(remaining.indexOf(winner), 1);
      picks.push(winner);
      for (const [map, key] of [[topics, topicKey(winner)], [concepts, conceptKey(winner)], [subjects, winner.subject]]) {
        map.set(key, (map.get(key) || 0) + 1);
      }
    }
    const positions = shuffle([0, 1, 2, 3], random);
    let multiple = 0;
    const items = shuffle(picks, random).map((q) => {
      if (q.options.length === 2) {
        const first = q.options.indexOf("Verdadero");
        return { id: q.id, order: [first, 1 - first] };
      }
      const order = shuffle(q.options.map((_, i) => i).filter((i) => i !== q.correct), random);
      order.splice(positions[multiple % 4], 0, q.correct);
      multiple += 1;
      return { id: q.id, order };
    });
    return { session: {
      id: "ex-" + now.toString(36) + "-" + random().toString(36).slice(2, 11),
      mode: config.mode, started: now, ended: null, abandoned: false, fallback: keep,
      index: 0, timer: config.mode === "mock" && config.timer ? config.timer : 0, items, answers: []
    }};
  }

  function answer(session, lookup, position, now = Date.now()) {
    const item = session?.items[session.index];
    if (!item || session.answers.length !== session.index || !item.order.includes(position)) return false;
    session.answers.push({ id: item.id, choice: position, ok: position === lookup.get(item.id).correct, at: now });
    return true;
  }

  function next(session, now = Date.now()) {
    if (!session || session.ended !== null || session.answers.length !== session.index + 1) return false;
    if (session.index === size - 1) session.ended = now;
    else session.index += 1;
    return true;
  }

  function restore(raw, bank) {
    const lookup = byId(bank);
    const validTime = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000000;
    const validSession = (s, active) => {
      if (!s || typeof s.id !== "string" || !/^ex-[a-z0-9-]+$/.test(s.id) ||
          !modes.some(([id]) => id === s.mode) || !validTime(s.started) ||
          (active ? s.ended !== null || s.abandoned : !validTime(s.ended) || s.ended < s.started) ||
          typeof s.abandoned !== "boolean" || typeof s.fallback !== "boolean" ||
          !Number.isInteger(s.index) || s.index < 0 || s.index >= size ||
          ![0, 5, 10, 15, 20, 30].includes(s.timer) || !Array.isArray(s.items) || s.items.length !== size ||
          !Array.isArray(s.answers) || s.answers.length < s.index || s.answers.length > s.index + 1 ||
          (!active && !s.abandoned && s.answers.length !== size) ||
          new Set(s.items.map((item) => item?.id)).size !== size) return false;
      return s.items.every((item, i) => {
        const q = lookup.get(item.id);
        if (!q || !Array.isArray(item.order) || item.order.length !== q.options.length ||
            new Set(item.order).size !== q.options.length ||
            !item.order.every((v) => Number.isInteger(v) && v >= 0 && v < q.options.length)) return false;
        if (i >= s.answers.length) return true;
        const a = s.answers[i];
        return a && a.id === item.id && item.order.includes(a.choice) &&
          a.ok === (q.correct === a.choice) && validTime(a.at) && a.at >= s.started &&
          a.at >= (s.answers[i - 1]?.at || s.started) && (active || a.at <= s.ended);
      });
    };
    if (!raw || raw.version !== 1 || ![null, "light", "dark"].includes(raw.theme) ||
        !Array.isArray(raw.sessions) || !raw.sessions.every((s) => validSession(s, false)) ||
        (raw.active !== null && !validSession(raw.active, true))) throw Error("El archivo no tiene un progreso válido para este banco.");
    const ids = [...raw.sessions, ...(raw.active ? [raw.active] : [])].map((s) => s.id);
    if (new Set(ids).size !== ids.length) throw Error("El archivo contiene sesiones repetidas.");
    return raw;
  }

  const api = { size, day, difficulties, modes, buildBank, empty, topicKey, conceptKey,
    byId, score, rate, mastered, weak, summarize, eligible, generate, answer, next, restore };
  if (typeof module !== "undefined") module.exports = api;
  else root.ExamEngine = api;
})(globalThis);
