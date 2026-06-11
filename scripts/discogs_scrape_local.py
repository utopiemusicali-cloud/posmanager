"""
Scraper Discogs LOCALE (gira sul TUO PC) → invia i dati vendita/mercato al server.

Usa SeleniumBase in modalità UC (Undetected) che supera la verifica Cloudflare
(Playwright/Chromium normale viene rilevato via CDP e bloccato).

── SETUP (una volta) ───────────────────────────────────────────────────────────
    pip install seleniumbase requests beautifulsoup4
    (SeleniumBase scarica da solo il driver Chrome al primo avvio)

── USO ──────────────────────────────────────────────────────────────────────────
    # Tutte le release "For Sale" senza dati:
    python discogs_scrape_local.py
    # Oppure release specifiche:
    python discogs_scrape_local.py 855183 302240

Primo avvio: si apre Chrome, supera Cloudflare, fai LOGIN su Discogs, premi INVIO.
Il profilo resta in ./discogs_profile (login + clearance persistono).
"""
import sys
import time
import re
import requests
from bs4 import BeautifulSoup
from seleniumbase import Driver

# ── CONFIG ────────────────────────────────────────────────────────────────────
SERVER = "https://vps-008f120b.vps.ovh.net"
ADMIN_USER = "admin"
ADMIN_PASS = "Osrecords.Admin1"
PROFILE_DIR = "discogs_profile"
SLEEP = 3.0
BASE = "https://www.discogs.com"

_CF_MARKERS = ("just a moment", "esecuzione della verifica", "performing security",
               "verifying you are human", "challenge-platform", "cf-challenge",
               "verifica di sicurezza")

# Whitelist condizioni Discogs (pulisce il testo dal tooltip descrittivo)
_COND_RE = re.compile(
    r"(Mint \(M\)|Near Mint \(NM or M-\)|Very Good Plus \(VG\+\)|Very Good \(VG\)|"
    r"Good Plus \(G\+\)|Good \(G\)|Fair \(F\)|Poor \(P\)|Generic|No Cover|Not Graded)")


# ── Parsing ─────────────────────────────────────────────────────────────────────
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
                m = _COND_RE.search(mc.get_text(" ", strip=True))
                if m: media = m.group(1)
            sl = desc.select_one(".item_sleeve_condition")
            if sl:
                m = _COND_RE.search(sl.get_text(" ", strip=True))
                sleeve = m.group(1) if m else sl.get_text(strip=True)
            comments = ""
            cp = desc.select_one("p.hide_mobile:not(.label_and_cat)")
            if cp and not cp.select_one(".mplabel"):
                comments = cp.get_text(" ", strip=True)
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
                             "comments": comments, "price": price, "shipping": ship,
                             "total": total, "currency": cur})
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


# ── Browser UC ────────────────────────────────────────────────────────────────
def _open_cf(driver, url):
    """Apre una URL superando l'eventuale challenge Cloudflare."""
    driver.uc_open_with_reconnect(url, reconnect_time=6)
    src = driver.get_page_source()
    if any(m in src.lower() for m in _CF_MARKERS):
        try:
            driver.uc_gui_click_captcha()
        except Exception:
            pass
        time.sleep(5)
        src = driver.get_page_source()
    return src


def scrape_release(driver, rid):
    html = _open_cf(driver, f"{BASE}/sell/history/{rid}")
    hist = parse_history(html)
    time.sleep(SLEEP)
    html = _open_cf(driver, f"{BASE}/sell/release/{rid}?sort=listed&sort_order=desc")
    market = parse_market(html)
    time.sleep(SLEEP)
    return {**hist, **market}


def main():
    print(f"→ Login al server {SERVER} ...")
    r = requests.post(f"{SERVER}/api/v1/auth/token",
                      data={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=30)
    r.raise_for_status()
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    rids = sys.argv[1:]
    if not rids:
        td = requests.get(f"{SERVER}/api/v1/inventory/sales-todo", headers=headers, timeout=60).json()
        rids = td["todo"]
        print(f"→ Da scrapare: {len(rids)} release (inventario {td['total_inventory']}, "
              f"già fatte {td['already_scraped']})")
    if not rids:
        print("Niente da fare. ✅")
        return

    driver = Driver(uc=True, headed=True, user_data_dir=PROFILE_DIR, locale_code="it")
    try:
        driver.uc_open_with_reconnect(BASE, reconnect_time=6)
        if any(m in driver.get_page_source().lower() for m in _CF_MARKERS):
            try:
                driver.uc_gui_click_captcha()
            except Exception:
                pass
        input("\n>>> Fai LOGIN su Discogs nel browser (se non già loggato), poi premi INVIO... ")

        ok = 0
        for i, rid in enumerate(rids, 1):
            try:
                data = scrape_release(driver, rid)
                resp = requests.post(f"{SERVER}/api/v1/inventory/releases/{rid}/sales-ingest",
                                     headers=headers, json=data, timeout=30)
                resp.raise_for_status()
                ok += 1
                print(f"[{i}/{len(rids)}] {rid}: {data['sales_count']} vendite, "
                      f"{data['items_for_sale']} in vendita ✅")
            except Exception as e:
                print(f"[{i}/{len(rids)}] {rid}: ERRORE {e}")
    finally:
        driver.quit()
    print(f"\n✅ Completato: {ok}/{len(rids)} inviate.")


if __name__ == "__main__":
    main()
