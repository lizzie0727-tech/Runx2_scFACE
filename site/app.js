'use strict';
const $=id=>document.getElementById(id);
const cfg=window.RUNX2_CONFIG||{};
const configured=cfg.supabaseUrl?.startsWith('https://')&&!cfg.supabaseUrl.includes('YOUR_PROJECT')&&cfg.supabaseAnonKey&&!cfg.supabaseAnonKey.includes('YOUR_');
let client=null,user=null,papers=[],progress=new Map(),analyses=new Map(),analysisJobs=new Map();
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function toast(msg){$('toast').textContent=msg;$('toast').style.display='block';setTimeout(()=>$('toast').style.display='none',4500);}
function paperExternalUrl(p){
  const raw=String(analyses.get(p.id)?.result?.article_url||p.url||'').trim();
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
function stats(){let counts={unread:0,reading:0,read:0};papers.forEach(p=>counts[statusOf(p.id)]++);$('stats').textContent=`Total ${papers.length} papers | Unread ${counts.unread} | Reading ${counts.reading} | Read ${counts.read} | Showing ${document.querySelectorAll('.card').length}`;}
function figCard(c){return `<div class="figure"><b>${esc(c.figure||'Figure / panel not verified')}</b><div><b>Method：</b>${esc(c.method)}</div>${c.detail?`<div><b>Details: </b>${esc(c.detail)}</div>`:''}<div><b>RUNX2 Relevance: </b>${esc(c.why)}</div><small>${esc(c.verification||'Figure number not verified')}</small></div>`;}
function card(p){const s=statusOf(p.id);return `<article class="card" data-id="${esc(p.id)}"><div class="row"><span class="tag">${esc(p.topic)}</span><span class="stars">${'★'.repeat(p.stars)}${'☆'.repeat(5-p.stars)}</span></div><h3>${esc(p.title)}</h3><div class="meta">${esc(p.authors)} · ${esc(p.journal)} · ${esc(p.publication_year)}</div>${verificationLabel(p)?`<p class="small"><span class="pill">${verificationLabel(p)}</span></p>`:""}<p><b>Key Finding：</b>${esc(p.key_finding)}</p><p><b>RUNX2 relevance：</b>${esc(p.runx2_value)}</p><div class="row"><a class="detailLink primaryLink" href="#paper/${encodeURIComponent(p.id)}">Open Paper →</a><select class="readStatus" aria-label="Reading Status"><option value="unread" ${s==='unread'?'selected':''}>Unread</option><option value="reading" ${s==='reading'?'selected':''}>Reading</option><option value="read" ${s==='read'?'selected':''}>Read</option></select></div></article>`;}
function verificationLabel(p){return p.verification_status==='original_figures_checked'?'Original figures verified':p.verification_status==='paper_confirmed_figure_pending'?'Figures not yet verified':'';}
function manualGuide(id){
 const record=analyses.get(id),a=record?.result||{},cards=Array.isArray(a.figure_cards)?a.figure_cards:[];
 const fields=[['key_finding','Key Finding','Main discoveries and evidence'],['methods','Methods','Study design and key methods'],['runx2_value','Relevance to RUNX2','Ideas for your RUNX2 research']];
 const inputs=fields.map(([key,label,placeholder])=>`<label class="manualField"><b>${label}</b><textarea data-guide-field="${key}" rows="3" placeholder="${esc(placeholder)}">${esc(a[key]||'')}</textarea></label>`).join('');
 const figureHtml=cards.map((c,i)=>`<div class="figure manualFigure" data-figure-index="${i}"><div class="row"><b>${esc(c.figure||'Selected figure '+(i+1))}</b><button type="button" class="deleteGuideFigure" data-figure-index="${i}">Remove</button></div>${c.image_path?`<img class="figureImage" data-figure-path="${esc(c.image_path)}" alt="${esc(c.figure||'Selected figure')}" loading="lazy">`:'<p class="muted">Legacy figure notes (no image attached)</p>'}</div>`).join('');
 return `<section class="detailSection manualGuide"><h3>My Paper Learning Guide</h3><p class="muted">Private notes, saved to your library. No AI API required.</p>${inputs}<button type="button" class="saveManualGuide primary">Save Learning Guide</button><p class="muted guideSaveStatus">${record?'Saved guide available':'No saved guide yet'}</p><h3>Important Figures</h3><p class="muted">Upload only the figures you want to keep. Images appear here after saving.</p><div class="guideFigureCards">${figureHtml||'<p class="muted">No figures uploaded yet.</p>'}</div><div class="guideFigureForm"><label>Figure label (optional)<input data-figure-label placeholder="e.g. Figure 3B"></label><label>Choose an image<input class="figureFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><button type="button" class="addGuideFigure primary">Upload Figure</button></div></section>`;
}
async function loadFigureImages(root){
 if(!root||!user)return;
 for(const img of root.querySelectorAll('img[data-figure-path]')){
  const path=img.dataset.figurePath;
  if(!path.startsWith(user.id+'/'))continue;
  const {data,error}=await client.storage.from('paper-figures').createSignedUrl(path,3600);
  if(!error&&data?.signedUrl&&img.isConnected)img.src=data.signedUrl;
  else if(img.isConnected)img.alt='Image unavailable — check paper-figures storage permissions';
 }
}
async function refreshGuide(id){
 const {data,error}=await client.from('paper_ai_analyses').select('paper_id,result,updated_at,storage_path,model').eq('paper_id',id).eq('user_id',user.id).maybeSingle();
 if(error)throw error;
 if(data)analyses.set(id,data);else analyses.delete(id);
 const p=papers.find(x=>String(x.id)===String(id));
 if(p&&location.hash==='#paper/'+encodeURIComponent(id)){
  const section=$('detailView').querySelector('.manualGuide');if(section){const current=papers.find(x=>String(x.id)===String(id));if(current){$('detailView').innerHTML=detailPage(current);}loadFigureImages($('detailView'));}
 }
}
async function persistGuide(id,result){
 const old=analyses.get(id);
 const row={user_id:user.id,paper_id:id,storage_path:old?.storage_path||'manual-guide',model:'manual',result,updated_at:new Date().toISOString()};
 const {error}=await client.from('paper_ai_analyses').upsert(row,{onConflict:'user_id,paper_id'});
 if(error)throw Error('Could not save learning guide: '+error.message);
 analyses.set(id,row);
}
function guideFormData(section){
 const out={...(analyses.get(section.closest('[data-id]').dataset.id)?.result||{})};
 section.querySelectorAll('[data-guide-field]').forEach(el=>out[el.dataset.guideField]=el.value.trim());
 if(!Array.isArray(out.figure_cards))out.figure_cards=[];
 return out;
}
async function saveGuide(id,cardEl){
 const section=cardEl.querySelector('.manualGuide');
 await persistGuide(id,guideFormData(section));
 section.querySelector('.guideSaveStatus').textContent='Saved · '+new Date().toLocaleString('en-US');
 toast('Learning guide saved');
}
async function addGuideFigure(id,cardEl){
 const section=cardEl.querySelector('.manualGuide'),input=section.querySelector('.figureFile'),file=input?.files?.[0];
 if(!file)throw Error('Choose an image first');
 const allowed=['image/png','image/jpeg','image/webp','image/gif'];
 if(!allowed.includes(file.type))throw Error('Use PNG, JPG, WEBP or GIF');
 if(file.size>10*1024*1024)throw Error('Images must be 10 MB or smaller');
 const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[file.type];
 const path=`${user.id}/${id}/${crypto.randomUUID()}.${extension}`;
 const button=section.querySelector('.addGuideFigure');button.disabled=true;
 try{
  const {error}=await client.storage.from('paper-figures').upload(path,file,{contentType:file.type,upsert:false});
  if(error)throw Error('Image upload failed: '+error.message+'. Run the included storage SQL once.');
  const result=guideFormData(section);
  result.figure_cards.push({figure:section.querySelector('[data-figure-label]').value.trim()||`Figure ${result.figure_cards.length+1}`,image_path:path});
  try{await persistGuide(id,result);}catch(e){await client.storage.from('paper-figures').remove([path]);throw e;}
  section.outerHTML=manualGuide(id);await loadFigureImages(cardEl);toast('Figure uploaded and saved');
 }finally{if(button.isConnected)button.disabled=false;}
}
async function deleteGuideFigure(id,index,cardEl){
 if(!confirm('Remove this figure from your learning guide?'))return;
 const section=cardEl.querySelector('.manualGuide'),result=guideFormData(section);
 if(!Number.isInteger(index)||index<0||index>=result.figure_cards.length)return;
 const [removed]=result.figure_cards.splice(index,1);
 await persistGuide(id,result);
 section.outerHTML=manualGuide(id);await loadFigureImages(cardEl);
 if(removed.image_path?.startsWith(user.id+'/')){
  const {error}=await client.storage.from('paper-figures').remove([removed.image_path]);
  if(error)console.warn('Image file cleanup failed:',error.message);
 }
 toast('Figure removed');
}
async function savePaperLink(id,cardEl){
 const field=cardEl.querySelector('.paperLinkInput');let raw=field?.value.trim()||'';
 if(!raw)throw Error('Enter an article URL or DOI');
 if(/^10\.\d{4,9}\//i.test(raw))raw='https://doi.org/'+raw;
 if(/^doi\.org\//i.test(raw))raw='https://'+raw;
 if(/^www\./i.test(raw))raw='https://'+raw;
 let url;try{url=new URL(raw);}catch{throw Error('Enter a valid https:// URL or DOI');}
 if(!['https:','http:'].includes(url.protocol)||url.hostname===location.hostname)throw Error('Enter an external article URL');
 const section=cardEl.querySelector('.manualGuide'),result=guideFormData(section);
 result.article_url=url.href;
 await persistGuide(id,result);
 const p=papers.find(x=>String(x.id)===String(id));
 if(p){cardEl.outerHTML=detailPage(p);loadFigureImages($('detailView'));}
 toast('Article link saved');
}
function parseNoteEntries(raw){
 const value=String(raw||'');if(!value.trim())return [];
 try{const data=JSON.parse(value);if(Array.isArray(data)&&data.every(x=>x&&typeof x.text==='string'))return data; }catch{}
 return [{id:'legacy',text:value,created_at:null}];
}
function notesSection(id){
 const items=parseNoteEntries(progress.get(id)?.notes);
 const cards=items.length?items.map((note,i)=>`<div class="savedNote" data-note-id="${esc(note.id)}"><div class="row"><span class="muted">Note ${i+1}${note.created_at?' · '+esc(new Date(note.created_at).toLocaleString('zh-CN')):''}</span><button type="button" class="deleteNote" data-note-id="${esc(note.id)}" aria-label="Delete note">Delete</button></div><p class="savedNoteText">${esc(note.text)}</p></div>`).join(''):'<p class="muted emptyNotes">No notes yet.</p>';
 return `<section class="detailSection"><h3>Personal Notes</h3><div class="savedNotes">${cards}</div><label for="noteDraft">Add a Note</label><textarea id="noteDraft" class="notes" placeholder="Record ideas, methods, and links to RUNX2…"></textarea><button type="button" class="addNote primary">＋ Add Note</button><p class="muted">每次save都会追加到页面，不会覆盖已有笔记；可以单独Delete。</p></section>`;
}
async function addNote(id,cardEl){
 const box=cardEl.querySelector('#noteDraft');const text=box?.value.trim();if(!text)return toast('Enter a note first');
 const items=parseNoteEntries(progress.get(id)?.notes);
 items.push({id:crypto.randomUUID(),text,created_at:new Date().toISOString()});
 await save(id,{notes:JSON.stringify(items)});
 const p=papers.find(x=>String(x.id)===String(id));if(p){cardEl.querySelector('.detailSection:has(.savedNotes)').outerHTML=notesSection(id);}
 toast('Note saved');
}
async function deleteNote(id,noteId,cardEl){
 if(!window.confirm('Delete this note? This cannot be undone.'))return;
 const items=parseNoteEntries(progress.get(id)?.notes).filter(x=>String(x.id)!==String(noteId));
 await save(id,{notes:JSON.stringify(items)});
 cardEl.querySelector('.detailSection:has(.savedNotes)').outerHTML=notesSection(id);
 toast('笔记已Delete');
}
function detailPage(p){const s=statusOf(p.id),n=progress.get(p.id)?.notes||'',figures=Array.isArray(p.figure_cards)?p.figure_cards:[];const figureBlock=figures.length?figures.map(figCard).join(''):'<p class="muted">No verified figure notes yet.</p>';return `<div class="detailHeader"><a href="#" class="backLink">← Back to Papers</a><span class="stars">${'★'.repeat(p.stars)}${'☆'.repeat(5-p.stars)}</span></div><article class="detailArticle" data-id="${esc(p.id)}"><span class="tag">${esc(p.topic)}</span><h2>${esc(p.title)}</h2><p class="meta">${esc(p.authors)} · ${esc(p.journal)} · ${esc(p.publication_year)}</p>${verificationLabel(p)?`<p class="small"><span class="pill">${verificationLabel(p)}</span></p>`:""}<div class="row detailActions">${paperExternalUrl(p)?`<a href="${esc(paperExternalUrl(p))}" target="_blank" rel="noopener noreferrer">Open Article / DOI ↗</a>`:`<label class="missingLink">Article URL or DOI <input class="paperLinkInput" placeholder="https://doi.org/..."><button type="button" class="savePaperLink">Save Link</button></label>`}<label>Reading Status <select class="readStatus"><option value="unread" ${s==='unread'?'selected':''}>Unread</option><option value="reading" ${s==='reading'?'selected':''}>Reading</option><option value="read" ${s==='read'?'selected':''}>Read</option></select></label></div><section class="detailSection"><h3>Key Finding</h3><p>${esc(p.key_finding)}</p></section><section class="detailSection"><h3>Why it matters to RUNX2</h3><p>${esc(p.runx2_value)}</p></section><section class="detailSection"><h3>Methods</h3><p>${esc(p.methods)}</p></section><section class="detailSection"><h3>Figure learning guide</h3><p>${esc(p.figures)}</p>${figureBlock}</section>${manualGuide(p.id)}${notesSection(p.id)}<section class="detailSection"><h3>Private PDF</h3><p class="muted">PDFs are stored privately. No AI API calls or charges.</p><input class="pdfFile file" type="file" accept="application/pdf"><div class="row pdfActions"><button class="uploadPdf">Upload PDF</button><button class="openPdf">View My PDF</button><button class="extractPdf">Extract PDF Text Locally</button></div><textarea class="pdfText hidden" readonly placeholder="Extracted text"></textarea></section></article>`;}

let fundamentals = [];
let fundQuery = '';
let fundCategory = '';

window.fundQuery = window.fundQuery || '';
window.fundCategory = window.fundCategory || '';

const FUNDAMENTAL_TOPICS=[
 ['Embryology & Timeline','Mouse E8.5–E18.5; staging and morphogenesis'],
 ['Cranial Neural Crest','Migration, specification, and derivatives'],
 ['Facial Prominences & Palate','Frontonasal, maxillary and mandibular processes; fusion'],
 ['Signaling Pathways','SHH, FGF, BMP, WNT, TGF-β, Ephrin/EPH'],
 ['Transcription Factors','RUNX2, MSX, DLX, PAX, SOX9, SP7'],
 ['Osteogenesis & Chondrogenesis','Intramembranous ossification and cartilage development'],
 ['Craniofacial Anatomy','Midface, maxilla, nasal region, sutures'],
 ['Methods & Atlases','scRNA-seq, spatial transcriptomics, whole-mount and 3D imaging']
];
function fundamentalsPage() {
    const query = (window.fundQuery || '').toLowerCase().trim();
    const filter = window.fundCategory || '';
 const cards=fundamentals.filter(x=>(!filter||x.category===filter)&&(!query||[x.title,x.category,x.kind,x.description].join(' ').toLowerCase().includes(query))).map(x=>`<article class="card fundCard" data-fund-id="${esc(x.id)}"><span class="tag">${esc(x.category)}</span><h3>${esc(x.title)}</h3><p class="meta">${esc(x.kind)}</p>${x.description?`<p style="white-space:pre-wrap">${esc(x.description)}</p>`:''}<div class="row">${x.url?`<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">Open Resource ↗</a>`:''}${x.storage_path?`<button type="button" class="fundOpen">Open Uploaded File</button>`:''}<button type="button" class="fundDelete">Delete</button></div></article>`).join('');
 return `<div class="detailArticle fundPage"><div class="detailHeader"><a href="#" class="backLink">← Back to Library</a></div><h2>Craniofacial Development Fundamentals</h2><p class="muted">Build your private learning library with textbooks, reviews, research papers, diagrams, and personal notes. No AI API required.</p><div class="fundTopicGrid">${FUNDAMENTAL_TOPICS.map(([name,desc])=>`<div class="fundTopic"><b>${esc(name)}</b><p class="muted">${esc(desc)}</p></div>`).join('')}</div><section class="detailSection"><h3>My Learning Resources</h3><div class="row"><input id="fundSearch" placeholder="Search resources" value="${esc(window.fundQuery || '')}"><select id="fundFilter"><option value="">All Topics</option>${FUNDAMENTAL_TOPICS.map(([name])=>`<option value="${esc(name)}" ${filter===name?'selected':''}>${esc(name)}</option>`).join('')}</select></div><div class="fundResources">${cards||'<p class="muted">No matching resources yet. Add your first one below.</p>'}</div></section><section class="detailSection"><h3>Add a Learning Resource</h3><form id="fundForm" class="addForm"><label>Title *<input name="title" required maxlength="500" placeholder="e.g. Cranial neural crest migration"></label><div class="formRow"><label>Topic<select name="category">${FUNDAMENTAL_TOPICS.map(([name])=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select></label><label>Resource Type<select name="kind"><option>Study Note</option><option>Textbook</option><option>Review</option><option>Research Paper</option><option>Lecture / Slide</option><option>Diagram / Image</option><option>Other</option></select></label></div><label>Notes / Summary<textarea name="description" placeholder="Your notes or a brief description (optional)"></textarea></label><label>Reference Link (optional)<input name="url" type="url" placeholder="https://..."></label><label>Upload File (optional)<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.ppt,.pptx,.doc,.docx,.txt" ></label><p class="muted">PDF, images, slides or documents, up to 25 MB. Upload only material you have the right to store.</p><button type="submit" class="primary">Save Resource</button><p id="fundMessage" role="status"></p></form></section></div>`;
}
function showFundamentals(){
 $('listView').classList.add('hidden');$('detailView').classList.add('hidden');$('addView').classList.add('hidden');
 $('fundamentalsView').classList.remove('hidden');
 $('fundamentalsView').innerHTML=fundamentalsPage();
}
async function loadFundamentals(){
 const {data,error}=await client.from('fundamentals_resources').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(500);
 if(error)throw error;fundamentals=data||[];
 if(location.hash==='#fundamentals')showFundamentals();
}
async function addFundamental(e){
 e.preventDefault();const form=e.target,msg=$('fundMessage'),button=form.querySelector('[type=submit]');
 button.disabled=true;msg.textContent='Saving resource…';let path='';
 try{
  const f=new FormData(form),file=f.get('file');
  let url=String(f.get('url')||'').trim();
  if(url&&(!/^https?:\/\//i.test(url)||new URL(url).hostname===location.hostname))throw Error('Enter a valid external URL');
  if(file&&file.size){
   if(file.size>25*1024*1024)throw Error('File must be 25 MB or smaller');
   const ext=file.name.split('.').pop().toLowerCase();
   if(!['pdf','png','jpg','jpeg','webp','ppt','pptx','doc','docx','txt'].includes(ext))throw Error('Unsupported file type');
   path=`${user.id}/${crypto.randomUUID()}.${ext}`;
   const up=await client.storage.from('fundamentals-files').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
   if(up.error)throw up.error;
  }
  const record={user_id:user.id,title:String(f.get('title')||'').trim(),category:String(f.get('category')),kind:String(f.get('kind')),description:String(f.get('description')||'').trim(),url:url||null,storage_path:path||null};
  if(!record.title)throw Error('Title is required');
  const {error}=await client.from('fundamentals_resources').insert(record);
  if(error)throw error;
  await loadFundamentals();toast('Resource saved');
 }catch(err){if(path)await client.storage.from('fundamentals-files').remove([path]);msg.textContent='Save failed: '+err.message;}
 finally{button.disabled=false;}
}
async function handleFundamentalClick(e){
 const el=e.target.closest('[data-fund-id]');if(!el)return;
 const item=fundamentals.find(x=>String(x.id)===el.dataset.fundId);if(!item)return;
 try{
  if(e.target.closest('.fundOpen')){
   const {data,error}=await client.storage.from('fundamentals-files').createSignedUrl(item.storage_path,300);
   if(error)throw error;window.open(data.signedUrl,'_blank','noopener');
  }
  if(e.target.closest('.fundDelete')){
   if(!confirm('Delete this resource and its uploaded file?'))return;
   const {error}=await client.from('fundamentals_resources').delete().eq('id',item.id).eq('user_id',user.id);
   if(error)throw error;
   if(item.storage_path){const r=await client.storage.from('fundamentals-files').remove([item.storage_path]);if(r.error)toast('Resource removed, but file cleanup failed: '+r.error.message);}
   await loadFundamentals();toast('Resource deleted');
  }
 }catch(err){toast('Action failed: '+err.message);}
}


// FaceBase Explorer: official public feed snapshot, not a comprehensive dataset API mirror.
let facebaseFeed=null, facebaseFilter='';
const FACEBASE_TERMS=['runx2','craniofacial','neural crest','midface','maxill','palat','osteogen','embryo','spatial','single-cell','facial','frontonasal','ephrin','foxi3'];
async function loadFaceBaseFeed(force=false){
 try{const r=await fetch('data/facebase_updates.json'+(force?'?t='+Date.now():''),{cache:force?'no-store':'default'});if(!r.ok)throw Error('Feed HTTP '+r.status);facebaseFeed=await r.json();}
 catch(e){facebaseFeed={updated_at:null,items:[],error:e.message};}
 if(location.hash==='#facebase')showFaceBase();
}
function facebasePage(){
 const data=facebaseFeed||{items:[]},items=(data.items||[]).filter(x=>!facebaseFilter||[x.title,x.summary,x.kind].join(' ').toLowerCase().includes(facebaseFilter));
 const cards=items.map(x=>`<article class="card"><span class="tag">${esc(x.kind||'Official update')}</span><h3>${esc(x.title)}</h3><p class="meta">${esc(x.date||'Date not specified')} · FaceBase</p><p>${esc(x.summary||'')}</p><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">View on FaceBase ↗</a></article>`).join('');
 return `<div class="detailArticle facebasePage"><div class="detailHeader"><a href="#" class="backLink">← Back to Paper Library</a></div><h2>FaceBase Explorer</h2><p class="muted">Official FaceBase releases and research news, checked daily. This is a filtered discovery feed, not a full mirror of the FaceBase dataset catalog.</p><div class="row"><a href="https://www.facebase.org/" target="_blank" rel="noopener noreferrer">Official FaceBase ↗</a><a href="https://docs.facebase.org/docs/discovering-data/" target="_blank" rel="noopener noreferrer">Browse & Filter Datasets ↗</a><button type="button" id="refreshFaceBase">Refresh Feed</button></div><p class="muted">Last successful check: ${esc(data.updated_at||'Not available')} · ${data.error?'Feed unavailable: '+esc(data.error):'Public metadata only'}</p><label>Filter updates <input id="facebaseSearch" value="${esc(facebaseFilter)}" placeholder="RUNX2, neural crest, E13.5, spatial…"></label><div class="fundResources">${cards||'<p class="muted">No matching updates in the current snapshot. Browse the official dataset catalog for full coverage.</p>'}</div></div>`;
}
function showFaceBase(){
 $('fundamentalsView').classList.add('hidden');$('listView').classList.add('hidden');$('detailView').classList.add('hidden');$('addView').classList.add('hidden');
 $('facebaseView').classList.remove('hidden');$('facebaseView').innerHTML=facebasePage();
}

function showRoute(){
 if(location.hash==='#facebase'){showFaceBase();return;}
 $('facebaseView').classList.add('hidden');
 if(location.hash==='#fundamentals'){$('facebaseView').classList.add('hidden');showFundamentals();return;}
 $('fundamentalsView').classList.add('hidden');
 const isAdd=location.hash==='#add';
 const match=location.hash.match(/^#paper\/(.+)$/);
 let p=null;
 if(match){try{p=papers.find(x=>String(x.id)===decodeURIComponent(match[1]));}catch{}}
 $('listView').classList.toggle('hidden',!!p||isAdd);
 $('detailView').classList.toggle('hidden',!p);
 $('addView').classList.toggle('hidden',!isAdd);
 if(p){$('detailView').innerHTML=detailPage(p);loadFigureImages($('detailView'));window.scrollTo(0,0);refreshGuide(p.id).catch(e=>toast('Learning guide could not load: '+e.message));}
 else if(isAdd){$('addView').innerHTML=addPage();window.scrollTo(0,0);}
 else if(match){location.hash='';}
}
function addPage(){return `<div class="detailHeader"><a href="#" class="backLink">← Back to Papers</a></div><article class="detailArticle"><h2>＋ Add Paper</h2><p class="muted">Look up metadata via Europe PMC or enter paper details manually.</p><form id="paperForm" class="addForm"><label>DOI or PMID (optional)<input id="newIdentifier" placeholder="10.1038/... 或 PMID:39832706"></label><div class="formRow"><button type="button" id="lookupPaper">Look Up Metadata</button><span id="lookupMessage" class="addHint">You can also enter everything manually.</span></div><label>Paper Title *<input id="newTitle" required maxlength="1000"></label><div class="formRow"><label>Authors<input id="newAuthors" placeholder="First author et al."></label><label>Journal<input id="newJournal"></label><label>Publication Year<input id="newYear" placeholder="2026" maxlength="12"></label></div><label>Article URL<input id="newUrl" type="url" placeholder="https://doi.org/..."></label><div class="formRow"><label>Research Topic<input id="newTopic" value="Craniofacial development" list="topicSuggestions"></label><label>Rating<select id="newStars"><option value="5">★★★★★</option><option value="4" selected>★★★★</option><option value="3">★★★</option><option value="2">★★</option><option value="1">★</option></select></label></div><datalist id="topicSuggestions">${[...new Set(papers.map(x=>x.topic))].map(x=>`<option value="${esc(x)}"></option>`).join('')}</datalist><label>Key Finding<textarea id="newFinding" placeholder="Main findings (verify against the paper)"></textarea></label><label>Relevance to RUNX2<textarea id="newRelevance" placeholder="Links to WT/HT, E13.5, spatial omics, or cell communication"></textarea></label><label>Methods<textarea id="newMethods" placeholder="Notable methods or analyses"></textarea></label><label>Figure Notes<textarea id="newFigures" placeholder="Figures worth revisiting (optional)"></textarea></label><div class="addHint">save后可以在文献详情页继续编辑个人笔记、Reading Status和Upload PDF。自动检索程序不会Delete手动添加的文献。</div><button type="submit" id="savePaperBtn" class="primary">Save Paper</button><p id="addMessage" role="status"></p></form></article>`;}
function normalizeDoi(s){return String(s||'').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi\s*:\s*/i,'').trim().toLowerCase();}
function parseIdentifier(s){let v=String(s||'').trim();if(!v)return {doi:'',pmid:''};let pm=v.match(/^(?:pmid\s*:\s*|https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/)(\d+)\/?$/i);if(pm)return {doi:'',pmid:pm[1]};if(/^\d{5,10}$/.test(v))return {doi:'',pmid:v};let doi=normalizeDoi(v);if(!/^10\.\d{4,9}\/\S+$/i.test(doi))throw Error('Enter a valid DOI or PMID, or leave blank');return {doi,pmid:''};}
async function lookupMetadata(){const btn=$('lookupPaper'),msg=$('lookupMessage');let ident;try{ident=parseIdentifier($('newIdentifier').value);if(!ident.doi&&!ident.pmid)throw Error('Enter a DOI or PMID first');btn.disabled=true;msg.textContent='Searching Europe PMC…';let q=ident.doi?`DOI:${ident.doi}`:`EXT_ID:${ident.pmid} AND SRC:MED`;let response=await fetch('https://www.ebi.ac.uk/europepmc/webservices/rest/search?query='+encodeURIComponent(q)+'&format=json&pageSize=3');if(!response.ok)throw Error('Europe PMC returned HTTP '+response.status);let data=await response.json();let x=data.resultList?.result?.[0];if(!x)throw Error('Paper not found. Enter it manually.');if(ident.doi&&normalizeDoi(x.doi)!==ident.doi)throw Error('DOI does not match');if(ident.pmid&&String(x.id)!==ident.pmid)throw Error('PMID does not match');$('newTitle').value=x.title||'';$('newAuthors').value=x.authorString||'';$('newJournal').value=x.journalTitle||'';$('newYear').value=x.pubYear||'';$('newUrl').value=x.doi?'https://doi.org/'+x.doi:(x.id?'https://pubmed.ncbi.nlm.nih.gov/'+x.id+'/':'');if(x.doi&&!ident.doi)$('newIdentifier').value=x.doi;msg.textContent='已填入元数据，请核对标题、Authors及年份后save。';}catch(e){msg.textContent='Lookup failed: '+e.message+'; you can enter details manually.';}finally{btn.disabled=false;}}
async function insertManualPaper(e){e.preventDefault();const btn=$('savePaperBtn'),msg=$('addMessage');try{if(!user)throw Error('Please sign in');let ident=parseIdentifier($('newIdentifier').value);let title=$('newTitle').value.trim();if(!title)throw Error('Title is required');let dup=papers.find(p=>(ident.doi&&normalizeDoi(p.doi)===ident.doi)||(ident.pmid&&String(p.pmid)===ident.pmid)||p.title.trim().toLowerCase()===title.toLowerCase());if(dup){msg.textContent='Paper already exists. Opening it.';location.hash='#paper/'+encodeURIComponent(dup.id);return;}btn.disabled=true;msg.textContent='Saving…';let row={source_key:ident.doi?'doi:'+ident.doi:ident.pmid?'pmid:'+ident.pmid:'manual:'+crypto.randomUUID(),doi:ident.doi||null,pmid:ident.pmid||null,title,authors:$('newAuthors').value.trim(),journal:$('newJournal').value.trim(),publication_year:$('newYear').value.trim(),url:$('newUrl').value.trim()||(ident.doi?'https://doi.org/'+ident.doi:''),topic:$('newTopic').value.trim()||'Other',figures:$('newFigures').value.trim(),methods:$('newMethods').value.trim(),key_finding:$('newFinding').value.trim(),runx2_value:$('newRelevance').value.trim(),figure_cards:[],stars:Number($('newStars').value),verification_status:'historical_metadata_unverified',provenance:'manual_user'};let {data,error}=await client.from('papers').insert(row).select('id').single();if(error){if(error.code==='23505')throw Error('A paper with this identifier already exists');throw error;}await load();toast('Paper added');location.hash='#paper/'+encodeURIComponent(data.id);}catch(err){msg.textContent='Save failed: '+err.message;}finally{btn.disabled=false;}}


function render(){let q=$('search').value.toLowerCase().trim(),topic=$('topic').value,status=$('status').value,stars=Number($('stars').value);
 let filtered=papers.filter(p=>(!topic||p.topic===topic)&&(!status||statusOf(p.id)===status)&&p.stars>=stars&&(!q||[p.title,p.authors,p.journal,p.topic,p.methods,p.figures,p.key_finding,p.runx2_value,p.doi,JSON.stringify(p.figure_cards)].join(' ').toLowerCase().includes(q)));
 $('cards').innerHTML=filtered.length?filtered.map(card).join(''):'<div class="panel">No papers match these filters.</div>';stats();showRoute();}
async function load(){const [a,b]=await Promise.all([client.from('papers').select('*').order('stars',{ascending:false}).order('added_at',{ascending:false}).range(0,999),client.from('reading_progress').select('paper_id,status,notes').eq('user_id',user.id).range(0,999)]);if(a.error||b.error)throw Error(a.error?.message||b.error?.message);papers=a.data||[];progress=new Map((b.data||[]).map(x=>[x.paper_id,x]));let topics=[...new Set(papers.map(p=>p.topic))].sort();$('topic').innerHTML='<option value="">All Topics</option>'+topics.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');render();}
async function save(id,changes){const prev=progress.get(id)||{status:'unread',notes:''};let record={user_id:user.id,paper_id:id,status:changes.status??prev.status,notes:changes.notes??prev.notes,updated_at:new Date().toISOString()};let {error}=await client.from('reading_progress').upsert(record,{onConflict:'user_id,paper_id'});if(error)throw error;progress.set(id,record);}
async function handleCard(e){let cardEl=e.target.closest('[data-id]');if(!cardEl)return;let id=cardEl.dataset.id;try{
 if(e.target.matches('.readStatus')){await save(id,{status:e.target.value});render();}
 if(e.target.matches('.addNote')){await addNote(id,cardEl);}
 if(e.target.matches('.deleteNote')){await deleteNote(id,e.target.dataset.noteId,cardEl);}
 if(e.target.matches('.uploadPdf')){let file=cardEl.querySelector('.pdfFile').files[0];if(!file)return toast('Choose a PDF first');if(file.type!=='application/pdf'||file.size>25*1024*1024)return toast('PDF must be 25 MB or smaller');let path=`${user.id}/${id}/${Date.now()}_${file.name.replace(/[^\w.\-]/g,'_')}`;let {error}=await client.storage.from('paper-pdfs').upload(path,file,{contentType:'application/pdf',upsert:false});if(error)throw error;toast('PDF uploaded to private storage');}
 if(e.target.matches('.savePaperLink')){await savePaperLink(id,cardEl);}
 if(e.target.matches('.saveManualGuide')){await saveGuide(id,cardEl);}
 if(e.target.matches('.addGuideFigure')){await addGuideFigure(id,cardEl);}
 if(e.target.matches('.deleteGuideFigure')){await deleteGuideFigure(id,Number(e.target.dataset.figureIndex),cardEl);}
 if(e.target.matches('.openPdf')){let {data,error}=await client.storage.from('paper-pdfs').list(`${user.id}/${id}`,{limit:100});if(error)throw error;if(!data?.length)return toast('这篇文章还没有Upload PDF');let latest=[...data].sort((a,b)=>b.name.localeCompare(a.name))[0];let path=`${user.id}/${id}/${latest.name}`;let signed=await client.storage.from('paper-pdfs').createSignedUrl(path,120);if(signed.error)throw signed.error;window.open(signed.data.signedUrl,'_blank','noopener');}
 if(e.target.matches('.extractPdf')){let file=cardEl.querySelector('.pdfFile').files[0];if(!file)return toast('Choose a local PDF first');if(!window.pdfjsLib)return toast('PDF reader unavailable. Check your connection.');pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';let pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;let parts=[];for(let i=1;i<=Math.min(pdf.numPages,20);i++){let page=await pdf.getPage(i);let txt=await page.getTextContent();parts.push(`Page ${i}:\n`+txt.items.map(x=>x.str).join(' '));}let box=cardEl.querySelector('.pdfText');box.classList.remove('hidden');box.value=parts.join('\n\n');toast(`已提取前 ${Math.min(pdf.numPages,20)} 页文本（Scanned PDFs are not supported (no OCR)）`);}
 }catch(err){toast('Action failed: '+err.message);}}

async function start() {
  if (!configured || !window.supabase) {
    $('authMsg').textContent =
      'Configure the Supabase URL and public anon key in site/config.js.';
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
      await loadFundamentals();
      await loadFaceBaseFeed();
    } catch (e) {
      toast('Database load failed: ' + e.message);
    }
  }
}

// Email and password sign-in
$('loginBtn').onclick = async () => {
  if (!client) {
    return toast('Configure Supabase first');
  }

  const email = $('email').value.trim();
  const password = $('loginPassword').value;

  if (!email) {
    return toast('Enter your email');
  }

  if (!password) {
    return toast('Enter your password');
  }

  $('loginBtn').disabled = true;
  $('authMsg').textContent = 'Signing in...';

  try {
    const { error } = await client.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      $('authMsg').textContent = 'Sign-in failed: ' + error.message;
    } else {
      $('authMsg').textContent = '';
      $('loginPassword').value = '';
    }
  } catch (e) {
    $('authMsg').textContent = 'Sign-in failed: ' + e.message;
  } finally {
    $('loginBtn').disabled = false;
  }
};

// Sign out
$('signout').onclick = async () => {
  await client?.auth.signOut();

  user = null;

  $('login').classList.remove('hidden');
  $('app').classList.add('hidden');
  $('signout').classList.add('hidden');
};

for(let id of ['search','topic','status','stars'])$(id).addEventListener(id==='search'?'input':'change',render);
for(const area of ['cards','detailView']){$(area).addEventListener('click',handleCard);$(area).addEventListener('change',e=>{if(e.target.matches('.readStatus'))handleCard(e);});}window.addEventListener('hashchange',showRoute);
$('facebaseView').addEventListener('click',e=>{if(e.target.id==='refreshFaceBase')loadFaceBaseFeed(true);});
$('facebaseView').addEventListener('input',e=>{if(e.target.id==='facebaseSearch'){facebaseFilter=e.target.value;const pos=e.target.selectionStart;showFaceBase();const el=$('facebaseSearch');el.focus();el.setSelectionRange(pos,pos);}});
$('fundamentalsView').addEventListener('submit',e=>{if(e.target.id==='fundForm')addFundamental(e);});
$('fundamentalsView').addEventListener('click',handleFundamentalClick);
$('fundamentalsView').addEventListener('input',e=>{if(e.target.id==='fundSearch'){fundQuery=e.target.value;const focus=e.target.selectionStart;showFundamentals();const input=$('fundSearch');input.focus();input.setSelectionRange(focus,focus);}});
$('fundamentalsView').addEventListener('change',e=>{if(e.target.id==='fundFilter'){fundCategory=e.target.value;showFundamentals();}});
$('addView').addEventListener('click',e=>{if(e.target.closest('#lookupPaper'))lookupMetadata();});
$('addView').addEventListener('submit',e=>{if(e.target.id==='paperForm')insertManualPaper(e);});
$('exportBtn').onclick=()=>{let content=JSON.stringify({exported_at:new Date().toISOString(),progress:[...progress.entries()].map(([paper_id,x])=>({paper_id,status:x.status,notes:x.notes}))},null,2);let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'application/json'}));a.download='RUNX2_reading_progress.json';a.click();URL.revokeObjectURL(a.href);};
start();
