# RUNX2 Private Figure Learning Atlas

A deployable **private** literature library based on v4.6 (43 legacy records), with email magic-link sign-in, personal reading status, notes, private PDF uploads, figure learning cards, DOI filters, and a weekly PubMed update.

## Architecture

- **GitHub Pages** hosts the static `site/` directory (HTML/CSS/JS only). Hosting source is public if using a public repository, **but the papers, notes, PDF files and progress are not embedded in the public site**.
- **Supabase Auth** authenticates the one approved user via magic link. Disable new sign-ups and create/invite your own user before use.
- **Supabase Postgres + RLS** restricts paper reading to signed-in users and progress editing to the owning user.
- **Supabase Storage** private `paper-pdfs` bucket with per-user access policies.
- **GitHub Actions** every Wednesday 08:00 Asia/Seoul retrieves PubMed records from the last 14 days and imports only entries with **both a PMID and DOI**, avoiding duplicate DOI and leaving previously curated content unchanged.

## One-time deployment (approximately 20–40 minutes)

1. Create a **Supabase** project at https://supabase.com and open **SQL Editor**. Run `supabase/schema.sql` and then `supabase/seed.sql`. Seed contains the 43 v4.6 records; **importing old records does not constitute independent paper/figure verification**.
2. In Supabase **Authentication > Providers > Email**, enable email sign-in, disable public sign-ups, and invite/create your own account. Set **URL Configuration > Site URL** and **Redirect URLs** to your final GitHub Pages address (e.g. `https://USERNAME.github.io/RUNX2_Private_Atlas/`). For initial login you may temporarily allow your test URL. If email sending is restricted by Supabase defaults, configure custom SMTP or use the supported email provider settings.
3. In **Project Settings > API Keys**, copy the **Project URL** and **publishable (or legacy anon) key** into `site/config.js`. This is a public client key; **never place the service_role/secret key in site files**.
4. Create a GitHub repository and upload this project. Under **Settings > Pages**, publish `site/` (either via `gh-pages` branch with `site` contents, or use the optional deployment workflow below). The recommended setup is **GitHub Actions deployment** of `site/` from your private repo, subject to your GitHub plan's Pages availability.
5. In **Settings > Secrets and variables > Actions**, add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `NCBI_CONTACT_EMAIL`. Only the GitHub Action reads the service role key. Keep it secret. Enable workflows. Run **Actions > RUNX2 weekly verified-metadata update > Run workflow** to test. Scheduled workflows may be delayed by GitHub.
6. Visit the published page, request the login link using your invited email, and check that paper cards, notes and PDF uploads work. Test access in a signed-out browser: the data must not be visible.

### Publish GitHub Pages automatically

Included `.github/workflows/deploy-pages.yml` deploys the `site/` directory whenever you push to `main`. Set **Settings > Pages > Build and deployment > Source: GitHub Actions**. If using a custom domain, update the Supabase redirect URL accordingly.

## Weekly update: important boundaries

- **Automatic publication** means PubMed-confirmed **bibliographic identity** (PMID + DOI), not verification of scientific findings or Figure panels. New entries show *论文已确认 · Figure 待核实* and contain a clearly labeled PubMed abstract excerpt; their 1–5 stars are **automatic relevance estimates** rather than full-paper appraisal.
- The 43 seeded v4.6 entries retain their previous annotations, some of which have not been checked against original figures.
- To make weekly updates require manual approval instead, modify the updater to write to a `review_queue` table. Current default prioritizes the user's request for automatic inclusion.
- A DOI and PMID may describe a publication later corrected or retracted; periodically audit the literature and retraction notices before citing.
- Browser PDF extraction is limited to the first 20 text-based pages and is **not OCR or scientific figure understanding**.

## Security and privacy

- A publicly served HTML/JS site is not the same as a publicly readable database. The Supabase RLS policies are the data-access boundary.
- **Single-user privacy depends on disabling public sign-ups**. The default papers policy allows *any authenticated account* to read papers, so do not invite others unless shared access is intended. Individual progress/PDFs remain user-specific.
- A service-role key **bypasses RLS**: store it only in GitHub encrypted Actions secrets. Never expose it in `config.js`, source commits, logs, screenshots or client code.
- PDFs may be copyrighted; keep uploads private and do not redistribute.
- Use periodic backups: SQL database export, `reading_progress` JSON export, and separately export private PDFs. The website does not auto-migrate your browser localStorage notes from v4.6; those must be transferred separately.

## Project structure

```
site/                    Online UI and public Supabase configuration
supabase/schema.sql      Database, RLS and private PDF storage
supabase/seed.sql        Original v4.6 literature records
.github/workflows/       Weekly PubMed updater and site deployment
automation/update_papers.py  DOI+PMID metadata ingest
```

## v1.1：独立文献详情页

点击卡片上的「打开详细学习页面」将进入独立阅读视图（地址为 `#paper/<id>`），不再在卡片下方展开。详情包含 Figure、Method、Key Finding、RUNX2 relevance、私人笔记、PDF 上传/查看/文本提取和阅读状态；浏览器返回键及「返回文献列表」可回到卡片列表。它使用同一网站内的 URL 路由，不需要额外配置服务器路由。
