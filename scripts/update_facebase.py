#!/usr/bin/env python3
"""Update scFACE's FaceBase news feed without inventing releases.

Uses official FaceBase pages; preserves prior items, and fails loudly if no
credible news entries can be identified. Requires requests and beautifulsoup4.
"""
import datetime as dt
import json
import pathlib
import re
import sys
from urllib.parse import urljoin, urlparse, urldefrag

import bs4
import requests

OUT = pathlib.Path('site/data/facebase_updates.json')
SOURCE = 'https://www.facebase.org/about/news/'
KEYWORDS = ('craniofacial', 'neural crest', 'runx2', 'midface', 'maxill', 'palat',
            'osteogen', 'embryo', 'spatial', 'single cell', 'single-cell',
            'facial', 'frontonasal', 'suture', 'nerve', 'facebase', 'genom',
            'transcriptom', 'cranial', 'development')
SKIP = ('privacy', 'contact', 'about', 'login', 'register', 'terms', 'faq',
        'documentation', 'help', 'news', 'home', 'publications')


def clean(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def valid_link(href):
    if not href or href.startswith(('#', 'mailto:', 'javascript:')):
        return None
    link, _ = urldefrag(urljoin(SOURCE, href))
    p = urlparse(link)
    if p.scheme != 'https' or p.netloc.lower() not in ('www.facebase.org', 'facebase.org'):
        return None
    if p.path.rstrip('/') in ('', '/about/news'):
        return None
    return link


def find_date(node):
    t = node.find('time')
    raw = (t.get('datetime') or t.get_text(' ', strip=True)) if t else ''
    if not raw:
        raw = node.get_text(' ', strip=True)[:400]
    m = re.search(r'\b(20\d{2})[-/](0?[1-9]|1[0-2])(?:[-/](0?[1-9]|[12]\d|3[01]))?\b', raw)
    if m:
        return f'{m.group(1)}-{int(m.group(2)):02d}' + (f'-{int(m.group(3)):02d}' if m.group(3) else '')
    return ''


def extract(soup):
    results = {}
    # Multiple page structures: article, cards, content sections, or heading+link.
    containers = soup.select('article, .views-row, .news-item, .card, .post, .entry, .node, .view-content > div')
    containers += soup.select('main h2, main h3, main h4, #content h2, #content h3, #content h4')
    for node in containers:
        heading = node if node.name in ('h2', 'h3', 'h4') else node.find(['h2', 'h3', 'h4'])
        if not heading:
            continue
        anchor = heading.find('a', href=True)
        if anchor is None:
            anchor = node.find('a', href=True)
        if anchor is None:
            continue
        title = clean(heading.get_text(' ', strip=True))
        link = valid_link(anchor.get('href'))
        if not link or not (15 <= len(title) <= 240):
            continue
        if title.lower() in SKIP:
            continue
        parent = node if node.name not in ('h2', 'h3', 'h4') else (node.parent or node)
        body = clean(parent.get_text(' ', strip=True))[:1500]
        if not any(word in (title + ' ' + body).lower() for word in KEYWORDS):
            continue
        if len(body) > 900 and node.name in ('h2', 'h3', 'h4'):
            body = title  # avoid taking whole page as an article summary
        results[link] = {'title': title, 'kind': 'FaceBase news / release',
                         'date': find_date(parent), 'summary': body[:420], 'url': link}
    return list(results.values())


def main():
    old = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {'items': []}
    response = requests.get(SOURCE, timeout=30, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; scFACE-research-feed/1.0)'})
    response.raise_for_status()
    soup = bs4.BeautifulSoup(response.text, 'html.parser')
    entries = extract(soup)
    print(f'Fetched {SOURCE}: HTTP {response.status_code}, {len(response.content)} bytes, {len(entries)} matching entries')
    if not entries:
        raise RuntimeError('No news entries recognized. FaceBase markup may have changed; inspect the official page and update parser.')
    existing = {x['url']: x for x in old.get('items', []) if isinstance(x, dict) and x.get('url')}
    count_new = sum(x['url'] not in existing for x in entries)
    for x in entries:
        if x['url'] in existing and not x['date']:
            x['date'] = existing[x['url']].get('date', '')
        existing[x['url']] = x
    items = sorted(existing.values(), key=lambda x: x.get('date', ''), reverse=True)[:150]
    payload = {'updated_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
               'source': SOURCE, 'items': items}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Updated feed: {len(items)} total items, {count_new} new links')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'ERROR: FaceBase update failed; existing JSON preserved: {exc}', file=sys.stderr)
        sys.exit(1)
