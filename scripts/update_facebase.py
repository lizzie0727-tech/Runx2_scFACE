#!/usr/bin/env python3
"""Sync public FaceBase dataset metadata through the official ERMrest API."""
import datetime
import json
import pathlib
import sys
from urllib.parse import quote

import requests

API = 'https://www.facebase.org/ermrest/catalog/1/entity/isa:dataset'
OUT = pathlib.Path('site/data/facebase_updates.json')
KEYWORDS = ('craniofacial', 'neural crest', 'runx2', 'midface', 'maxill',
            'palat', 'osteogen', 'embryo', 'spatial', 'single cell',
            'single-cell', 'facial', 'frontonasal', 'suture', 'mandib',
            'calvar', 'tooth', 'odont', 'skelet')

def first(record, *names):
    for name in names:
        value = record.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ''

def main():
    old = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {'items': []}
    session = requests.Session()
    session.headers.update({'Accept': 'application/json', 'User-Agent': 'scFACE-public-dataset-monitor/1.0'})
    response = session.get(API, params={'limit': 500}, timeout=40)
    print('FaceBase API:', response.url, 'HTTP', response.status_code, flush=True)
    response.raise_for_status()
    records = response.json()
    if not isinstance(records, list):
        raise RuntimeError('Unexpected API response (expected a JSON array)')
    if not records:
        raise RuntimeError('FaceBase API returned no public dataset records')
    print('Records received:', len(records), 'Sample field names:', sorted(records[0].keys()), flush=True)

    existing = {x['url']: x for x in old.get('items', []) if x.get('url')}
    new_count = 0
    matched = 0
    for record in records:
        title = first(record, 'title', 'Title', 'name', 'Name', 'dataset_title')
        description = first(record, 'description', 'Description', 'summary', 'Summary', 'abstract', 'Abstract')
        search_text = json.dumps(record, ensure_ascii=False, default=str).lower()
        if not any(word in search_text for word in KEYWORDS):
            continue
        rid = first(record, 'RID', 'rid')
        accession = first(record, 'accession', 'Accession')
        if not title:
            title = accession or ('FaceBase dataset ' + rid if rid else '')
        if not title or not rid:
            continue
        matched += 1
        # ERMrest entity RID link is stable and points to the exact source record.
        link = 'https://www.facebase.org/ermrest/catalog/1/entity_rid/' + quote(rid, safe='')
        date = first(record, 'release_date', 'Release_Date', 'released', 'RCT', 'RMT')[:10]
        item = {'title': title, 'kind': 'FaceBase dataset', 'date': date,
                'summary': description[:420] or ('Official FaceBase dataset record ' + (accession or rid)),
                'url': link}
        if link not in existing:
            new_count += 1
        existing[link] = item
    print('Matching datasets:', matched, 'New:', new_count, flush=True)
    if not matched:
        raise RuntimeError('API returned records, but none matched the research filters; old JSON preserved')
    items = sorted(existing.values(), key=lambda x: x.get('date', ''), reverse=True)[:200]
    result = {'updated_at': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
              'source': API, 'items': items}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Updated JSON:', len(items), 'items', flush=True)

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('ERROR: FaceBase API sync failed; existing JSON preserved:', exc, file=sys.stderr)
        sys.exit(1)
