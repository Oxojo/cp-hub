(() => {
  "use strict";

  const topicOptions = ["Implementation", "Greedy", "DP", "Data Structure", "Graph", "Tree", "Shortest Path", "Math", "Number Theory", "Combinatorics", "Geometry", "Binary Search", "Two Pointers", "Prefix Sum", "Offline"];
  const resultLabels = { NEW: "New", ATTEMPTED: "Attempted", UNKNOWN: "Unknown", LEARNED: "Learned", SOLVED: "Solved" };
  const routeLabels = { today: "Today", week: "Week", problems: "Problems", reviews: "Reviews", contests: "Contests", analytics: "Analytics", settings: "Settings" };

  const app = document.getElementById("app");
  const modalLayer = document.getElementById("modalLayer");
  const toastStack = document.getElementById("toastStack");
  let currentRoute = location.hash.replace("#", "") || "today";
  if (!routeLabels[currentRoute]) currentRoute = "today";
  let activeReviewTab = "due";

  function localDateKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function fromDateKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }

  function addDays(input, days) {
    const date = typeof input === "string" ? fromDateKey(input) : new Date(input);
    date.setDate(date.getDate() + days);
    return localDateKey(date);
  }

  function startOfWeek(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function h(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(key, options = {}) {
    return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", ...options }).format(fromDateKey(key));
  }

  function formatLongDate(key = localDateKey()) {
    return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(fromDateKey(key));
  }


  let data = { version: 1, settings: { dailyTarget: 15, weeklyTarget: 80, timezone: 'Asia/Tokyo' }, problems: [], attempts: [], reviews: [], contests: [], events: [] };
  let revision = 0, pending = Promise.resolve(), serverStatus = null;
  async function api(path, method = 'GET', body) {
    const response = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }
  function accept(payload) { data = payload.state; revision = payload.revision; }
  function save() {
    const snapshot = structuredClone(data);
    pending = pending.then(async () => {
      accept(await api('/api/state', 'PUT', { state: snapshot, revision }));
      render();
    }).catch(async error => {
      showToast('保存できませんでした', error.message);
      try { accept(await api('/api/state')); render(); } catch { /* retain state for recovery */ }
    });
    return pending;
  }
  async function mutation(path, input) {
    await pending;
    accept(await api(path, 'POST', input));
    closeModal(); render();
  }
  const problemById = (id) => data.problems.find((p) => p.id === id);
  const dueReviews = () => data.reviews.filter((r) => r.status === "PENDING" && r.dueDate <= localDateKey()).sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  function attemptsOn(date) {
    return data.attempts.filter((a) => a.date === date && !a.isReview);
  }

  function dailyStats(date = localDateKey()) {
    const attempts = attemptsOn(date);
    const touchedIds = new Set(attempts.filter((a) => ["ATTEMPTED", "SOLVED", "LEARNED", "UNKNOWN"].includes(a.result)).map((a) => a.problemId));
    return {
      touched: touchedIds.size,
      solved: attempts.filter((a) => a.result === "SOLVED").length,
      learned: attempts.filter((a) => a.result === "LEARNED").length,
      unknown: attempts.filter((a) => a.result === "UNKNOWN").length,
      observations: attempts.filter((a) => a.observation?.trim()).length
    };
  }

  function weeklyStats() {
    const start = startOfWeek();
    const keys = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const weekAttempts = data.attempts.filter((a) => keys.includes(a.date) && !a.isReview);
    const touched = new Set(weekAttempts.filter(a => a.result !== 'SKIPPED' && problemById(a.problemId)?.firstTouchedAt >= keys[0]).map((a) => a.problemId)).size;
    return {
      keys,
      touched,
      solved: weekAttempts.filter((a) => a.result === "SOLVED").length,
      learned: weekAttempts.filter((a) => a.result === "LEARNED").length,
      unknown: weekAttempts.filter((a) => a.result === "UNKNOWN").length,
      observations: weekAttempts.filter((a) => a.observation?.trim()).length
    };
  }

  function statusPill(status) {
    const key = status.toLowerCase();
    return `<span class="status-pill ${key}">${h(resultLabels[status] || status)}</span>`;
  }

  function topicTags(topics = [], limit = 2) {
    const shown = topics.slice(0, limit).map((t) => `<span class="tag">${h(t)}</span>`).join("");
    return `${shown}${topics.length > limit ? `<span class="tag">+${topics.length - limit}</span>` : ""}`;
  }

  function updateChrome() {
    document.getElementById("breadcrumb").textContent = routeLabels[currentRoute];
    document.querySelectorAll("[data-route]").forEach((button) => {
      const route = button.dataset.route;
      button.classList.toggle("is-active", route === currentRoute || (route === "more" && ["week", "contests", "analytics", "settings"].includes(currentRoute)));
    });
    const due = dueReviews().length;
    document.getElementById("reviewNavBadge").textContent = due;
    document.getElementById("mobileReviewBadge").textContent = due;
  }

  function pageHead(kicker, title, subtitle, actions = "") {
    return `<header class="page-head"><div><div class="page-kicker">${h(kicker)}</div><h1>${h(title)}</h1><p class="page-subtitle">${h(subtitle)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</header>`;
  }

  function render() {
    updateChrome();
    const views = { today: renderToday, week: renderWeek, problems: renderProblems, reviews: renderReviews, contests: renderContests, analytics: renderAnalytics, settings: renderSettings };
    app.innerHTML = views[currentRoute]();
    app.focus({ preventScroll: true });
  }

  function renderToday() {
    const today = localDateKey();
    const stats = dailyStats(today);
    const target = data.settings.dailyTarget;
    const pct = Math.min(100, Math.round((stats.touched / target) * 100));
    const todayContests = data.contests.filter((c) => c.date === today);
    const reviews = dueReviews();
    const observation = [...data.attempts].reverse().find((a) => a.observation?.trim());
    const observationProblem = observation ? problemById(observation.problemId) : null;
    const week = weeklyStats();
    const weekPct = Math.min(100, Math.round((week.touched / data.settings.weeklyTarget) * 100));
    const bars = week.keys.map((key) => `<i class="${key === today ? "today" : ""}" style="height:${Math.max(8, Math.min(100, dailyStats(key).touched / Math.max(1, data.settings.dailyTarget) * 100))}%" title="${formatDate(key)}: ${dailyStats(key).touched}"></i>`).join("");
    const schedule = [
      { time: "09:00", title: "Light Review", meta: `${reviews.length} problems due`, type: "review", tag: "Review" },
      ...todayContests.map((c) => ({ time: c.time, title: c.name, meta: `${c.platform} · ${c.endTime} まで`, type: c.kind, tag: c.status === "PLANNED" ? "参加予定" : "Live" })),
      { time: "Anytime", title: "High Volume Input", meta: `残り ${Math.max(0, target - stats.touched)} problems`, type: "virtual", tag: "Input" }
    ].sort((a, b) => a.time.localeCompare(b.time));

    return `${pageHead("Daily cockpit", formatLongDate(today), "今日やることと、いまの進捗をひとつの画面で確認します。", `<button class="secondary" data-start-review><svg><use href="#i-review"></use></svg>復習を始める</button><button class="primary" data-open-quick-log><svg><use href="#i-play"></use></svg>トレーニング開始</button>`)}
      <div class="today-grid">
        <div class="today-main">
          <section class="card mission-card">
            <div class="mission-top"><div><div class="mission-label">Today’s training</div><h2>${todayContests.length ? "Live Contest + Smart Input" : "High Volume Input"}</h2><p>${reviews.length}問を復習してから、典型と観察の母数を増やす日。</p></div><div class="goal-chip"><strong>${target}</strong><span>problems target</span></div></div>
            <div class="mission-progress"><div class="progress-meta"><span>Daily progress</span><strong>${stats.touched} / ${target} touched · ${pct}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></div>
            <div class="mission-actions"><button class="primary" data-open-quick-log><svg><use href="#i-play"></use></svg>Start Training</button><button class="secondary" data-start-review><svg><use href="#i-review"></use></svg>Review ${reviews.length}</button></div>
          </section>

          <section class="metric-grid" aria-label="今日の進捗">
            ${[["Touched", stats.touched, target], ["Solved", stats.solved, "today"], ["Learned", stats.learned, "today"], ["Unknown", stats.unknown, "today"], ["Observations", stats.observations, "new"]].map(([label, value, unit]) => `<article class="metric"><div class="metric-top"><i class="metric-dot"></i>${label}</div><div class="metric-value"><strong>${value}</strong><span>${unit}</span></div></article>`).join("")}
          </section>

          <section class="card">
            <div class="card-head"><div class="card-head-copy"><h3>今日のタイムライン</h3><span>JST</span></div><button class="card-link" data-route="week">Week を開く <svg><use href="#i-arrow"></use></svg></button></div>
            <div class="schedule-list">${schedule.map((item) => `<div class="schedule-row"><time class="schedule-time">${h(item.time)}</time><i class="timeline-pin ${h(item.type)}"></i><div class="schedule-copy"><strong>${h(item.title)}</strong><span>${h(item.meta)}</span></div><span class="tag">${h(item.tag)}</span></div>`).join("")}</div>
          </section>
        </div>

        <aside class="today-side">
          <section class="card">
            <div class="card-head"><div class="card-head-copy"><h3>Review Queue</h3><span>${reviews.length} due</span></div><button class="card-link" data-route="reviews">すべて表示 <svg><use href="#i-arrow"></use></svg></button></div>
            <div class="review-preview">${reviews.length ? reviews.slice(0, 3).map((review, index) => { const problem = problemById(review.problemId); return `<button class="review-mini" data-review-id="${review.id}"><span class="review-index">${String(index + 1).padStart(2, "0")}</span><span><strong>${h(problem.title)}</strong><span>${h(review.trigger.replace("_", " "))} · Stage ${review.stage + 1}</span></span><time>${review.dueDate < today ? "OVERDUE" : "TODAY"}</time></button>`; }).join("") : `<div class="empty-mini">今日の復習は完了しました。</div>`}</div>
          </section>

          <section class="card observation-card">
            <span class="quote-mark">“</span><h3>Latest Observation</h3>
            ${observation ? `<blockquote>${h(observation.observation)}</blockquote><div class="observation-meta"><span>${h(observationProblem.title)}</span><span>${topicTags(observation.topics, 1)}</span></div>` : `<p class="page-subtitle">Learned を記録すると、ここに最新の観察が表示されます。</p>`}
          </section>

          <section class="card weekly-strip">
            <div class="weekly-summary"><div><span>WEEKLY VOLUME</span><div><strong>${week.touched}</strong> <span>/ ${data.settings.weeklyTarget} touched</span></div></div><span>${weekPct}%</span></div>
            <div class="mini-bars">${bars}</div>
          </section>

          <section class="sync-card card" style="grid-template-columns:8px 1fr;margin:0;color:var(--ink)"><span class="status-dot"></span><div><strong style="color:var(--ink)">CLIST: ${serverStatus?.clist.configured ? '接続設定済み' : '未設定'}</strong><span>${h(serverStatus?.clist.error || serverStatus?.clist.lastSuccess || 'まだ同期されていません')}</span></div></section>
        </aside>
      </div>`;
  }

  function renderWeek() {
    const week = weeklyStats();
    const pct = Math.min(100, Math.round((week.touched / data.settings.weeklyTarget) * 100));
    const today = localDateKey();
    const dayNames = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
    return `${pageHead("Weekly plan", "Week", "CLIST のコンテストとローカル練習を、同じ時間軸で確認します。", `<button class="secondary" data-add-event><svg><use href="#i-plus"></use></svg>ローカル予定</button><button class="primary" data-open-quick-log><svg><use href="#i-plus"></use></svg>Quick Log</button>`)}
      <div class="week-layout">
        <div class="week-overview">
          <section class="card week-total"><div class="week-total-top"><div><span class="page-kicker">Weekly target</span><strong>${week.touched} / ${data.settings.weeklyTarget}</strong><small>New Touched · ${pct}% complete</small></div>${statusPill(pct >= 100 ? "SOLVED" : "ATTEMPTED")}</div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><div class="week-breakdown"><div><b>${week.solved}</b><span>Solved</span></div><div><b>${week.learned}</b><span>Learned</span></div><div><b>${week.observations}</b><span>Observations</span></div></div></section>
          <section class="card focus-card"><div class="page-kicker">Suggested focus</div><h3>Implementation Accuracy</h3><p>Slow solved と Multiple WA が今週の記録にあります。次の easy 3問では、提出前チェックを固定化しましょう。</p></section>
        </div>
        <section class="week-days" aria-label="週間カレンダー">
          ${week.keys.map((key, i) => {
            const events = [...data.events.filter((e) => e.date === key), ...data.contests.filter((c) => c.date === key).map((c) => ({ ...c, source: "clist" }))].sort((a, b) => a.time.localeCompare(b.time));
            const stats = dailyStats(key);
            return `<article class="day-column ${key === today ? "is-today" : ""}"><div class="day-head"><div><span>${dayNames[i]}${key === today ? " · TODAY" : ""}</span><strong>${fromDateKey(key).getDate()}</strong></div><span class="day-progress">${stats.touched}/${data.settings.dailyTarget}</span></div><div class="event-stack">${events.map((event) => `<div class="event-block ${h(event.kind || "live")}"><strong>${h(event.name)}</strong><span>${h(event.time)} · ${event.source === "clist" ? "CLIST" : "LOCAL"}</span></div>`).join("") || `<span class="muted" style="font-size:9px;padding:8px 0">予定なし</span>`}</div><div class="day-stats"><div><span>Solved</span><b>${stats.solved}</b></div><div><span>Learned</span><b>${stats.learned}</b></div><div><span>Unknown</span><b>${stats.unknown}</b></div></div></article>`;
          }).join("")}
        </section>
      </div>`;
  }

  function renderProblems() {
    const query = window.problemQuery || "";
    const filter = window.problemFilter || "ALL";
    const topic = window.topicFilter || "ALL";
    const normalized = query.toLowerCase();
    const problems = data.problems.filter((p) => {
      const searchable = [p.title, p.url, p.platform, p.observation, ...(p.topics || []), ...(p.failureReasons || [])].join(" ").toLowerCase();
      return (!normalized || searchable.includes(normalized)) && (filter === "ALL" || p.state === filter) && (topic === "ALL" || p.topics.includes(topic));
    });
    return `${pageHead("Knowledge base", "Problems", "問題・Observation・Topic を横断検索し、接触履歴を振り返ります。", `<button class="primary" data-open-quick-log><svg><use href="#i-plus"></use></svg>問題を記録</button>`)}
      <div class="toolbar"><div class="toolbar-left"><label class="field-inline"><span class="sr-only">問題を検索</span><svg><use href="#i-search"></use></svg><input id="problemSearch" value="${h(query)}" placeholder="問題名・URL・Observation を検索" autocomplete="off" /></label><select id="problemStatusFilter" class="filter-select"><option value="ALL">すべての状態</option>${["SOLVED", "LEARNED", "ATTEMPTED", "UNKNOWN", "NEW"].map((x) => `<option ${filter === x ? "selected" : ""} value="${x}">${resultLabels[x]}</option>`).join("")}</select><select id="problemTopicFilter" class="filter-select"><option value="ALL">すべての Topic</option>${topicOptions.map((x) => `<option ${topic === x ? "selected" : ""}>${h(x)}</option>`).join("")}</select></div><span class="result-count">${problems.length} problems</span></div>
      <section class="card table-card"><table class="data-table"><thead><tr><th>Problem</th><th>Status</th><th>Topics</th><th>Rating</th><th>First touched</th><th></th></tr></thead><tbody>${problems.length ? problems.map((p) => `<tr data-problem-id="${p.id}"><td class="problem-cell"><strong>${h(p.title)}</strong><span>${h(p.platform)} · ${h(p.url)}</span></td><td>${statusPill(p.state)}</td><td><div class="topic-cluster">${topicTags(p.topics)}</div></td><td class="mono">${p.rating ?? "—"}</td><td class="mono muted">${p.firstTouchedAt ? h(p.firstTouchedAt) : "—"}</td><td class="text-right"><button class="ghost" data-quick-log-problem="${p.id}">Log</button></td></tr>`).join("") : `<tr><td colspan="6" class="table-empty"><strong>一致する問題がありません</strong>検索条件を変えるか、新しい問題を記録してください。</td></tr>`}</tbody></table></section>`;
  }

  function renderReviews() {
    const today = localDateKey();
    const all = data.reviews.filter((r) => r.status === "PENDING");
    const groups = { due: all.filter((r) => r.dueDate <= today), overdue: all.filter((r) => r.dueDate < today), upcoming: all.filter((r) => r.dueDate > today) };
    const visible = groups[activeReviewTab].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return `${pageHead("Spaced review", "Reviews", "Observation を隠したまま、5分以内に解法の核心を再構築します。", `<button class="primary" data-start-review ${groups.due.length ? "" : "disabled"}><svg><use href="#i-play"></use></svg>復習を始める</button>`)}
      <div class="review-tabs">${[["due", `Due today (${groups.due.length})`], ["overdue", `Overdue (${groups.overdue.length})`], ["upcoming", `Upcoming (${groups.upcoming.length})`]].map(([key, label]) => `<button data-review-tab="${key}" class="${activeReviewTab === key ? "is-active" : ""}">${label}</button>`).join("")}</div>
      ${visible.length ? `<section class="review-grid">${visible.map((review, index) => { const p = problemById(review.problemId); return `<article class="card review-card"><div class="review-card-top"><span class="review-index">${String(index + 1).padStart(2, "0")}</span><span class="status-pill ${review.dueDate < today ? "unknown" : "attempted"}">${review.dueDate < today ? "Overdue" : review.dueDate}</span></div><h3>${h(p.title)}</h3><p>${h(p.platform)} · ${h(review.trigger.replaceAll("_", " "))} · Stage ${review.stage + 1}</p><div class="topic-cluster">${topicTags(p.topics)}</div><div class="review-card-actions"><button class="secondary" data-review-id="${review.id}">復習する</button><button class="ghost" data-postpone-review="${review.id}">+1日</button></div></article>`; }).join("")}</section>` : `<section class="empty-state"><strong>${activeReviewTab === "upcoming" ? "予定されている復習はありません" : "このキューは空です"}</strong><p>Learned や Unknown を記録すると、設計書の間隔ルールに沿って自動的にここへ追加されます。</p><button class="primary" data-open-quick-log>問題を記録する</button></section>`}`;
  }

  function renderContests() {
    const contests = [...data.contests].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    return `${pageHead("Contest calendar", "Contests", "CLIST 由来の予定と参加記録を一つのリストで管理します。", `<button class="secondary" data-sync-demo>Sync now</button><button class="primary" data-add-event><svg><use href="#i-plus"></use></svg>ローカル予定</button>`)}
      <div class="toolbar"><span class="result-count">Contest data provided by CLIST</span><span class="tag">${serverStatus?.clist.lastSuccess ? h(serverStatus.clist.lastSuccess) : '未同期'}</span></div>
      <section class="contest-list">${contests.map((c) => `<article class="card contest-row"><div class="contest-date">${formatDate(c.date, { month: "short", weekday: "short" })}<strong>${fromDateKey(c.date).getDate()}</strong></div><div class="contest-info"><h3>${h(c.name)}</h3><p>${h(c.time)}–${h(c.endTime)} JST · ${h(c.kind.toUpperCase())}</p></div><div class="contest-source"><span>Resource</span><strong>${h(c.resource)}</strong></div><div class="contest-actions">${c.status === "PLANNED" ? `<span class="status-pill planned">参加予定</span>` : `<button class="ghost" data-plan-contest="${c.id}">参加する</button>`}<a class="secondary compact" href="${h(c.url)}" target="_blank" rel="noopener"><svg><use href="#i-external"></use></svg>開く</a><button class="ghost" data-log-contest="${c.id}">結果</button></div></article>`).join("")}</section>`;
  }

  function renderAnalytics() {
    const week = weeklyStats();
    const keys = Array.from({ length: 7 }, (_, i) => addDays(localDateKey(), i - 6));
    const values = keys.map((key) => ({ key, ...dailyStats(key) }));
    const max = Math.max(1, ...values.map((v) => v.touched));
    const topicCounts = {};
    data.attempts.filter((a) => !a.isReview).forEach((a) => a.topics?.forEach((t) => { topicCounts[t] = (topicCounts[t] || 0) + 1; }));
    const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const topMax = topTopics[0]?.[1] || 1;
    const knowledge = data.problems.filter((p) => ["SOLVED", "LEARNED"].includes(p.state)).length;
    return `${pageHead("Performance signals", "Analytics", "量だけでなく、知識獲得・観察・失敗傾向から次週の配分を考えます。", `<select class="filter-select"><option>直近4週間</option><option>今週</option><option>直近12週間</option></select>`)}
      <div class="analytics-grid">
        <section class="analytics-kpis">
          ${[["NEW TOUCHED / WEEK", week.touched, `目標 ${data.settings.weeklyTarget}`], ["KNOWLEDGE ACQUIRED", knowledge, "Solved + Learned"], ["NEW OBSERVATIONS", week.observations, "今週の短文メモ"], ["REVIEWS DUE", dueReviews().length, "今日までの期限"]].map(([label, value, note]) => `<article class="card analytics-kpi"><span>${label}</span><strong>${value}</strong><small>${h(note)}</small></article>`).join("")}
        </section>
        <section class="card chart-card"><div class="chart-title"><div><h3>Problem Volume</h3><p>直近7日 · Review を除く</p></div><span class="tag">Touched / Result</span></div><div class="bar-chart">${values.map((v) => `<div class="bar-group"><div class="bar-stack"><i style="height:${v.touched / max * 100}%"></i><i class="learned" style="height:${v.learned / max * 60}%"></i><i class="solved" style="height:${v.solved / max * 60}%"></i></div><span>${formatDate(v.key, { weekday: "short" })}</span></div>`).join("")}</div></section>
        <section class="card chart-card narrow"><div class="chart-title"><div><h3>Outcome Mix</h3><p>記録された attempt</p></div></div><div class="donut-wrap"><div class="donut"></div><div class="donut-center"><strong>${data.attempts.filter((a) => !a.isReview).length}</strong><span>ATTEMPTS</span></div></div><div class="legend"><span><i></i>Learned</span><span><i></i>Solved</span><span><i></i>Attempted</span><span><i></i>Unknown</span></div></section>
        <section class="card chart-card"><div class="chart-title"><div><h3>Topic Distribution</h3><p>attempt 件数 · 少数サンプルは参考値</p></div></div><div class="topic-bars">${topTopics.map(([topic, count]) => `<div class="topic-bar-row"><span>${h(topic)}</span><div class="track"><div class="fill" style="width:${count / topMax * 100}%"></div></div><b>${count}</b></div>`).join("")}</div></section>
        <section class="card chart-card narrow"><div class="chart-title"><div><h3>Next Focus</h3><p>記録からの説明可能な候補</p></div></div><div class="focus-list"><div class="focus-item"><strong>Implementation Accuracy</strong><span>Multiple WA / slow フラグがあるため、提出前チェックを3問で実施。</span></div><div class="focus-item"><strong>${h(topTopics[0]?.[0] || "Greedy")}</strong><span>接触数が最多。Knowledge Acquired に変換できているか確認。</span></div><div class="focus-item"><strong>Easy Sweep</strong><span>次の Virtual で 60 分時点の solve 数を記録。</span></div></div></section>
      </div>`;
  }

  function renderSettings() {
    const s = data.settings;
    return `${pageHead("Configuration", "Settings", "目標、タイムゾーン、通知と外部連携の既定値を管理します。", `<button class="secondary" data-export>データを書き出す</button>`)}
      <div class="settings-layout"><nav class="card settings-nav"><button class="is-active">General</button><button>Training plan</button><button>Contest sources</button><button>Discord</button><button>Data</button></nav>
      <section class="card settings-card">
        <div class="settings-section"><h3>General</h3><p>日付境界と週間集計に使う基本設定です。</p>
          <div class="setting-row"><label>タイムゾーン<span>単一 Owner 版は JST 固定</span></label><span class="tag">Asia/Tokyo</span></div>
          <div class="setting-row"><label>日次目標<span>コンテスト予定に応じて調整可能</span></label><input type="number" min="0" max="100" value="${s.dailyTarget}" data-setting="dailyTarget" /></div>
          <div class="setting-row"><label>週間目標<span>New Touched の目標</span></label><input type="number" min="1" max="500" value="${s.weeklyTarget}" data-setting="weeklyTarget" /></div>
        </div>
        <div class="settings-section"><h3>Notifications</h3><p>Discord 接続後に使う既定の投稿時刻です。</p>
          <div class="setting-row"><label>Morning message<span>今日の予定と進捗</span></label><input type="time" value="${s.morningTime}" data-setting="morningTime" /></div>
          <div class="setting-row"><label>Evening summary<span>未達を理由に追加催促しません</span></label><input type="time" value="${s.eveningTime}" data-setting="eveningTime" /></div>
          <div class="setting-row"><label>Contest reminders<span>60分前 / 10分前</span></label><button class="toggle ${s.notifyContests ? "is-on" : ""}" aria-label="Contest reminder" aria-pressed="${s.notifyContests}" data-toggle-setting="notifyContests"></button></div>
        </div>
        <div class="settings-section"><h3>Integrations</h3><p>認証情報はサーバーの環境変数で設定します。</p>
          <div class="setting-row"><label>CLIST<span>6時間ごとの同期</span></label><span class="status-pill attempted">${serverStatus?.clist.configured ? 'Configured' : 'Not configured'}</span></div>
          <div class="setting-row"><label>Discord<span>Daily Input / Quick Action</span></label><span class="status-pill new">${serverStatus?.discord.configured ? 'Configured' : 'Not configured'}</span></div>
        </div>
        <div class="settings-section"><h3>Server data</h3><p>保存先: ${h(serverStatus?.storage || 'server')}。Settings の書き出しボタンで JSON を保存できます。既存の静的版のブラウザデータは自動移行されません。</p></div>
      </section></div>`;
  }

  function openModal(html) {
    modalLayer.innerHTML = html;
    document.body.style.overflow = "hidden";
    setTimeout(() => modalLayer.querySelector("input, button, select, textarea")?.focus(), 20);
  }

  function closeModal() {
    modalLayer.innerHTML = "";
    document.body.style.overflow = "";
  }

  function modalShell(title, subtitle, body, footer = "", size = "") {
    return `<section class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><header class="modal-head"><div><h2 id="modalTitle">${h(title)}</h2><p>${h(subtitle)}</p></div><button class="modal-close" data-close-modal aria-label="閉じる"><svg><use href="#i-x"></use></svg></button></header><div class="modal-body">${body}</div>${footer ? `<footer class="modal-foot">${footer}</footer>` : ""}</section>`;
  }

  function openQuickLog(problemId = null) {
    const problem = problemId ? problemById(problemId) : null;
    const topics = problem?.topics || [];
    openModal(modalShell("Quick Log", "通常 2〜30 秒で記録できます。Learned のみ Observation が必須です。", `<form id="quickLogForm" class="form-grid" novalidate>
      <div class="form-field full" id="urlField"><label for="problemUrl">Problem URL <span>必須</span></label><input id="problemUrl" name="url" type="url" required placeholder="https://atcoder.jp/contests/..." value="${h(problem?.url || "")}" /><span class="field-error">HTTP(S) の URL を入力してください。</span></div>
      <div class="form-field full"><label>Result</label><div class="segmented" id="resultSegment">${[["SOLVED", "✓ Solved"], ["LEARNED", "✦ Learned"], ["ATTEMPTED", "… Attempted"], ["UNKNOWN", "? Unknown"]].map(([value, label]) => `<button type="button" data-result="${value}" class="${value === "SOLVED" ? "is-active" : ""}">${label}</button>`).join("")}</div><input type="hidden" name="result" id="resultValue" value="SOLVED" /></div>
      <div class="form-field full"><label for="problemTitle">Problem name <span>任意・既存 URL は自動再利用</span></label><input id="problemTitle" name="title" value="${h(problem?.title || "")}" placeholder="Example Problem" /></div>
      <div class="form-field full"><label>Topics <span>複数選択可</span></label><div class="choice-chips" id="topicChoices">${topicOptions.map((topic) => `<button type="button" class="choice-chip ${topics.includes(topic) ? "is-active" : ""}" data-topic="${h(topic)}">${h(topic)}</button>`).join("")}</div></div>
      <div class="form-field full" id="observationField"><label for="observation">Key Observation <span id="observationRequirement">Solved では任意</span></label><textarea id="observation" name="observation" maxlength="1000" placeholder="解法の核心を自分の言葉で 1 文にします">${h(problem?.observation || "")}</textarea><span class="field-error">Learned では Key Observation が必須です。</span></div>
      <div class="form-field full"><label>Quick flags</label><div class="check-row"><label><input type="checkbox" name="slow" /> Solved but slow</label><label><input type="checkbox" name="multipleWa" /> Multiple WA</label></div></div>
      <div class="form-note full">同じ URL は canonical URL へ正規化して再利用します。Skip は Touched に数えません。</div>
    </form>`, `<button class="secondary" data-close-modal>キャンセル</button><button class="primary" type="submit" form="quickLogForm">Save & Close</button>`, "wide"));
  }


  async function handleQuickLog(form) {
    const fields = new FormData(form);
    const submit = document.querySelector('[form="quickLogForm"][type="submit"]');
    if (submit?.disabled) return;
    if (submit) submit.disabled = true;
    try {
      await mutation('/api/v1/attempts', { key: crypto.randomUUID(), url: fields.get('url'), result: fields.get('result'), title: fields.get('title'), observation: fields.get('observation'), topics: [...form.querySelectorAll('[data-topic].is-active')].map(b => b.dataset.topic), slow: fields.get('slow') === 'on', multipleWa: fields.get('multipleWa') === 'on' });
      showToast('記録を保存しました', 'Web と Discord で同じ記録を使用します。');
    } catch (error) { showToast('保存できませんでした', error.message); if (submit) submit.disabled = false; }
    return;
  }

  function openReview(reviewId) {
    const review = data.reviews.find((r) => r.id === reviewId);
    if (!review) return;
    const p = problemById(review.problemId);
    openModal(modalShell("Review", `Stage ${review.stage + 1} · ${review.trigger.replaceAll("_", " ")}`, `<div class="review-modal-hero"><span class="review-index">05:00</span><h3>${h(p.title)}</h3><p>問題文だけを見て、解法の核心を5分以内に再構築できますか？ Observation は回答するまで隠されています。</p><a class="secondary compact" style="margin-top:15px" href="${h(p.url)}" target="_blank" rel="noopener"><svg><use href="#i-external"></use></svg>問題を開く</a></div><div id="reviewObservation"></div><div class="review-answer-actions"><button class="primary" data-review-answer="remembered" data-review-target="${review.id}">Remembered<small>次の stage へ</small></button><button class="secondary" data-review-answer="forgot" data-review-target="${review.id}">Forgot<small>Observation を表示</small></button><button class="secondary" data-review-answer="unknown" data-review-target="${review.id}">Still Unknown<small>3日後に再確認</small></button></div>`, "", "small"));
  }

  async function answerReview(reviewId, answer) {
    document.querySelectorAll('[data-review-answer]').forEach(button => { button.disabled = true; });
    const problem = problemById(data.reviews.find(r => r.id === reviewId)?.problemId);
    try {
      await mutation('/api/v1/reviews', { id: reviewId, answer, key: crypto.randomUUID() });
      if (answer === 'forgot') openModal(modalShell('Key Observation', '明日もう一度確認します。', `<p>${h(problem?.observation || 'Observation は未記録です。')}</p>`, '<button class="primary" data-close-modal>確認しました</button>', 'small'));
      showToast('復習を保存しました', '次回期限をサーバーで更新しました。');
    } catch (error) { showToast('保存できませんでした', error.message); document.querySelectorAll('[data-review-answer]').forEach(button => { button.disabled = false; }); }
    return;
  }

  function openProblemDetail(problemId) {
    const p = problemById(problemId);
    if (!p) return;
    const attempts = data.attempts.filter((a) => a.problemId === p.id).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
    const review = data.reviews.find((r) => r.problemId === p.id && r.status === "PENDING");
    openModal(modalShell(p.title, `${p.platform}${p.rating ? ` · ${p.rating}` : ""}`, `<div class="detail-grid"><dl class="detail-summary"><dt>Current status</dt><dd>${statusPill(p.state)}</dd><dt>Topics</dt><dd><div class="topic-cluster">${topicTags(p.topics, 8)}</div></dd><dt>First touched</dt><dd class="mono">${p.firstTouchedAt || "—"}</dd><dt>Next review</dt><dd class="mono">${review?.dueDate || "—"}</dd><dt>URL</dt><dd><a href="${h(p.url)}" target="_blank" rel="noopener">${h(p.url)}</a></dd></dl><div><h3 style="margin-bottom:13px">Activity timeline</h3><div class="timeline">${attempts.map((a) => `<div class="timeline-item"><i></i><div><strong>${h(resultLabels[a.result] || a.result.replace("REVIEW_", "Review: "))}</strong><time>${h(a.date)} ${h(a.time)}</time>${a.observation ? `<p>${h(a.observation)}</p>` : ""}</div></div>`).join("") || `<p class="muted">履歴はまだありません。</p>`}</div></div></div>${p.observation ? `<div class="review-observation" style="margin-top:18px"><span>Key Observation</span><p>${h(p.observation)}</p></div>` : ""}`, `<button class="secondary" data-close-modal>閉じる</button><button class="primary" data-quick-log-problem="${p.id}">新しい attempt</button>`, "wide"));
  }

  function openGlobalSearch() {
    openModal(modalShell("Search", "問題名・URL・Topic・Observation を横断検索します。", `<label class="field-inline" style="display:block"><svg><use href="#i-search"></use></svg><input id="globalSearchInput" style="width:100%" placeholder="例: dominance, Greedy, AtCoder" autocomplete="off" /></label><div class="search-results" id="globalSearchResults">${searchResults("")}</div>`, "", "small"));
  }

  function searchResults(query) {
    const q = query.trim().toLowerCase();
    const results = data.problems.filter((p) => !q || [p.title, p.url, p.platform, p.observation, ...p.topics].join(" ").toLowerCase().includes(q)).slice(0, 7);
    return results.map((p) => `<button class="search-result" data-problem-id="${p.id}"><span class="search-result-icon"><svg><use href="#i-problems"></use></svg></span><span><strong>${h(p.title)}</strong><p>${h(p.observation || `${p.platform} · ${p.url}`)}</p></span><small>${h(resultLabels[p.state])}</small></button>`).join("") || `<div class="empty-mini">一致する問題がありません。</div>`;
  }

  function openAddEvent() {
    openModal(modalShell("Local Event", "CLIST 由来ではない練習予定を週間カレンダーへ追加します。", `<form id="eventForm" class="form-grid"><div class="form-field full"><label>Event name</label><input name="name" required placeholder="QOJ Review + Input" /></div><div class="form-field"><label>Date</label><input name="date" type="date" required value="${localDateKey()}" /></div><div class="form-field"><label>Time</label><input name="time" type="time" required value="19:00" /></div><div class="form-field full"><label>Type</label><select name="kind"><option value="input">Input</option><option value="review">Review</option><option value="virtual">Virtual</option><option value="live">Live Contest</option></select></div></form>`, `<button class="secondary" data-close-modal>キャンセル</button><button class="primary" form="eventForm" type="submit">予定を追加</button>`, "small"));
  }

  function openContestLog(contestId) {
    const c = data.contests.find((x) => x.id === contestId);
    openModal(modalShell("Contest Result", c.name, `<form id="contestLogForm" class="form-grid"><input type="hidden" name="contestId" value="${c.id}" /><div class="form-field"><label>Final solved</label><input type="number" name="solved" min="0" value="${c.result?.solved ?? 0}" /></div><div class="form-field"><label>Total WA</label><input type="number" name="wa" min="0" value="${c.result?.wa ?? 0}" /></div><div class="form-field"><label>60 min solves</label><input type="number" name="solved60" min="0" value="${c.result?.solved60 ?? 0}" /></div><div class="form-field"><label>90 min solves</label><input type="number" name="solved90" min="0" value="${c.result?.solved90 ?? 0}" /></div><div class="form-field full"><label>Notes</label><textarea name="notes" placeholder="取るべきだった問題、戦略ミスなど">${h(c.result?.notes || "")}</textarea></div></form>`, `<button class="secondary" data-close-modal>キャンセル</button><button class="primary" form="contestLogForm" type="submit">結果を保存</button>`, "small"));
  }

  function showToast(title, message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<i></i><div><strong>${h(title)}</strong><span>${h(message)}</span></div>`;
    toastStack.append(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  document.addEventListener("click", (event) => {
    const routeButton = event.target.closest("[data-route]");
    if (routeButton) {
      const route = routeButton.dataset.route;
      if (route === "more") document.body.classList.add("sidebar-open");
      else { currentRoute = route; location.hash = route; document.body.classList.remove("sidebar-open"); render(); }
      return;
    }
    if (event.target.closest("[data-open-quick-log]")) { openQuickLog(); return; }
    const quickProblem = event.target.closest("[data-quick-log-problem]");
    if (quickProblem) { closeModal(); openQuickLog(quickProblem.dataset.quickLogProblem); return; }
    if (event.target.closest("[data-close-modal]")) { closeModal(); return; }
    if (event.target === modalLayer) { closeModal(); return; }
    const resultButton = event.target.closest("[data-result]");
    if (resultButton) {
      document.querySelectorAll("[data-result]").forEach((b) => b.classList.remove("is-active"));
      resultButton.classList.add("is-active");
      document.getElementById("resultValue").value = resultButton.dataset.result;
      document.getElementById("observationRequirement").textContent = resultButton.dataset.result === "LEARNED" ? "Learned では必須" : "任意";
      return;
    }
    const topicButton = event.target.closest("[data-topic]");
    if (topicButton) { topicButton.classList.toggle("is-active"); return; }
    const problemRow = event.target.closest("[data-problem-id]");
    if (problemRow && !event.target.closest("[data-quick-log-problem]")) { openProblemDetail(problemRow.dataset.problemId); return; }
    const reviewButton = event.target.closest("[data-review-id]");
    if (reviewButton) { openReview(reviewButton.dataset.reviewId); return; }
    const answerButton = event.target.closest("[data-review-answer]");
    if (answerButton) { answerReview(answerButton.dataset.reviewTarget, answerButton.dataset.reviewAnswer); return; }
    const postpone = event.target.closest("[data-postpone-review]");
    if (postpone) { mutation('/api/v1/reviews/postpone', { id: postpone.dataset.postponeReview }).then(() => showToast('復習を延期しました', '期限を1日後に更新しました。')).catch(e => showToast('保存できませんでした', e.message)); return; }
    const tab = event.target.closest("[data-review-tab]");
    if (tab) { activeReviewTab = tab.dataset.reviewTab; render(); return; }
    if (event.target.closest("[data-start-review]")) { const review = dueReviews()[0]; review ? openReview(review.id) : showToast("復習は完了しています", "今日の Review Queue は空です。"); return; }
    if (event.target.closest("[data-add-event]")) { openAddEvent(); return; }
    const plan = event.target.closest("[data-plan-contest]");
    if (plan) { const c = data.contests.find((x) => x.id === plan.dataset.planContest); c.status = "PLANNED"; save(); render(); showToast("参加予定に追加しました", `${c.name} の通知対象になります。`); return; }
    const logContest = event.target.closest("[data-log-contest]");
    if (logContest) { openContestLog(logContest.dataset.logContest); return; }
    if (event.target.closest("[data-sync-demo]")) { api('/api/v1/clist/sync', 'POST', {}).then(() => showToast('同期を開始しました', '取得完了後に再読み込みすると予定へ反映されます。')).catch(e => showToast('同期できませんでした', e.message)); return; }
    const toggle = event.target.closest("[data-toggle-setting]");
    if (toggle) { const key = toggle.dataset.toggleSetting; data.settings[key] = !data.settings[key]; save(); render(); showToast("設定を保存しました", "このブラウザに反映されています。"); return; }
    if (event.target.closest("[data-export]")) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `training-hub-${localDateKey()}.json`; a.click(); URL.revokeObjectURL(url); showToast("データを書き出しました", "Problems / attempts / reviews / contests を含む JSON です。"); return;
    }
    if (event.target.closest("[data-reset]")) {
      showToast('サーバーデータは保持されます', 'リセットは管理者によるバックアップと DB 操作で行ってください。');
    }
  });

  document.addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.target.id === "quickLogForm") handleQuickLog(event.target);
    if (event.target.id === "eventForm") {
      const fd = new FormData(event.target);
      data.events.push({ id: uid("event"), name: String(fd.get("name")).trim(), date: fd.get("date"), time: fd.get("time"), kind: fd.get("kind"), source: "local" });
      save(); closeModal(); currentRoute = "week"; location.hash = "week"; render(); showToast("ローカル予定を追加しました", "Week の時間軸へ反映しました。");
    }
    if (event.target.id === "contestLogForm") {
      const fd = new FormData(event.target); const c = data.contests.find((x) => x.id === fd.get("contestId"));
      c.status = "PARTICIPATED"; c.result = { solved: Number(fd.get("solved")), wa: Number(fd.get("wa")), solved60: Number(fd.get("solved60")), solved90: Number(fd.get("solved90")), notes: String(fd.get("notes")) };
      save(); closeModal(); render(); showToast("Contest result を保存しました", `${c.result.solved} solved · ${c.result.wa} WA`);
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "problemSearch") { const position=event.target.selectionStart; window.problemQuery = event.target.value; render(); const input=document.getElementById("problemSearch"); input?.focus(); input?.setSelectionRange(position,position); }
    if (event.target.id === "globalSearchInput") document.getElementById("globalSearchResults").innerHTML = searchResults(event.target.value);
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "problemStatusFilter") { window.problemFilter = event.target.value; render(); }
    if (event.target.id === "problemTopicFilter") { window.topicFilter = event.target.value; render(); }
    const key = event.target.dataset.setting;
    if (key) { data.settings[key] = event.target.type === "number" ? Number(event.target.value) : event.target.value; save(); showToast("設定を保存しました", `${key} を更新しました。`); }
  });

  document.getElementById("globalSearchButton").addEventListener("click", openGlobalSearch);
  document.getElementById("menuButton").addEventListener("click", () => document.body.classList.add("sidebar-open"));
  document.getElementById("sidebarScrim").addEventListener("click", () => document.body.classList.remove("sidebar-open"));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalLayer.innerHTML) closeModal();
    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) { event.preventDefault(); openGlobalSearch(); }
    if (!modalLayer.innerHTML && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) && ["1", "2", "3"].includes(event.key)) {
      currentRoute = { "1": "today", "2": "week", "3": "problems" }[event.key]; location.hash = currentRoute; render();
    }
  });

  window.addEventListener("hashchange", () => {
    const next = location.hash.replace("#", "");
    if (routeLabels[next] && next !== currentRoute) { currentRoute = next; render(); }
  });

  async function boot() {
    app.innerHTML = '<p>サーバーへ接続しています…</p>';
    try {
      accept(await api('/api/state'));
      serverStatus = await api('/api/status');
      render();
      document.querySelector('.sync-card div span').textContent = serverStatus.clist.configured ? 'CLIST configured' : 'CLIST not configured';
    } catch (error) {
      app.innerHTML = `<section class="card settings-card"><h2>Owner ログイン</h2><p class="page-subtitle">サーバーの OWNER_PASSWORD を入力してください。</p><form id="loginForm" class="form-grid" style="margin-top:20px"><div class="form-field full"><label for="ownerPassword">Password</label><input id="ownerPassword" type="password" autocomplete="current-password" required /></div><button class="primary">ログイン</button></form><p>${h(error.message)}</p></section>`;
      document.getElementById('loginForm').addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/login', 'POST', { password: document.getElementById('ownerPassword').value }); await boot(); } catch (e) { showToast('ログインできませんでした', e.message); } });
    }
  }
  void boot();
})();
