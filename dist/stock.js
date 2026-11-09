/* Problem stock and daily queue; all writes go through the authenticated API. */
window.createStockUI = function ({ getState, request, modal, notify, refresh }) {
  const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const labels={UNSET:'未設定',EASY:'Easy',MID:'Mid',HARD:'Hard'};
  const selected=new Set();
  let tab='stock', search='', topic='', source='', difficulty='', min='', max='', busy=false;
  const queue=()=>getState().problemQueues?.[today()] || [];
  const pick=id=>getState().problems.find(p=>p.id===id);
  const pending=()=>queue().filter(e=>['PENDING','THINKING'].includes(e.status)&&!pick(e.problemId)?.archived).length;
  const options=(values,current)=>values.map(([value,label])=>`<option value="${escape(value)}" ${value===current?'selected':''}>${escape(label)}</option>`).join('');
  const tag=text=>`<span class="tag">${escape(text)}</span>`;
  function renderQueue(compact=false) {
    const items=queue().filter(e=>pick(e.problemId));
    const rows=items.map((e,i)=>{
      const p=pick(e.problemId), active=['PENDING','THINKING'].includes(e.status)&&!p.archived;
      return `<li class="stock-queue-row"><span class="stock-order">${String(i+1).padStart(2,'0')}</span><div class="stock-problem-copy"><button class="stock-title" data-problem-id="${escape(p.id)}">${escape(p.title)}</button><span>${escape(p.source || p.platform)} · ${escape(p.archived?'アーカイブ':e.status==='PENDING'?'未着手':e.status==='THINKING'?'考え中':e.status==='SKIPPED'?'スキップ':e.result || '完了')}</span></div><div class="stock-actions"><button class="ghost" data-stock-action="up" data-id="${escape(p.id)}" aria-label="${escape(p.title)}を上へ" ${i===0?'disabled':''}>↑</button><button class="ghost" data-stock-action="down" data-id="${escape(p.id)}" aria-label="${escape(p.title)}を下へ" ${i===items.length-1?'disabled':''}>↓</button><button class="ghost" data-stock-action="remove" data-id="${escape(p.id)}" aria-label="${escape(p.title)}をキューから外す">外す</button>${active?`<button class="primary compact" data-quick-log-problem="${escape(p.id)}">記録</button>`:''}</div></li>`;
    }).join('');
    return `<section class="card stock-queue"><div class="card-head"><div><h3>今日のキュー <span class="muted">${pending()} 問待ち / ${items.length} 問</span></h3><p class="stock-caption">順番は Web と Discord の /problems で共有します。</p></div><button class="ghost" ${compact?'data-route="problems"':'data-stock-tab="stock"'}>ストックから選ぶ</button></div>${items.length?`<ol class="stock-queue-list">${rows}</ol>`:'<div class="empty-mini">ストックから「今日に追加」で、練習する問題を選びましょう。</div>'}</section>`;
  }
  function render() {
    const problems=getState().problems;
    const topics=[...new Set(problems.flatMap(p=>p.topics || []))].sort();
    const sources=[...new Set(problems.map(p=>p.source || '').filter(Boolean))].sort();
    const candidates=problems.filter(p=>{
      if(tab==='stock' && (p.archived || p.state!=='NEW')) return false;
      if(tab==='all' && p.archived) return false;
      if(tab==='archived' && !p.archived) return false;
      const text=[p.title,p.url,p.source,p.platform,p.observation,...(p.topics||[]),...(p.failureReasons||[])].join(' ').toLowerCase();
      return (!search||text.includes(search.toLowerCase()))&&(!topic||p.topics?.includes(topic))&&(!source||p.source===source)&&(!difficulty||(p.difficulty||'UNSET')===difficulty)&&(min===''||(p.rating!==null&&p.rating!==undefined&&p.rating>=Number(min)))&&(max===''||(p.rating!==null&&p.rating!==undefined&&p.rating<=Number(max)));
    });
    const visibleIds = new Set(candidates.map(p => p.id));
    for (const id of selected) if (!visibleIds.has(id)) selected.delete(id);
    const tabs=[['stock',`ストック ${problems.filter(p=>p.state==='NEW'&&!p.archived).length}`],['queue',`今日のキュー ${pending()}`],['all','すべて'],['archived','アーカイブ']];
    const head=`<header class="page-head"><div><div class="page-kicker">Problem stock</div><h1>Problems</h1><p class="page-subtitle">気になる問題を集めて、今日の練習へ。ストック登録は Touched に数えません。</p></div><div class="page-actions"><button class="secondary" data-open-quick-log>Quick Log</button><button class="primary" data-stock-import>＋ URL をストック</button></div></header><div class="review-tabs stock-tabs">${tabs.map(([value,label])=>`<button data-stock-tab="${value}" class="${tab===value?'is-active':''}">${label}</button>`).join('')}</div>`;
    if(tab==='queue')return head+renderQueue();
    const filters=`<div class="stock-filters"><label class="form-field"><span>検索</span><input id="stockSearch" value="${escape(search)}" placeholder="問題名・URL・出典・Observation" /></label><label class="form-field"><span>Topic</span><select id="stockTopic">${options([['','すべて'],...topics.map(t=>[t,t])],topic)}</select></label><label class="form-field"><span>出典</span><select id="stockSource">${options([['','すべて'],...sources.map(s=>[s,s])],source)}</select></label><label class="form-field"><span>難易度</span><select id="stockDifficulty">${options([['','すべて'],...Object.entries(labels)],difficulty)}</select></label><label class="form-field stock-rating"><span>Rating</span><div><input id="stockMin" type="number" min="0" max="10000" aria-label="最低 Rating" placeholder="下限" value="${escape(min)}" /><span>–</span><input id="stockMax" type="number" min="0" max="10000" aria-label="最高 Rating" placeholder="上限" value="${escape(max)}" /></div></label></div>`;
    const rows=candidates.map(p=>{
      const queued=queue().some(e=>e.problemId===p.id);
      return `<tr><td><input type="checkbox" data-stock-select="${escape(p.id)}" ${selected.has(p.id)?'checked':''} aria-label="${escape(p.title)}を選択" /></td><td class="problem-cell"><button class="stock-title" data-problem-id="${escape(p.id)}">${escape(p.title)}</button><span>${escape(p.source || p.platform)}</span><a class="stock-url" href="${escape(p.url)}" target="_blank" rel="noopener noreferrer">${escape(p.url)}</a></td><td><span class="status-pill ${escape(p.state.toLowerCase())}">${escape(p.state)}</span></td><td><div class="topic-cluster">${(p.topics||[]).slice(0,3).map(tag).join('')}</div></td><td>${tag(labels[p.difficulty||'UNSET'])}<span class="stock-number">${p.rating??'—'}</span></td><td><div class="stock-actions"><button class="ghost" data-stock-edit="${escape(p.id)}">編集</button>${!p.archived?`<button class="${queued?'ghost':'secondary'} compact" data-stock-action="add" data-id="${escape(p.id)}" ${queued?'disabled':''}>${queued?'追加済み':'今日に追加'}</button>`:`<button class="ghost" data-stock-archive="${escape(p.id)}" data-archive="false">戻す</button>`}</div></td></tr>`;
    }).join('');
    return head+filters+`<div class="toolbar"><div class="toolbar-left"><label class="stock-select-all"><input type="checkbox" id="stockSelectAll" aria-label="表示中の先頭100件を選択" ${candidates.length&&candidates.slice(0,100).every(p=>selected.has(p.id))?'checked':''} /> 表示中を選択（最大100件）</label><span class="result-count">${candidates.length} 件 · ${selected.size} 件選択</span></div><div class="toolbar-right"><button class="secondary" data-stock-add-selected ${selected.size&&tab!=='archived'?'':'disabled'}>選択した問題を今日へ</button></div></div><section class="card table-card"><table class="data-table stock-table"><thead><tr><th></th><th>Problem / Source</th><th>Status</th><th>Topics</th><th>Difficulty / Rating</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="table-empty"><strong>問題がありません</strong>URL をストックするか、検索条件を変更してください。</td></tr>'}</tbody></table></section>`;
  }
  const commonFields=p=>`<div class="form-field"><label for="stockSourceField">出典・コンテスト</label><input id="stockSourceField" name="source" maxlength="300" placeholder="例: ABC 390 / 読書会 / おすすめ" value="${escape(p?.source||'')}" /></div><div class="form-field"><label for="stockDifficultyField">難易度</label><select id="stockDifficultyField" name="difficulty">${options(Object.entries(labels),p?.difficulty||'UNSET')}</select></div><div class="form-field"><label for="stockRatingField">Rating（任意）</label><input id="stockRatingField" type="number" name="rating" min="0" max="10000" value="${p?.rating??''}" /></div><div class="form-field full"><label for="stockTopicsField">Topics（カンマ区切り）</label><input id="stockTopicsField" name="topics" maxlength="1200" placeholder="Greedy, Graph, DP" value="${escape((p?.topics||[]).join(', '))}" /></div>`;
  function importModal() {
    modal('URL をストック','1〜100件をまとめて保存できます。重複 URL は既存問題を再利用します。',`<form id="stockImportForm" class="form-grid"><div class="form-field full"><label for="stockUrls">問題 URL <span>1行1件・空白区切り可</span></label><textarea id="stockUrls" name="urls" required maxlength="200000" rows="7" placeholder="https://atcoder.jp/contests/...&#10;https://codeforces.com/problemset/problem/..."></textarea></div>${commonFields()}<div class="check-row"><label><input name="queueToday" type="checkbox" /> 今日のキューにも追加</label></div><div class="form-note full">難易度・出典・Topics は今回追加する全問題に適用します。登録済みの問題のメモや履歴は上書きしません。</div></form>`,`<button class="secondary" data-close-modal>キャンセル</button><button class="primary" form="stockImportForm" type="submit">ストックに保存</button>`);
  }
  function editModal(id) {
    const p=pick(id); if(!p)return;
    modal('問題を整理する',p.url,`<form id="stockEditForm" class="form-grid" data-id="${escape(id)}"><div class="form-field full"><label for="stockTitleField">問題名</label><input id="stockTitleField" name="title" maxlength="300" required value="${escape(p.title)}" /></div>${commonFields(p)}<div class="check-row"><label><input name="archived" type="checkbox" ${p.archived?'checked':''} /> アーカイブ（履歴は保持）</label></div></form>`,`<button class="secondary" data-close-modal>キャンセル</button><button class="primary" form="stockEditForm" type="submit">保存する</button>`);
  }
  async function run(button, operation) {
    if(busy)return; busy=true; if(button)button.disabled=true;
    try{return await operation();}catch(error){notify('保存できませんでした',error.message);}finally{busy=false;if(button?.isConnected)button.disabled=false;}
  }
  function handleClick(event) {
    const target=event.target;
    const tabButton=target.closest('[data-stock-tab]');
    if(tabButton){tab=tabButton.dataset.stockTab;selected.clear();refresh();return true;}
    if(target.closest('[data-stock-import]')){importModal();return true;}
    const edit=target.closest('[data-stock-edit]');if(edit){editModal(edit.dataset.stockEdit);return true;}
    const archive=target.closest('[data-stock-archive]');if(archive){void run(archive,()=>request(`/api/v1/problems/${archive.dataset.stockArchive}`,{archived:false},'PATCH'));return true;}
    const action=target.closest('[data-stock-action]');
    if(action){void run(action,()=>request('/api/v1/queue',{action:action.dataset.stockAction,problemId:action.dataset.id,problemIds:[action.dataset.id]}));return true;}
    const bulk=target.closest('[data-stock-add-selected]');
    if(bulk){void run(bulk,async()=>{await request('/api/v1/queue',{action:'add',problemIds:[...selected]});selected.clear();refresh();notify('今日のキューへ追加しました','順番は「今日のキュー」で変更できます。');});return true;}
    if(target.closest('[data-stock-select],#stockSelectAll'))return true;
    return false;
  }
  function handleChange(event) {
    const el=event.target;
    if(el.dataset.stockSelect){if(el.checked&&selected.size>=100){el.checked=false;notify('最大100件です','一度追加してから次の問題を選んでください。');return true;}el.checked?selected.add(el.dataset.stockSelect):selected.delete(el.dataset.stockSelect);refresh();return true;}
    if(el.id==='stockSelectAll'){document.querySelectorAll('[data-stock-select]').forEach((box,i)=>{if(i<100){el.checked?selected.add(box.dataset.stockSelect):selected.delete(box.dataset.stockSelect);}});refresh();return true;}
    if(['stockTopic','stockSource','stockDifficulty','stockMin','stockMax'].includes(el.id)) {
      if(el.id==='stockTopic')topic=el.value;if(el.id==='stockSource')source=el.value;if(el.id==='stockDifficulty')difficulty=el.value;if(el.id==='stockMin')min=el.value;if(el.id==='stockMax')max=el.value;
      selected.clear();refresh();return true;
    }
    return false;
  }
  function handleInput(event) {
    if(event.target.id!=='stockSearch')return false;
    const position=event.target.selectionStart;search=event.target.value;selected.clear();refresh();const input=document.getElementById('stockSearch');input?.focus();input?.setSelectionRange(position,position);return true;
  }
  function handleSubmit(event) {
    const form=event.target;if(!['stockImportForm','stockEditForm'].includes(form.id))return false;
    const fields=new FormData(form), rating=fields.get('rating');
    const input={source:fields.get('source'),difficulty:fields.get('difficulty'),rating:rating===''?null:Number(rating),topics:String(fields.get('topics')||'').split(/[,、]/).map(t=>t.trim()).filter(Boolean)};
    const button=document.querySelector(`[form="${form.id}"][type="submit"]`);
    void run(button,async()=>{
      if(form.id==='stockImportForm') {
        const response=await request('/api/v1/problems/stock',{...input,urls:fields.get('urls'),queueToday:fields.get('queueToday')==='on'});
        notify(`${response.result.added} 件をストックしました`,`重複 ${response.result.reused} 件は再利用しました。`);
      } else { await request(`/api/v1/problems/${form.dataset.id}`,{...input,title:fields.get('title'),archived:fields.get('archived')==='on'},'PATCH');notify('問題の情報を保存しました','記録・復習の履歴は保持しています。'); }
    });
    return true;
  }
  return {render,renderQueue,handleClick,handleChange,handleInput,handleSubmit,editModal};
};
