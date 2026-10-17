'use strict';
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const KEY = 'yanz-journal-v1';
  const form = $('#entry-form');
  let entries = [], filter = 'all', selectedPoint = null, cover = '', coverBusy = false, comics = [], zoom = 1, region = 'world';
  let toastTimer, deleteTimer;
  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500); }
  function validDate(s) { return s === '' || /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s; }
  function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object' || !['travel','life'].includes(raw.kind) || typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 80) throw new Error('手记标题或类型不正确。');
    const e = { id: typeof raw.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(raw.id) ? raw.id : crypto.randomUUID(), kind:raw.kind, title:raw.title.trim(), place:String(raw.place || '').slice(0,80), start:String(raw.start || ''), end:String(raw.end || ''), story:String(raw.story || '').slice(0,20000), itinerary:String(raw.itinerary || '').slice(0,10000), tips:String(raw.tips || '').slice(0,10000), cover:'', comics:[], stops:[], lat:null,lng:null };
    if (!validDate(e.start) || !validDate(e.end) || (e.end && !e.start) || (e.end && e.end < e.start)) throw new Error('请检查开始和结束日期。');
    if (e.kind === 'travel') {
      if (raw.lat === null || raw.lat === '' || raw.lng === null || raw.lng === '' || !Number.isFinite(Number(raw.lat)) || !Number.isFinite(Number(raw.lng)) || Math.abs(Number(raw.lat)) > 90 || Math.abs(Number(raw.lng)) > 180 || !e.place.trim()) throw new Error('旅行手记需要地点与有效的经纬度。请在地图选点或手动填写。');
      e.lat = Number(raw.lat); e.lng = Number(raw.lng);
    }
    if (raw.cover && typeof raw.cover === 'string' && /^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(raw.cover) && raw.cover.length < 1800000) e.cover = raw.cover;
    if (Array.isArray(raw.comics)) e.comics = raw.comics.slice(0,6).filter(c => c && typeof c.image === 'string' && /^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(c.image) && c.image.length < 1800000).map(c => ({image:c.image,caption:String(c.caption || '').slice(0,300)}));
    if (Array.isArray(raw.stops)) e.stops = raw.stops.slice(0,30).filter(p => p && typeof p.name === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat)<=90 && Math.abs(p.lng)<=180).map(p=>({name:p.name.slice(0,80),lat:p.lat,lng:p.lng}));
    return e;
  }
  function readEntries(raw) {
    if (!Array.isArray(raw) || raw.length > 200) throw new Error('备份格式不正确，最多支持 200 篇手记。');
    const result = raw.map(normalizeEntry);
    if (new Set(result.map(e => e.id)).size !== result.length) throw new Error('手记编号重复，无法导入。');
    return result.sort((a,b)=>(a.start || '9999').localeCompare(b.start || '9999'));
  }
  try { const saved = localStorage.getItem(KEY); entries = readEntries(saved ? JSON.parse(saved).entries : window.YANZ_ENTRIES || []); }
  catch { try { entries = readEntries(window.YANZ_ENTRIES || []); } catch { entries = []; } setTimeout(() => toast('本地草稿无法读取，已展示发布版本。原草稿未覆盖。'), 500); }
  function commit(next) {
    next = [...next].sort((a,b)=>(a.start || '9999').localeCompare(b.start || '9999'));
    try { localStorage.setItem(KEY, JSON.stringify({version:1, entries:next})); entries = next; render(); return true; }
    catch { toast('浏览器空间不足或禁止存储，未保存。请先导出备份，或减少照片。'); return false; }
  }
  const dateLabel = e => e.start ? `${e.start.replaceAll('-','.')} ${e.end && e.end !== e.start ? '— ' + e.end.replaceAll('-','.') : ''}`.trim() : '日期待补';
  function showDialog(id) { $('#' + id).showModal(); }
  $$('[data-close]').forEach(b => b.addEventListener('click', () => $('#' + b.dataset.close).close()));
  $$('dialog').forEach(d => d.addEventListener('click', ev => { if (ev.target === d) { const r = d.getBoundingClientRect(); if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) d.close(); } }));
  function newEntry(point, kind = 'travel') {
    $('#library').close(); $('#reader').close();
    form.reset(); form.elements.id.value = ''; form.elements.kind.value = kind;
    cover = ''; comics = []; renderComics(); updateCover(); $('#form-error').textContent = ''; $('#editor-title').textContent = kind === 'travel' ? '记下一段旅程' : '收藏一个生活片段';
    if (point) { form.elements.lat.value = point.lat.toFixed(4); form.elements.lng.value = point.lng.toFixed(4); }
    updateKind(); showDialog('editor');
  }
  function updateKind() {
    const travel = form.elements.kind.value === 'travel';
    $('.coordinates').hidden = !travel;
    ['lat','lng','place'].forEach(name => { form.elements[name].required = travel; });
    $('#editor-title').textContent = form.elements.id.value ? '编辑这篇手记' : travel ? '记下一段旅程' : '收藏一个生活片段';
  }
  function editEntry(id) {
    const e = entries.find(e => e.id === id); if (!e) return;
    $('#library').close(); form.reset();
    ['id','kind','title','place','lat','lng','start','end','story','itinerary','tips'].forEach(key => { form.elements[key].value = e[key] ?? ''; });
    cover = e.cover; comics = e.comics.map(c=>({...c})); renderComics(); updateCover(); updateKind(); $('#form-error').textContent = ''; showDialog('editor');
  }
  function updateCover() { $('#cover-preview').hidden = !cover; $('#cover-img').src = cover || ''; }
  $('#entry-kind').addEventListener('change', updateKind);
  $('#remove-cover').addEventListener('click', () => { cover = ''; $('#cover-input').value = ''; updateCover(); });
  $('#cover-input').addEventListener('change', async ev => {
    const file = ev.target.files[0]; if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) { toast('请选择 15MB 以内的 JPG、PNG 或 WebP 图片。'); ev.target.value = ''; return; }
    coverBusy = true; $('#save-entry').disabled = true;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f8f7f2'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
      const compressed = canvas.toDataURL('image/jpeg',.78);
      if (compressed.length > 1750000) throw new Error('图片压缩后仍较大，请换一张图片。');
      cover = compressed; updateCover();
    } catch (err) { toast(err.message || '这张图片无法读取，请重试。'); }
    finally { coverBusy = false; $('#save-entry').disabled = false; }
  });
  form.addEventListener('submit', ev => {
    ev.preventDefault(); if (coverBusy) return;
    try {
      const fields = Object.fromEntries(new FormData(form)); fields.cover = cover; fields.comics = comics; fields.id ||= crypto.randomUUID(); fields.stops = entries.find(x=>x.id===fields.id)?.stops || [];
      const e = normalizeEntry(fields); const previous = entries.findIndex(x => x.id === e.id); const next = [...entries];
      if (previous < 0) next.push(e); else next[previous] = e;
      if (next.length > 200) throw new Error('当前最多支持 200 篇手记，请先导出归档。');
      if (commit(next)) { $('#editor').close(); toast('已经记住了。故事慢慢写。'); selectedPoint = null; $('#map-selection').hidden = true; $('#selected-pin').replaceChildren(); }
    } catch (err) { $('#form-error').textContent = err.message; }
  });
  $('#manage').addEventListener('click', () => { renderLibrary(); $('#library-feedback').textContent = ''; showDialog('library'); });
  $('#library-add').addEventListener('click', () => newEntry(null));
  $('#add-trip').addEventListener('click', () => newEntry(selectedPoint));
  $('#add-at-point').addEventListener('click', () => newEntry(selectedPoint));
  $('#close-selection').addEventListener('click', () => { selectedPoint = null; $('#map-selection').hidden = true; $('#selected-pin').replaceChildren(); });
  function renderLibrary() {
    $('#library-list').innerHTML = entries.length ? entries.map(e => `<div class="library-row"><div><strong>${esc(e.title)}</strong><p>${e.kind === 'travel' ? '旅行' : '生活'} · ${esc(e.place || '日常')} · ${esc(dateLabel(e))}</p></div><div><button data-action="read" data-id="${e.id}">查看</button><button data-action="edit" data-id="${e.id}">编辑</button><button data-action="delete" data-id="${e.id}">删除</button></div></div>`).join('') : '<p class="library-empty">这里还是一张白纸。写下你的第一篇手记吧。</p>';
  }
  $('#library-list').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-action]'); if (!b) return;
    if (b.dataset.action === 'read') { $('#library').close(); openReader(b.dataset.id); }
    if (b.dataset.action === 'edit') editEntry(b.dataset.id);
    if (b.dataset.action === 'delete') {
      if (b.dataset.confirmed === 'yes') { if (commit(entries.filter(e => e.id !== b.dataset.id))) toast('手记已删除。'); }
      else { b.dataset.confirmed = 'yes'; b.textContent = '确认删除'; clearTimeout(deleteTimer); deleteTimer = setTimeout(renderLibrary, 3500); }
    }
  });
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], {type})); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  $('#export-json').addEventListener('click', () => { download(`YanZ-journal-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify({version:1,entries},null,2),'application/json'); toast('备份已导出，请妥善保留。'); });
  $('#export-site').addEventListener('click', () => { download('data.js', '// YanZ 的公开手记。请将本文件替换到网站目录，再重新发布。\nwindow.YANZ_ENTRIES = ' + JSON.stringify(entries,null,2) + ';\n', 'text/javascript'); toast('已导出 data.js，替换网站中的同名文件即可发布。'); });
  let pendingImport = null;
  $('#import-file').addEventListener('change', async ev => {
    const file = ev.target.files[0]; if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('备份不能大于 20MB。');
      const parsed = JSON.parse(await file.text()); if (parsed.version !== 1) throw new Error('备份版本不兼容。');
      pendingImport = readEntries(parsed.entries);
      $('#library-feedback').textContent = `读到 ${pendingImport.length} 篇手记。再次点击「确认替换」会替换当前浏览器的所有手记，请先备份。`;
      $('#import-json').textContent = '确认替换当前手记';
    } catch (err) { pendingImport = null; $('#import-json').textContent = '导入备份 ↑'; $('#library-feedback').textContent = err.message; }
    finally { ev.target.value = ''; }
  });
  // Import requires an explicit second click before replacing local entries.
  $('#import-json').addEventListener('click', () => {
    if (pendingImport) {
      if (commit(pendingImport)) { pendingImport = null; $('#library-feedback').textContent = '备份已导入。'; $('#import-json').textContent = '导入备份 ↑'; $('#import-json').onclick = null; toast('备份已导入。'); }
    } else $('#import-file').click();
  });

  function renderComics() {
    $('#comic-previews').innerHTML = comics.map((c,i)=>`<div class="comic-preview"><img src="${c.image}" alt="第 ${i+1} 张漫画"><div><label>第 ${i+1} 张的短注<input class="comic-caption" data-index="${i}" maxlength="300" value="${esc(c.caption)}" placeholder="一句话，留给这个画面"></label><button type="button" class="text-link" data-remove-comic="${i}">移除这一张 ×</button></div></div>`).join('');
    $('#comic-input').value = '';
  }
  $('#comic-previews').addEventListener('input',ev=>{if(ev.target.classList.contains('comic-caption')) comics[Number(ev.target.dataset.index)].caption=ev.target.value});
  $('#comic-previews').addEventListener('click',ev=>{const b=ev.target.closest('[data-remove-comic]');if(b){comics.splice(Number(b.dataset.removeComic),1);renderComics()}});
  $('#comic-input').addEventListener('change', async ev=>{
    const files=[...ev.target.files]; if(!files.length)return;
    if(comics.length+files.length>6){toast('一篇手记最多放 6 张漫画。');ev.target.value='';return}
    coverBusy=true; $('#save-entry').disabled=true;
    try {
      const added=[];
      for(const file of files){
        if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw new Error('请选择 15MB 以内的 JPG、PNG 或 WebP 漫画。');
        const bitmap=await createImageBitmap(file); const ratio=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)); const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const image=canvas.toDataURL('image/jpeg',.85);if(image.length>1750000)throw new Error('漫画图片过大，请缩小后再上传。');added.push({image,caption:''});
      }
      comics.push(...added);renderComics();
    }catch(err){toast(err.message)}finally{coverBusy=false;$('#save-entry').disabled=false}
  });
  function comicSection(e) {
    if(e.comics.length)return '<section class="comic-reading"><p class="eyebrow">THE STORY, IN FRAMES</p><h3>让画面，先说一会儿。</h3><div class="comic-pages">'+e.comics.map((c,i)=>`<figure><img src="${c.image}" alt="${esc(c.caption || '旅行漫画第 '+(i+1)+' 页')}" loading="lazy">${c.caption?'<figcaption>'+esc(c.caption)+'</figcaption>':''}</figure>`).join('')+'</div></section>';
    if(e.kind==='life')return '';
    return '<section class="comic-reading"><p class="eyebrow">A STORY WAITING TO BE DRAWN</p><h3>这一站的漫画，留一页空白。</h3><div class="comic-empty"><div><span>01</span><svg class="icon"><use href="#i-sun"/></svg><small>开场 · 一眼风景</small></div><div><span>02</span><svg class="icon"><use href="#i-pin"/></svg><small>途中 · 一个瞬间</small></div><div><span>03</span><svg class="icon"><use href="#i-book"/></svg><small>回望 · 一句心情</small></div></div><p class="field-hint">漫画留住画面，短文补上感受。等你慢慢画，慢慢写。</p></section>';
  }

  function openReader(id) {
    const e = entries.find(x => x.id === id); if (!e) return;
    const lines = text => text.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>`<li>${esc(s)}</li>`).join('');
    $('#reader-content').innerHTML = `${e.cover ? `<img class="reader-cover" src="${e.cover}" alt="${esc(e.title)}的封面">` : ''}<div class="reader-body"><p class="eyebrow">${e.kind === 'travel' ? 'A TRAVEL MEMORY' : 'A LITTLE MOMENT'} / BY YANZ</p><h2 id="reader-title">${esc(e.title)}</h2><p class="reader-meta">${esc(e.place || '生活片段')} · ${esc(dateLabel(e))}</p>${comicSection(e)}${e.story ? `<h3>画面之外的文字</h3><div class="story-text">${esc(e.story)}</div>` : '<div class="reserved-block"><span>文字手记 · 待补</span><p>这一段路已经走过，故事慢慢写。</p></div>'}${e.itinerary.trim() ? `<h3>这一路的行程</h3><p class="field-hint">旅行路线与每日安排，慢慢补全。</p><ol>${lines(e.itinerary)}</ol>` : ''}${e.tips.trim() ? `<h3>留给下次的实用笔记</h3><ul>${lines(e.tips)}</ul>` : '<div class="reserved-block"><span>实用攻略 · 待补</span><p>交通、住处、花费与一些想分享的小经验。</p></div>'}${e.kind === 'travel' ? `<button class="text-link" id="locate-entry" data-id="${e.id}">在地图上看看 <span>↗</span></button>` : ''}</div>`;
    showDialog('reader'); $('#reader').scrollTop = 0;
    $('#locate-entry')?.addEventListener('click', () => { $('#reader').close(); focusEntry(e); $('#atlas').scrollIntoView({behavior: 'smooth'}); });
  }
  function render() {
    const trips = entries.filter(e => e.kind === 'travel');
    $('#trip-count').textContent = String(trips.length).padStart(2,'0'); $('#life-count').textContent = String(entries.length - trips.length).padStart(2,'0'); $('#map-count').textContent = trips.length;
    $('#destination-list').innerHTML = trips.length ? trips.map((e,i) => `<button class="destination-button" data-id="${e.id}"><span class="number">${String(i+1).padStart(2,'0')}</span><span><strong>${esc(e.place)}</strong><small>${esc(e.title)}</small></span>${icon('arrow')}</button>`).join('') : '<div class="sidebar-empty"><strong>第一站，会在哪里？</strong>这里还没有足迹。<br>让故事从你选择的地方开始。<button class="text-link" id="first-trip">记录第一站 <span>↗</span></button></div>';
    $('#first-trip')?.addEventListener('click', () => newEntry(null));
    $('#destination-list').querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => { focusEntry(entries.find(e => e.id === b.dataset.id)); openReader(b.dataset.id); }));
    const visible = entries.filter(e => filter === 'all' || e.kind === filter);
    $('#journal-grid').innerHTML = visible.length ? visible.map(e => `<button class="journal-card" data-id="${e.id}"><div class="card-image">${e.cover ? `<img src="${e.cover}" alt="${esc(e.title)}的封面" loading="lazy">` : `<span class="card-placeholder"><span>${String(entries.indexOf(e)+1).padStart(2,'0')}</span>${icon(e.kind === 'travel' ? 'globe' : 'sun')}<small>等待一张属于这里的照片</small></span>`}<span class="card-type">${e.story || e.comics.length ? (e.kind === 'travel' ? '旅行' : '生活') : '故事待续'}</span></div><span class="card-meta">${esc(e.place || '日常')} · ${esc(dateLabel(e))}</span><h3>${esc(e.title)}</h3><p>${esc(e.story || '已经走过的路，等一幅漫画、一段文字，慢慢补全。')}</p><span class="card-bottom">翻开这一页 <span>↗</span></span></button>`).join('') : `<div class="empty-journal"><div class="empty-illustration" aria-hidden="true"><div class="paper-page"></div><span>✳</span></div><div><h3>${entries.length ? '这一页，等一个新的故事。' : '好故事，不着急开场。'}</h3><p>${entries.length ? '这个分类还没有手记，记下一个值得收藏的瞬间。' : '第一篇手记还在路上。等你想写的时候，<br>这里会好好收藏每一个瞬间。'}</p><button class="text-link" id="first-note">写下${entries.length ? '一篇新' : '第一篇'}手记 <span>↗</span></button></div></div>`;
    $('#first-note')?.addEventListener('click', () => newEntry(null,filter === 'life' ? 'life' : 'travel'));
    $$('.journal-card').forEach(b => b.addEventListener('click', () => openReader(b.dataset.id)));
    renderPins(); renderLibrary();
  }
  $$('.journal-filters button').forEach(b => b.addEventListener('click', () => { filter = b.dataset.filter; $$('.journal-filters button').forEach(other => { other.classList.toggle('active',other === b); other.setAttribute('aria-pressed',other === b); }); render(); }));
  const project = (lng, lat) => [((lng + 180) / 360) * 1000, ((90 - lat) / 180) * 500];
  const ns = 'http://www.w3.org/2000/svg';
  function svgEl(type, attrs) { const el = document.createElementNS(ns,type); Object.entries(attrs).forEach(([key,value])=>el.setAttribute(key,value)); return el; }
  async function loadMap() {
    try {
      const response = await fetch('./assets/world.geojson'); if (!response.ok) throw new Error('map'); const data = await response.json(); const fragment = document.createDocumentFragment();
      data.features.forEach(f => {
        if (f.properties.ADMIN === 'Antarctica') return;
        const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        const d = polygons.map(polygon => polygon.map(ring => ring.map((point,i) => (i ? 'L' : 'M') + project(point[0],point[1]).map(n=>n.toFixed(2)).join(',')).join('')+'Z').join('')).join('');
        const shape = svgEl('path',{d,'fill-rule':'evenodd'}); const title = svgEl('title',{}); title.textContent = f.properties.ADMIN || ''; shape.append(title); fragment.append(shape);
      });
      $('#countries').append(fragment);
    } catch { $('#map-error').hidden = false; }
  }
  function renderPins() {
    $('#map-pins').replaceChildren();
    const trips=entries.filter(e=>e.kind==='travel');
    trips.forEach(e=>{
      const stops=e.stops.length?e.stops:[{name:e.place,lat:e.lat,lng:e.lng}];
      if(stops.length>1){const d=stops.map((p,i)=>(i?'L':'M')+project(p.lng,p.lat).join(',')).join(' ');$('#map-pins').append(svgEl('path',{d,class:'route-line'}))}
      stops.forEach((stop,i)=>{
        const [x,y]=project(stop.lng,stop.lat);const group=svgEl('g',{class:'map-marker',transform:`translate(${x} ${y})`,tabindex:0,role:'button','aria-label':`${stop.name}：${e.title}`});
        group.append(svgEl('circle',{r:i===0?4.7:3.3}));const label=svgEl('text',{x:9,y:-7});label.textContent=stop.name;group.append(label);
        group.addEventListener('click',ev=>{ev.stopPropagation();openReader(e.id)});group.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();openReader(e.id)}});$('#map-pins').append(group);
      });
    });
  }
  let center = [500,250];
  function setView() {
    const w = 1000 / zoom, h = 500 / zoom;
    center[0] = Math.max(w/2,Math.min(1000-w/2,center[0])); center[1] = Math.max(h/2,Math.min(500-h/2,center[1]));
    $('#world-map').setAttribute('viewBox',`${center[0]-w/2} ${center[1]-h/2} ${w} ${h}`);
    $('#map-state').textContent = region === 'asia' ? '亚洲地图' : '世界地图';
    ['world','asia'].forEach(r=>{const b = $('#' + r + '-view');b.classList.toggle('active',r===region);b.setAttribute('aria-pressed',r===region)});
  }
  function focusEntry(e) { if (!e) return; region = e.lng > 55 && e.lng < 180 ? 'asia' : 'world'; center = project(e.lng,e.lat); zoom = 3; setView(); }
  $('#world-view').addEventListener('click',()=>{region='world';zoom=1;center=[500,250];setView()});
  $('#asia-view').addEventListener('click',()=>{region='asia';zoom=2.6;center=project(107,23);setView()});
  $('#zoom-in').addEventListener('click',()=>{zoom=Math.min(8,zoom*1.35);setView()});
  $('#zoom-out').addEventListener('click',()=>{zoom=Math.max(1,zoom/1.35);setView()});
  $('#zoom-reset').addEventListener('click',()=>{region='world';zoom=1;center=[500,250];setView()});
  $('#world-map').addEventListener('click',ev=>{
    if (ev.target.closest('.map-marker')) return;
    const svg = $('#world-map'); const pt = new DOMPoint(ev.clientX,ev.clientY).matrixTransform(svg.getScreenCTM().inverse());
    const lng = pt.x / 1000 * 360 - 180, lat = 90 - pt.y / 500 * 180;
    if (Math.abs(lng)>180 || Math.abs(lat)>90) return;
    selectedPoint = {lng,lat}; $('#selected-coordinate').textContent = `${Math.abs(lat).toFixed(2)}° ${lat>=0?'N':'S'} / ${Math.abs(lng).toFixed(2)}° ${lng>=0?'E':'W'}`; $('#map-selection').hidden = false;
    const p = svgEl('circle',{cx:pt.x,cy:pt.y,r:4/Math.sqrt(zoom),fill:'#c97853',stroke:'#fffdf4','stroke-width':2/zoom}); $('#selected-pin').replaceChildren(p);
  });
  $('#year').textContent = new Date().getFullYear();
  render(); loadMap();
})();

