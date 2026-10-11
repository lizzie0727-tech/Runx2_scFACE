#!/usr/bin/env python3
"""Weekly PubMed metadata harvesting. Publishes only DOI+PMID verified records.
Does not pretend to have read figure legends or full-text PDFs.
"""
import datetime as dt, json, os, re, sys, time, urllib.parse, urllib.request, xml.etree.ElementTree as ET
BASE='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'
QUERIES=[
 '(RUNX2[Title/Abstract] OR cranial neural crest[Title/Abstract]) AND (craniofacial[Title/Abstract] OR midface[Title/Abstract] OR facial development[Title/Abstract])',
 '(frontonasal[Title/Abstract] OR facial mesenchyme[Title/Abstract] OR craniofacial development[Title/Abstract]) AND (single-cell[Title/Abstract] OR spatial transcriptomics[Title/Abstract] OR positional identity[Title/Abstract])',
 '(cranial neural crest[Title/Abstract] OR craniofacial[Title/Abstract]) AND (epithelial mesenchymal[Title/Abstract] OR signaling niche[Title/Abstract])'
]
def get(endpoint, params):
 params.update({'tool':'RUNX2PrivateAtlas','email':os.getenv('NCBI_CONTACT_EMAIL','researcher@example.org')})
 req=urllib.request.Request(BASE+endpoint+'?'+urllib.parse.urlencode(params),headers={'User-Agent':'RUNX2PrivateAtlas/1.0'})
 with urllib.request.urlopen(req,timeout=35) as r:return r.read()
def clean(el):return ' '.join(''.join(el.itertext()).split()) if el is not None else ''
def score(title,abstract):
 s=(title+' '+abstract).lower();points=1
 if 'runx2' in s:points+=2
 if 'midface' in s or 'frontonasal' in s or 'craniofacial' in s:points+=1
 if 'cranial neural crest' in s or 'mesenchym' in s:points+=1
 if 'spatial transcriptom' in s or 'single-cell' in s:points+=1
 if 'epithelial' in s and ('niche' in s or 'signaling' in s):points+=1
 return min(5,max(1,points))
def topic(title,abstract):
 s=(title+' '+abstract).lower()
 if 'runx2' in s:return 'RUNX2 mechanisms'
 if 'spatial transcriptom' in s:return 'Spatial transcriptomics'
 if 'single-cell' in s:return 'Single-cell atlas'
 if 'neural crest' in s:return 'CNCC / mesenchyme'
 return 'Craniofacial development'
def main():
 url=os.environ['SUPABASE_URL'].rstrip('/')+'/rest/v1/papers?on_conflict=source_key'
 key=os.environ['SUPABASE_SERVICE_ROLE_KEY']
 # The weekly job runs on Wednesdays and considers last 14 days to handle indexing lag.
 today=dt.date.today();start=today-dt.timedelta(days=14)
 ids=set()
 for query in QUERIES:
  try:
   xml=ET.fromstring(get('esearch.fcgi',{'db':'pubmed','term':query,'retmax':75,'datetype':'edat','mindate':start.isoformat(),'maxdate':today.isoformat(),'retmode':'xml'}))
   ids.update(x.text for x in xml.findall('.//IdList/Id') if x.text)
  except Exception as e:print('Query error:',str(e),file=sys.stderr)
  time.sleep(.4)
 print('PMIDs discovered:',len(ids));created=0;skipped=0
 for batch_start in range(0,len(ids),50):
  batch=list(sorted(ids))[batch_start:batch_start+50]
  try:root=ET.fromstring(get('efetch.fcgi',{'db':'pubmed','id':','.join(batch),'retmode':'xml'}))
  except Exception as e:print('Fetch error:',e,file=sys.stderr);continue
  for article in root.findall('.//PubmedArticle'):
   pmid=clean(article.find('./MedlineCitation/PMID'))
   title=clean(article.find('./MedlineCitation/Article/ArticleTitle'))
   abstract=' '.join(clean(x) for x in article.findall('./MedlineCitation/Article/Abstract/AbstractText'))
   doi=None
   for x in article.findall('.//ArticleId'):
    if x.attrib.get('IdType')=='doi':doi=clean(x).lower();break
   if not doi:
    for x in article.findall('.//ELocationID'):
     if x.attrib.get('EIdType')=='doi':doi=clean(x).lower();break
   if not doi or not pmid or not title or not re.match(r'^10\.\d{4,9}/\S+$',doi):skipped+=1;continue
   # Avoid irrelevant results from broad PubMed query.
   if score(title,abstract)<3:skipped+=1;continue
   author_nodes=article.findall('./MedlineCitation/Article/AuthorList/Author')
   names=[(' '.join(filter(None,[clean(x.find('ForeName')),clean(x.find('LastName'))])) or clean(x.find('CollectiveName'))) for x in author_nodes[:4]]
   authors=', '.join(x for x in names if x)+(' et al.' if len(author_nodes)>4 else '')
   journal=clean(article.find('./MedlineCitation/Article/Journal/Title'))
   year=clean(article.find('./MedlineCitation/Article/Journal/JournalIssue/PubDate/Year')) or clean(article.find('./MedlineCitation/Article/Journal/JournalIssue/PubDate/MedlineDate'))[:4]
   obj={'source_key':'doi:'+doi,'doi':doi,'pmid':pmid,'title':title,'authors':authors,'journal':journal,'publication_year':year,'url':'https://doi.org/'+doi,'topic':topic(title,abstract),'figures':'Figure number pending original-article verification','methods':'See original Methods; not yet manually extracted','key_finding':('PubMed abstract (unreviewed summary): '+abstract[:900]) if abstract else 'Abstract not provided in PubMed; read original article.','runx2_value':'Candidate for RUNX2 midface research: relevance requires manual appraisal.','figure_cards':[],'stars':score(title,abstract),'verification_status':'paper_confirmed_figure_pending','provenance':'pubmed_weekly_auto'}
   # Never overwrite curated cards or manually assigned stars. Existing records are skipped.
   payload=json.dumps(obj,ensure_ascii=False).encode()
   request=urllib.request.Request(url,data=payload,method='POST',headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json','Prefer':'resolution=ignore-duplicates,return=minimal'})
   try:
    with urllib.request.urlopen(request,timeout=30) as response:
     if response.status in (200,201,204):created+=1
   except Exception as e:print('Insert failed for',doi,e,file=sys.stderr)
  time.sleep(.4)
 print('Processed potential records:',created,'skipped missing identifiers/low relevance:',skipped)
if __name__=='__main__':main()
