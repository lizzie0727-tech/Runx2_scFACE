'use strict';
const $=id=>document.getElementById(id);
const cfg=window.RUNX2_CONFIG||{};
const configured=cfg.supabaseUrl?.startsWith('https://')&&!cfg.supabaseUrl.includes('YOUR_PROJECT')&&cfg.supabaseAnonKey&&!cfg.supabaseAnonKey.includes('YOUR_');
let client=null,user=null,papers=[],progress=new Map(),analyses=new Map(),analysisJobs=new Map();
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function toast(msg){$('toast').textContent=msg;$('toast').style.display='block';setTimeout(()=>$('toast').style.display='none',4500);}
function paperExternalUrl(p){
  const raw=String(p.url||'').trim();
  const doi=normalizeDoi(p.doi||'');
  function doiLink(value){
    const d=normalizeDoi(value);
    return /^10\.\d{4,9}\/\S+$/i.test(d)?'https://doi.org/'+encodeURI(d):'';
  }
  // Prefer a valid, external article URL; reject scFACE links accidentally stored as paper URLs.
  if(raw){
    const directDoi=doiLink(raw);
    if(directDoi)return directDoi;
    let candidate=raw;
    if(/^doi\.org\//i.test(candidate))candidate='https://'+candidate;
    else if(/^www\./i.test(candidate))candidate='https://'+candidate;
    try{
      const u=new URL(candidate);
      const ownHost=location.hostname.toLowerCase();
      const isOwnSite=u.hostname.toLowerCase()===ownHost &&
        (u.pathname===location.pathname || u.pathname.startsWith('/scFACE/'));
      if(['https:','http:'].includes(u.protocol)&&!isOwnSite)return u.href;
    }catch{}
  }
  return doiLink(doi);
}
function statusOf(id){return progress.get(id)?.status||'unread';}
function stats(){let counts={unread:0,reading:0,read:0};papers.forEach(p=>counts[statusOf(p.id)]++);$('stats').textContent=`共 ${papers.length} 篇 ｜ 未读 ${counts.unread} ｜ 在读 ${counts.reading} ｜ 已读 ${counts.read} ｜ 当前显示 ${document.querySelectorAll('.card').length} 篇`;}
function figCard(c){return `<div class="figure"><b>${esc(c.figure||'Figure / panel 待核实')}</b><div><b>Method：</b>${esc(c.method)}</div>${c.detail?`<div><b>内容：</b>${esc(c.detail)}</div>`:''}<div><b>对 RUNX2 的价值：</b>${esc(c.why)}</div><small>${esc(c.verification||'具体图号待核实')}</small></div>`;}
function card(p){const s=statusOf(p.id);return `<article class="card" data-id="${esc(p.id)}"><div class="row"><span class="tag">${esc(p.topic)}</span><span class="stars">${'★'.repeat(p.stars)}${'☆'.repeat(5-p.stars)}</span></div><h3>${esc(p.title)}</h3><div class="meta">${esc(p.authors)} · ${esc(p.journal)} · ${esc(p.publication_year)}</div>${verificationLabel(p)?`<p class="small"><span class="pill">${verificationLabel(p)}</span></p>`:""}<p><b>Key finding：</b>${esc(p.key_finding)}</p><p><b>RUNX2 relevance：</b>${esc(p.runx2_value)}</p><div class="row"><a class="detailLink primaryLink" href="#paper/${encodeURIComponent(p.id)}">打开详细学习页面 →</a><select class="readStatus" aria-label="阅读状态"><option value="unread" ${s==='unread'?'selected':''}>未读</option><option value="reading" ${s==='reading'?'selected':''}>在读</option><option value="read" ${s==='read'?'selected':''}>已读</option></select></div></article>`;}
function verificationLabel(p){return p.verification_status==='original_figures_checked'?'原始 Figure 已核对':p.verification_status==='paper_confirmed_figure_pending'?'Figure 待核对':'';}
function aiResultSection(id){
 const record=analyses.get(id), job=analysisJobs.get(id);
 const a=record?.result;
 const status=job?.status==='running'?'AI 正在阅读全文及图像，请稍后刷新状态…':job?.status==='failed'?'分析失败：'+(job.error||'请重试'):a?'已保存 AI 全文分析':'尚未分析 PDF';
 const figures=Array.isArray(a?.figure_cards)?a.figure_cards:[];
 const items=figures.map(c=>`<div class="figure"><b>${esc(c.figure||'Figure 未核实')}</b><p><b>Question：</b>${esc(c.question)}</p><p><b>Methods：</b>${esc(c.method)}</p><p><b>Results：</b>${esc(c.result)}</p><p><b>Evidence：</b>${esc(c.evidence)}</p><p><b>RUNX2 relevance：</b>${esc(c.why)}</p><small>${esc(c.verification)}</small></div>`).join('');
 return `<section class="detailSection aiAnalysis"><h3>AI Full-text Learning Guide</h3><p class="muted">${esc(status)}。AI 内容仅供学习，图号和结论请对照 PDF 核实。</p><div class="row"><button class="analyzeLatest primary" type="button">分析最近上传的 PDF</button><button class="refreshAnalysis" type="button">刷新分析状态</button></div>${a?`<p><b>Key Finding：</b>${esc(a.key_finding)}</p><p><b>Methods：</b>${esc(a.methods)}</p><p><b>Why It Matters to RUNX2：</b>${esc(a.runx2_value)}</p><p><b>Figure Learning Guide：</b>${esc(a.figures)}</p>${items}<p class="muted">${esc(a.limitations||'')}</p><small>来源：私人 PDF · ${esc(record.updated_at||'')}</small>`:''}</section>`;
}
async function refreshAnalysis(id){
 const [a,b]=await Promise.all([client.from('paper_ai_analyses').select('paper_id,result,updated_at').eq('paper_id',id).maybeSingle(),client.from('paper_ai_jobs').select('paper_id,status,error,updated_at').eq('paper_id',id).maybeSingle()]);
 if(a.error||b.error)throw Error(a.error?.message||b.error?.message);
 if(a.data)analyses.set(id,a.data);if(b.data)analysisJobs.set(id,b.data);
 const p=papers.find(x=>String(x.id)===String(id));if(p&&location.hash==='#paper/'+encodeURIComponent(id)){$('detailView').innerHTML=detailPage(p);}
}
async function analyzePdf(id,path){
 const {data,error}=await client.functions.invoke('analyze-paper',{body:{paper_id:id,storage_path:path}});
 if(error)throw Error(error.message||'Edge Function 调用失败');
 if(!data?.ok)throw Error(data?.error||'分析请求未被接受');
 toast('AI 分析任务已提交，完成后将自动保存');
 await refreshAnalysis(id);
 pollAnalysis(id);
}
async function latestPdfPath(id){
 const {data,error}=await client.storage.from('paper-pdfs').list(`${user.id}/${id}`,{limit:100});
 if(error)throw error;if(!data?.length)throw Error('请先上传 PDF');
 const files=data.filter(x=>x.name?.toLowerCase().endsWith('.pdf')).sort((a,b)=>b.name.localeCompare(a.name));
 if(!files.length)throw Error('没有找到 PDF');
 return `${user.id}/${id}/${files[0].name}`;
}
async function pollAnalysis(id){
 for(let i=0;i<60;i++){
   await new Promise(resolve=>setTimeout(resolve,5000));
   if(!user)return;
   try{await refreshAnalysis(id);const state=analysisJobs.get(id)?.status;if(state==='done'||state==='failed'){toast(state==='done'?'AI 全文分析已保存':'AI 分析失败，请查看详情');return;}}catch{}
 }
 toast('分析仍在进行，请稍后点击刷新分析状态');
}
function parseNoteEntries(raw){
 const value=String(raw||'');if(!value.trim())return [];
 try{const data=JSON.parse(value);if(Array.isArray(data)&&data.every(x=>x&&typeof x.text==='string'))return data; }catch{}
 return [{id:'legacy',text:value,created_at:null}];
}
function notesSection(id){
 const items=parseNoteEntries(progress.get(id)?.notes);
 const cards=items.length?items.map((note,i)=>`<div class="savedNote" data-note-id="${esc(note.id)}"><div class="row"><span class="muted">笔记 ${i+1}${note.created_at?' · '+esc(new Date(note.created_at).toLocaleString('zh-CN')):''}</span><button type="button" class="deleteNote" data-note-id="${esc(note.id)}" aria-label="删除此笔记">删除</button></div><p class="savedNoteText">${esc(note.text)}</p></div>`).join(''):'<p class="muted emptyNotes">暂无笔记，写下第一条吧。</p>';
 return `<section class="detailSection"><h3>个人学习笔记</h3><div class="savedNotes">${cards}</div><label for="noteDraft">添加新笔记</label><textarea id="noteDraft" class="notes" placeholder="记录 Figure、实验设计、与 RUNX2 的联系……"></textarea><button type="button" class="addNote primary">＋ 添加笔记</button><p class="muted">每次保存都会追加到页面，不会覆盖已有笔记；可以单独删除。</p></section>`;
}
async function addNote(id,cardEl){
 const box=cardEl.querySelector('#noteDraft');const text=box?.value.trim();if(!text)return toast('请先输入笔记内容');
 const items=parseNoteEntries(progress.get(id)?.notes);
 items.push({id:crypto.randomUUID(),text,created_at:new Date().toISOString()});
 await save(id,{notes:JSON.stringify(items)});
 const p=papers.find(x=>String(x.id)===String(id));if(p){cardEl.querySelector('.detailSection:has(.savedNotes)').outerHTML=notesSection(id);}
 toast('笔记已添加并保存');
}
async function deleteNote(id,noteId,cardEl){
 if(!window.confirm('确定删除这条笔记吗？删除后无法恢复。'))return;
 const items=parseNoteEntries(progress.get(id)?.notes).filter(x=>String(x.id)!==String(noteId));
 await save(id,{notes:JSON.stringify(items)});
 cardEl.querySelector('.detailSection:has(.savedNotes)').outerHTML=notesSection(id);
 toast('笔记已删除');
}
function detailPage(p){const s=statusOf(p.id),n=progress.get(p.id)?.notes||'',figures=Array.isArray(p.figure_cards)?p.figure_cards:[];const figureBlock=figures.length?figures.map(figCard).join(''):'<p class="muted">尚无经核对的 Figure 卡片；请结合原文阅读。</p>';return `<div class="detailHeader"><a href="#" class="backLink">← 返回文献列表</a><span class="stars">${'★'.repeat(p.stars)}${'☆'.repeat(5-p.stars)}</span></div><article class="detailArticle" data-id="${esc(p.id)}"><span class="tag">${esc(p.topic)}</span><h2>${esc(p.title)}</h2><p class="meta">${esc(p.authors)} · ${esc(p.journal)} · ${esc(p.publication_year)}</p>${verificationLabel(p)?`<p class="small"><span class="pill">${verificationLabel(p)}</span></p>`:""}<div class="row detailActions">${paperExternalUrl(p)?`<a href="${esc(paperExternalUrl(p))}" target="_blank" rel="noopener noreferrer">打开原文 / DOI ↗</a>`:`<span class="muted" title="此文献尚未保存有效的原文 URL 或 DOI">暂无有效原文链接</span>`}<label>阅读状态 <select class="readStatus"><option value="unread" ${s==='unread'?'selected':''}>未读</option><option value="reading" ${s==='reading'?'selected':''}>在读</option><option value="read" ${s==='read'?'selected':''}>已读</option></select></label></div><section class="detailSection"><h3>Key Finding</h3><p>${esc(p.key_finding)}</p></section><section class="detailSection"><h3>Why it matters to RUNX2</h3><p>${esc(p.runx2_value)}</p></section><section class="detailSection"><h3>Methods</h3><p>${esc(p.methods)}</p></section><section class="detailSection"><h3>Figure learning guide</h3><p>${esc(p.figures)}</p>${figureBlock}</section>${aiResultSection(p.id)}${notesSection(p.id)}<section class="detailSection"><h3>私人 PDF</h3><p class="muted">PDF 上传后将自动提交 AI 全文分析；分析结果单独保存，不覆盖原文献和个人笔记。</p><input class="pdfFile file" type="file" accept="application/pdf"><div class="row pdfActions"><button class="uploadPdf">上传 PDF</button><button class="openPdf">查看我的 PDF</button><button class="extractPdf">本地提取 PDF 文本</button></div><textarea class="pdfText hidden" readonly placeholder="提取的文本"></textarea></section></article>`;}
function showRoute(){
 const isAdd=location.hash==='#add';
 const match=location.hash.match(/^#paper\/(.+)$/);
 let p=null;
 if(match){try{p=papers.find(x=>String(x.id)===decodeURIComponent(match[1]));}catch{}}
 $('listView').classList.toggle('hidden',!!p||isAdd);
 $('detailView').classList.toggle('hidden',!p);
 $('addView').classList.toggle('hidden',!isAdd);
 if(p){$('detailView').innerHTML=detailPage(p);window.scrollTo(0,0);refreshAnalysis(p.id).catch(e=>console.warn('AI analysis not available:',e.message));}
 else if(isAdd){$('addView').innerHTML=addPage();window.scrollTo(0,0);}
 else if(match){location.hash='';}
}
function addPage(){return `<div class="detailHeader"><a href="#" class="backLink">← 返回文献列表</a></div><article class="detailArticle"><h2>＋ 手动添加文献</h2><p class="muted">DOI / PMID 可尝试从 Europe PMC 获取元数据；请核对后再保存。Figure 内容不会自动认定为已核实。</p><form id="paperForm" class="addForm"><label>DOI 或 PMID（选填）<input id="newIdentifier" placeholder="10.1038/... 或 PMID:39832706"></label><div class="formRow"><button type="button" id="lookupPaper">查询并填入论文信息</button><span id="lookupMessage" class="addHint">也可以完全手动填写；不需要 DOI。</span></div><label>论文标题 *<input id="newTitle" required maxlength="1000"></label><div class="formRow"><label>作者<input id="newAuthors" placeholder="First author et al."></label><label>期刊<input id="newJournal"></label><label>发表年份<input id="newYear" placeholder="2026" maxlength="12"></label></div><label>原文网址<input id="newUrl" type="url" placeholder="https://doi.org/..."></label><div class="formRow"><label>研究主题<input id="newTopic" value="Craniofacial development" list="topicSuggestions"></label><label>个人推荐星级<select id="newStars"><option value="5">★★★★★</option><option value="4" selected>★★★★</option><option value="3">★★★</option><option value="2">★★</option><option value="1">★</option></select></label></div><datalist id="topicSuggestions">${[...new Set(papers.map(x=>x.topic))].map(x=>`<option value="${esc(x)}"></option>`).join('')}</datalist><label>Key finding<textarea id="newFinding" placeholder="论文主要发现（请自己核对原文）"></textarea></label><label>对 RUNX2 研究的价值<textarea id="newRelevance" placeholder="与 WT/HT、E13.5、空间转录组或细胞互作的联系"></textarea></label><label>Methods<textarea id="newMethods" placeholder="值得学习的实验或分析方法"></textarea></label><label>Figure 学习提示<textarea id="newFigures" placeholder="建议关注的图，未核实的图号请明确标记"></textarea></label><div class="addHint">保存后可以在文献详情页继续编辑个人笔记、阅读状态和上传 PDF。自动检索程序不会删除手动添加的文献。</div><button type="submit" id="savePaperBtn" class="primary">保存到我的文献库</button><p id="addMessage" role="status"></p></form></article>`;}
function normalizeDoi(s){return String(s||'').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi\s*:\s*/i,'').trim().toLowerCase();}
function parseIdentifier(s){let v=String(s||'').trim();if(!v)return {doi:'',pmid:''};let pm=v.match(/^(?:pmid\s*:\s*|https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/)(\d+)\/?$/i);if(pm)return {doi:'',pmid:pm[1]};if(/^\d{5,10}$/.test(v))return {doi:'',pmid:v};let doi=normalizeDoi(v);if(!/^10\.\d{4,9}\/\S+$/i.test(doi))throw Error('请输入有效 DOI、PMID，或留空并手动填写');return {doi,pmid:''};}
async function lookupMetadata(){const btn=$('lookupPaper'),msg=$('lookupMessage');let ident;try{ident=parseIdentifier($('newIdentifier').value);if(!ident.doi&&!ident.pmid)throw Error('请先输入 DOI 或 PMID');btn.disabled=true;msg.textContent='正在查询 Europe PMC…';let q=ident.doi?`DOI:${ident.doi}`:`EXT_ID:${ident.pmid} AND SRC:MED`;let response=await fetch('https://www.ebi.ac.uk/europepmc/webservices/rest/search?query='+encodeURIComponent(q)+'&format=json&pageSize=3');if(!response.ok)throw Error('Europe PMC 返回 HTTP '+response.status);let data=await response.json();let x=data.resultList?.result?.[0];if(!x)throw Error('未找到论文，请手动填写');if(ident.doi&&normalizeDoi(x.doi)!==ident.doi)throw Error('DOI 未精确匹配');if(ident.pmid&&String(x.id)!==ident.pmid)throw Error('PMID 未精确匹配');$('newTitle').value=x.title||'';$('newAuthors').value=x.authorString||'';$('newJournal').value=x.journalTitle||'';$('newYear').value=x.pubYear||'';$('newUrl').value=x.doi?'https://doi.org/'+x.doi:(x.id?'https://pubmed.ncbi.nlm.nih.gov/'+x.id+'/':'');if(x.doi&&!ident.doi)$('newIdentifier').value=x.doi;msg.textContent='已填入元数据，请核对标题、作者及年份后保存。';}catch(e){msg.textContent='查询未完成：'+e.message+'；可以手动填写。';}finally{btn.disabled=false;}}
async function insertManualPaper(e){e.preventDefault();const btn=$('savePaperBtn'),msg=$('addMessage');try{if(!user)throw Error('请先登录');let ident=parseIdentifier($('newIdentifier').value);let title=$('newTitle').value.trim();if(!title)throw Error('标题不能为空');let dup=papers.find(p=>(ident.doi&&normalizeDoi(p.doi)===ident.doi)||(ident.pmid&&String(p.pmid)===ident.pmid)||p.title.trim().toLowerCase()===title.toLowerCase());if(dup){msg.textContent='文献已存在，正在打开原记录。';location.hash='#paper/'+encodeURIComponent(dup.id);return;}btn.disabled=true;msg.textContent='正在保存…';let row={source_key:ident.doi?'doi:'+ident.doi:ident.pmid?'pmid:'+ident.pmid:'manual:'+crypto.randomUUID(),doi:ident.doi||null,pmid:ident.pmid||null,title,authors:$('newAuthors').value.trim(),journal:$('newJournal').value.trim(),publication_year:$('newYear').value.trim(),url:$('newUrl').value.trim()||(ident.doi?'https://doi.org/'+ident.doi:''),topic:$('newTopic').value.trim()||'Other',figures:$('newFigures').value.trim(),methods:$('newMethods').value.trim(),key_finding:$('newFinding').value.trim(),runx2_value:$('newRelevance').value.trim(),figure_cards:[],stars:Number($('newStars').value),verification_status:'historical_metadata_unverified',provenance:'manual_user'};let {data,error}=await client.from('papers').insert(row).select('id').single();if(error){if(error.code==='23505')throw Error('数据库已有相同 DOI、PMID 或来源编号；请返回搜索该文献');throw error;}await load();toast('文献已加入 scFACE');location.hash='#paper/'+encodeURIComponent(data.id);}catch(err){msg.textContent='保存失败：'+err.message;}finally{btn.disabled=false;}}


function render(){let q=$('search').value.toLowerCase().trim(),topic=$('topic').value,status=$('status').value,stars=Number($('stars').value);
 let filtered=papers.filter(p=>(!topic||p.topic===topic)&&(!status||statusOf(p.id)===status)&&p.stars>=stars&&(!q||[p.title,p.authors,p.journal,p.topic,p.methods,p.figures,p.key_finding,p.runx2_value,p.doi,JSON.stringify(p.figure_cards)].join(' ').toLowerCase().includes(q)));
 $('cards').innerHTML=filtered.length?filtered.map(card).join(''):'<div class="panel">当前筛选没有匹配的文献，请调整搜索条件。</div>';stats();showRoute();}
async function load(){const [a,b]=await Promise.all([client.from('papers').select('*').order('stars',{ascending:false}).order('added_at',{ascending:false}).range(0,999),client.from('reading_progress').select('paper_id,status,notes').eq('user_id',user.id).range(0,999)]);if(a.error||b.error)throw Error(a.error?.message||b.error?.message);papers=a.data||[];progress=new Map((b.data||[]).map(x=>[x.paper_id,x]));let topics=[...new Set(papers.map(p=>p.topic))].sort();$('topic').innerHTML='<option value="">全部主题</option>'+topics.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');render();}
async function save(id,changes){const prev=progress.get(id)||{status:'unread',notes:''};let record={user_id:user.id,paper_id:id,status:changes.status??prev.status,notes:changes.notes??prev.notes,updated_at:new Date().toISOString()};let {error}=await client.from('reading_progress').upsert(record,{onConflict:'user_id,paper_id'});if(error)throw error;progress.set(id,record);}
async function handleCard(e){let cardEl=e.target.closest('[data-id]');if(!cardEl)return;let id=cardEl.dataset.id;try{
 if(e.target.matches('.readStatus')){await save(id,{status:e.target.value});render();}
 if(e.target.matches('.addNote')){await addNote(id,cardEl);}
 if(e.target.matches('.deleteNote')){await deleteNote(id,e.target.dataset.noteId,cardEl);}
 if(e.target.matches('.uploadPdf')){let file=cardEl.querySelector('.pdfFile').files[0];if(!file)return toast('请先选择 PDF');if(file.type!=='application/pdf'||file.size>25*1024*1024)return toast('仅支持 25MB 以内的 PDF');let path=`${user.id}/${id}/${Date.now()}_${file.name.replace(/[^\w.\-]/g,'_')}`;let {error}=await client.storage.from('paper-pdfs').upload(path,file,{contentType:'application/pdf',upsert:false});if(error)throw error;toast('PDF 已上传，正在提交 AI 全文分析');await analyzePdf(id,path);}
 if(e.target.matches('.analyzeLatest')){await analyzePdf(id,await latestPdfPath(id));}
 if(e.target.matches('.refreshAnalysis')){await refreshAnalysis(id);toast('分析状态已刷新');}
 if(e.target.matches('.openPdf')){let {data,error}=await client.storage.from('paper-pdfs').list(`${user.id}/${id}`,{limit:100});if(error)throw error;if(!data?.length)return toast('这篇文章还没有上传 PDF');let latest=[...data].sort((a,b)=>b.name.localeCompare(a.name))[0];let path=`${user.id}/${id}/${latest.name}`;let signed=await client.storage.from('paper-pdfs').createSignedUrl(path,120);if(signed.error)throw signed.error;window.open(signed.data.signedUrl,'_blank','noopener');}
 if(e.target.matches('.extractPdf')){let file=cardEl.querySelector('.pdfFile').files[0];if(!file)return toast('请先选择本机 PDF');if(!window.pdfjsLib)return toast('PDF 阅读组件未加载，请联网后重试');pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';let pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;let parts=[];for(let i=1;i<=Math.min(pdf.numPages,20);i++){let page=await pdf.getPage(i);let txt=await page.getTextContent();parts.push(`Page ${i}:\n`+txt.items.map(x=>x.str).join(' '));}let box=cardEl.querySelector('.pdfText');box.classList.remove('hidden');box.value=parts.join('\n\n');toast(`已提取前 ${Math.min(pdf.numPages,20)} 页文本（不支持扫描版 OCR）`);}
 }catch(err){toast('操作失败：'+err.message);}}

async function start() {
  if (!configured || !window.supabase) {
    $('authMsg').textContent =
      '请先配置 site/config.js 中的 Supabase URL 和公开 anon key，并确保可以访问 Supabase JS。';
    return;
  }

  client = supabase.createClient(
    cfg.supabaseUrl,
    cfg.supabaseAnonKey
  );

  client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => updateSession(session), 0);
  });

  const { data } = await client.auth.getSession();
  await updateSession(data.session);
}

async function updateSession(session) {
  const next = session?.user || null;

  if (next?.id === user?.id) return;

  user = next;

  $('login').classList.toggle('hidden', !!user);
  $('app').classList.toggle('hidden', !user);
  $('signout').classList.toggle('hidden', !user);

  if (user) {
    try {
      await load();
    } catch (e) {
      toast('数据库加载失败：' + e.message);
    }
  }
}

// 邮箱 + 密码登录
$('loginBtn').onclick = async () => {
  if (!client) {
    return toast('请先配置 Supabase');
  }

  const email = $('email').value.trim();
  const password = $('loginPassword').value;

  if (!email) {
    return toast('请输入邮箱');
  }

  if (!password) {
    return toast('请输入密码');
  }

  $('loginBtn').disabled = true;
  $('authMsg').textContent = '正在登录...';

  try {
    const { error } = await client.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      $('authMsg').textContent = '登录失败：' + error.message;
    } else {
      $('authMsg').textContent = '';
      $('loginPassword').value = '';
    }
  } catch (e) {
    $('authMsg').textContent = '登录失败：' + e.message;
  } finally {
    $('loginBtn').disabled = false;
  }
};

// 退出登录
$('signout').onclick = async () => {
  await client?.auth.signOut();

  user = null;

  $('login').classList.remove('hidden');
  $('app').classList.add('hidden');
  $('signout').classList.add('hidden');
};

for(let id of ['search','topic','status','stars'])$(id).addEventListener(id==='search'?'input':'change',render);
for(const area of ['cards','detailView']){$(area).addEventListener('click',handleCard);$(area).addEventListener('change',e=>{if(e.target.matches('.readStatus'))handleCard(e);});}window.addEventListener('hashchange',showRoute);
$('addView').addEventListener('click',e=>{if(e.target.closest('#lookupPaper'))lookupMetadata();});
$('addView').addEventListener('submit',e=>{if(e.target.id==='paperForm')insertManualPaper(e);});
$('exportBtn').onclick=()=>{let content=JSON.stringify({exported_at:new Date().toISOString(),progress:[...progress.entries()].map(([paper_id,x])=>({paper_id,status:x.status,notes:x.notes}))},null,2);let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'application/json'}));a.download='RUNX2_reading_progress.json';a.click();URL.revokeObjectURL(a.href);};
start();
