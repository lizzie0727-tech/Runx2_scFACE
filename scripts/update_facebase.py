#!/usr/bin/env python3
"""Refresh the public FaceBase news feed; best-effort HTML extraction, no credentials."""
import requests,bs4,re,json,datetime,pathlib,sys
out=pathlib.Path('site/data/facebase_updates.json')
old=json.loads(out.read_text()) if out.exists() else {'items':[]}
url='https://www.facebase.org/about/news/'
try:
 resp=requests.get(url,timeout=25,headers={'User-Agent':'scFACE-academic-resource-monitor/1.0'});resp.raise_for_status()
 soup=bs4.BeautifulSoup(resp.text,'html.parser')
 entries=[];seen=set()
 # Prefer article containers; if the site structure changes, preserve the last valid snapshot.
 for el in soup.select('article'):
  heading=el.find(['h2','h3','h4']);a=heading.find('a',href=True) if heading else None
  if not heading or not a:continue
  title=heading.get_text(' ',strip=True);link=requests.compat.urljoin(url,a['href'])
  if not link.startswith('https://www.facebase.org/') or link in seen:continue
  body=el.get_text(' ',strip=True)
  if not any(t in body.lower() for t in ['craniofacial','neural crest','runx2','midface','maxill','palat','osteogen','embryo','spatial','single cell','single-cell','facial','frontonasal','suture','nerve']):continue
  seen.add(link)
  date_el=el.find('time');date=date_el.get('datetime','') if date_el else ''
  entries.append({'title':title,'kind':'FaceBase news / release','date':date[:10],'summary':body[:420],'url':link})
 if not entries:raise RuntimeError('No recognizable official article entries; keeping previous snapshot')
 existing={x['url']:x for x in old.get('items',[])}
 for x in entries:existing[x['url']]=x
 # Preserve previously verified entries, sorted by date, no synthetic news.
 items=sorted(existing.values(),key=lambda x:x.get('date',''),reverse=True)[:100]
 out.write_text(json.dumps({'updated_at':datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),'source':url,'items':items},ensure_ascii=False,indent=2)+'\n')
 print('Updated FaceBase feed:',len(items),'items')
except Exception as exc:
 print('Warning: FaceBase fetch/parse failed; preserving prior feed:',exc,file=sys.stderr)
 sys.exit(0)
