"""
Scraper Discogs LOCALE (gira sul TUO PC) → invia i dati vendita/mercato al server.

Perché locale: Discogs è dietro Cloudflare, che blocca lo scraping headless dal
server datacenter. Sul tuo PC (browser reale, IP residenziale) Cloudflare passa.

── SETUP (una volta) ───────────────────────────────────────────────────────────
    pip install playwright requests beautifulsoup4
    playwright install firefox

── USO ──────────────────────────────────────────────────────────────────────────
    # Scrapa tutte le release "For Sale" che non hanno ancora dati:
    python discogs_scrape_local.py

    # Oppure release specifiche:
    python discogs_scrape_local.py 855183 302240 1048880

Al primo avvio si apre Firefox: fai login su Discogs (anche captcha), poi premi
INVIO nel terminale. Il profilo resta salvato in ./discogs_profile per le volte dopo.
"""
import sys
import time
import re
import requests
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

# ── CONFIG ────────────────────────────────────────────────────────────────────
SERVER = "https://vps-008f120b.vps.ovh.net"
ADMIN_USER = "admin"
ADMIN_PASS = "Osrecords.Admin1"
PROFILE_DIR = "discogs_profile"   # profilo browser persistente (login + cloudflare)
SLEEP = 3.0
BASE = "https://www.discogs.com"


# ── Parsing (stessa logica del server) ─────────────────────────────────────────
def _num(text):
    m = re.search(r"[\d.,]+", text or "")
    if not m:
        return None
    s = m.group()
    try:
        if "," in s and "." not in s:
            return float(s.replace(".", "").replace(",", "."))
        return float(s.replace(",", ""))
    except Exception:
        return None


def _currency(text):
    if "€" in text: return "EUR"
    if "£" in text: return "GBP"
    if "CA$" in text: return "CAD"
    if "$" in text: return "USD"
    return "EUR"


def parse_history(html):
    soup = BeautifulSoup(html, "html.parser")
    sales = []
    for table in soup.find_all("table"):
        ths = table.find_all("th")
        if not (ths and any("date" in th.get_text().lower() for th in ths)):
            continue
        for row in table.find_all("tr", class_="sales-history-row"):
            cells = row.find_all("td")
            if len(cells) < 4:
                continue
            date = cells[0].get_text(strip=True)
            price_txt = cells[3].get_text(strip=True)
            price = _num(price_txt)
            if not date or price is None:
                continue
            sales.append({"date": date, "media": cells[1].get_text(strip=True),
                          "sleeve": cells[2].get_text(strip=True),
                          "price": price, "currency": _currency(price_txt)})
        break
    out = {"sales_history": sales, "sales_count": len(sales), "min_price": None,
           "max_price": None, "median_price": None, "avg_price": None,
           "last_sold_price": None, "last_sold_date": ""}
    prices = [s["price"] for s in sales]
    if prices:
        sp = sorted(prices)
        out.update(min_price=min(prices), max_price=max(prices), median_price=sp[len(sp)//2],
                   avg_price=round(sum(prices)/len(prices), 2),
                   last_sold_price=sales[0]["price"], last_sold_date=sales[0]["date"])
    return out


def parse_market(html):
    soup = BeautifulSoup(html, "html.parser")
    listings = []
    items_for_sale = None
    tot = soup.select_one(".pagination_total")
    if tot:
        m = re.search(r"of\s+([\d,]+)", tot.get_text())
        if m:
            items_for_sale = int(m.group(1).replace(",", ""))
    table = soup.select_one("table.mpitems")
    if table:
        for row in table.select("tbody > tr"):
            desc = row.select_one("td.item_description")
            seller_td = row.select_one("td.seller_info")
            if not desc:
                continue
            media = sleeve = ""
            mc = desc.select_one(".item_condition")
            if mc:
                m = re.search(r"Media Condition:\s*(.+?)(?:Sleeve|$)", mc.get_text(" ", strip=True))
                if m: media = m.group(1).strip()
            sl = desc.select_one(".item_sleeve_condition")
            if sl: sleeve = sl.get_text(strip=True)
            price = ship = total = None
            cur = "EUR"
            ps = row.select_one(".item_price .price, .price")
            if ps:
                cur = _currency(ps.get_text())
                pv = ps.get("data-pricevalue")
                price = float(pv) if pv else _num(ps.get_text())
            sh = row.select_one(".item_shipping")
            if sh: ship = _num(sh.get_text())
            cv = row.select_one(".converted_price")
            if cv: total = _num(cv.get_text())
            seller = fb_pct = ship_from = ""
            fb_count = None
            if seller_td:
                su = seller_td.select_one("a[href*='/seller/']")
                if su: seller = su.get_text(strip=True)
                fb = seller_td.find("strong", string=re.compile(r"%"))
                if fb: fb_pct = fb.get_text(strip=True)
                fc = seller_td.select_one("a[href*='seller_feedback']")
                if fc:
                    mm = re.search(r"([\d,]+)", fc.get_text())
                    if mm: fb_count = int(mm.group(1).replace(",", ""))
                for li in seller_td.find_all("li"):
                    t = li.get_text(" ", strip=True)
                    if "Ships From" in t:
                        ship_from = t.split("Ships From:")[-1].strip()
            listings.append({"seller": seller, "feedback_pct": fb_pct, "feedback_count": fb_count,
                             "ship_from": ship_from, "media": media, "sleeve": sleeve,
                             "price": price, "shipping": ship, "total": total, "currency": cur})
    have = want = None
    for res in soup.select(".community_result"):
        label = res.get_text(" ", strip=True).lower()
        num = res.select_one(".community_number")
        if num:
            v = _num(num.get_text())
            if v is not None:
                if "have" in label: have = int(v)
                elif "want" in label: want = int(v)
    return {"market_listings": listings,
            "items_for_sale": items_for_sale if items_for_sale is not None else len(listings),
            "have": have, "want": want, "avg_rating": None, "ratings_count": None}


_CF_MARKERS = ("just a moment", "performing security verification",
               "verifying you are human", "needs to review the security",
               "challenge-platform", "cf-challenge")


def _is_challenge(page):
    try:
        html = page.content().lower()
    except Exception:
        return True
    return any(m in html for m in _CF_MARKERS)


def wait_challenge(page, label=""):
    """Aspetta che la verifica Cloudflare si risolva. Se non si risolve da sola,
    chiede all'utente di risolverla a mano nel browser (è headed)."""
    for _ in range(8):
        if not _is_challenge(page):
            return
        time.sleep(1.5)
    # Ancora bloccato → intervento manuale
    print(f"\n⚠  Cloudflare chiede verifica {label}. Risolvila nel browser (clicca la casella).")
    input(">>> Premi INVIO quando la pagina mostra il contenuto Discogs... ")


def scrape_release(page, rid):
    page.goto(f"{BASE}/sell/history/{rid}", wait_until="domcontentloaded", timeout=60000)
    wait_challenge(page, f"(history {rid})")
    time.sleep(SLEEP)
    hist = parse_history(page.content())
    page.goto(f"{BASE}/sell/release/{rid}?sort=price&sort_order=asc",
              wait_until="domcontentloaded", timeout=60000)
    wait_challenge(page, f"(release {rid})")
    time.sleep(SLEEP)
    market = parse_market(page.content())
    return {**hist, **market}


def main():
    # 1. Login al server
    print(f"→ Login al server {SERVER} ...")
    r = requests.post(f"{SERVER}/api/v1/auth/token",
                      data={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=30)
    r.raise_for_status()
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Lista release da scrapare
    rids = sys.argv[1:]
    if not rids:
        td = requests.get(f"{SERVER}/api/v1/inventory/sales-todo",
                          headers=headers, timeout=60).json()
        rids = td["todo"]
        print(f"→ Da scrapare: {len(rids)} release (su {td['total_inventory']} in inventario, "
              f"{td['already_scraped']} già fatte)")
    if not rids:
        print("Niente da fare. ✅")
        return

    # 3. Browser persistente — Chrome REALE + anti-rilevamento automazione
    with sync_playwright() as p:
        launch_kwargs = dict(
            headless=False,
            args=["--disable-blink-features=AutomationControlled",
                  "--disable-infobars", "--start-maximized"],
            ignore_default_args=["--enable-automation"],
            viewport=None,
        )
        try:
            ctx = p.chromium.launch_persistent_context(PROFILE_DIR, channel="chrome", **launch_kwargs)
        except Exception:
            print("⚠  Chrome non trovato, uso Chromium bundle (più rilevabile).")
            ctx = p.chromium.launch_persistent_context(PROFILE_DIR, **launch_kwargs)

        # Nasconde i flag di automazione
        ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
            "window.chrome={runtime:{}};"
            "Object.defineProperty(navigator,'languages',{get:()=>['it-IT','it','en']});"
            "Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});"
        )

        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(BASE, wait_until="domcontentloaded")
        wait_challenge(page, "(home)")
        input("\n>>> Assicurati di essere LOGGATO su Discogs nel browser, poi premi INVIO... ")

        ok = 0
        for i, rid in enumerate(rids, 1):
            try:
                data = scrape_release(page, rid)
                resp = requests.post(f"{SERVER}/api/v1/inventory/releases/{rid}/sales-ingest",
                                     headers=headers, json=data, timeout=30)
                resp.raise_for_status()
                ok += 1
                print(f"[{i}/{len(rids)}] release {rid}: "
                      f"{data['sales_count']} vendite, {data['items_for_sale']} in vendita ✅")
            except Exception as e:
                print(f"[{i}/{len(rids)}] release {rid}: ERRORE {e}")
            time.sleep(SLEEP)
        ctx.close()
        print(f"\n✅ Completato: {ok}/{len(rids)} release inviate al server.")


if __name__ == "__main__":
    main()
