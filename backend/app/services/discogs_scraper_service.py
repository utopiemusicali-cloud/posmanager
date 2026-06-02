"""Scraping Discogs vendite + mercato via Playwright (Firefox headless).
- Sessione persistente via storage_state JSON (cookie).
- Login automatico user/password quando la sessione scade.
- Rate limit: sleep ~3s tra le pagine.
Rispetta la nomenclatura Discogs (Media/Sleeve Condition, valute, date YYYY-MM-DD).
"""
from __future__ import annotations

import asyncio
import os
import re
from datetime import datetime

from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

from app.config import settings

_SLEEP = 3.0  # secondi tra le richieste (rate limit)
_BASE = "https://www.discogs.com"


def _num(text: str) -> float | None:
    m = re.search(r"[\d.,]+", text or "")
    if not m:
        return None
    try:
        return float(m.group().replace(".", "").replace(",", ".")) if text.count(",") and not text.count(".") \
            else float(m.group().replace(",", ""))
    except Exception:
        return None


def _currency(text: str) -> str:
    if "€" in text:
        return "EUR"
    if "£" in text:
        return "GBP"
    if "CA$" in text:
        return "CAD"
    if "$" in text:
        return "USD"
    return "EUR"


def _parse_sales_history(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    sales: list[dict] = []
    for table in soup.find_all("table"):
        ths = table.find_all("th")
        if not (ths and any("date" in th.get_text().lower() for th in ths)):
            continue
        for row in table.find_all("tr", class_="sales-history-row"):
            cells = row.find_all("td")
            if len(cells) < 4:
                continue
            date_txt = cells[0].get_text(strip=True)
            try:
                date = datetime.strptime(date_txt, "%Y-%m-%d").strftime("%Y-%m-%d")
            except Exception:
                date = date_txt
            price_txt = cells[3].get_text(strip=True)
            price = _num(price_txt)
            if not date or price is None:
                continue
            sales.append({
                "date": date,
                "media": cells[1].get_text(strip=True),
                "sleeve": cells[2].get_text(strip=True),
                "price": price,
                "currency": _currency(price_txt),
            })
        break

    out = {"sales_history": sales, "sales_count": len(sales),
           "min_price": None, "max_price": None, "median_price": None,
           "avg_price": None, "last_sold_price": None, "last_sold_date": ""}
    prices = [s["price"] for s in sales if s["price"] is not None]
    if prices:
        sp = sorted(prices)
        out["min_price"] = min(prices)
        out["max_price"] = max(prices)
        out["median_price"] = sp[len(sp) // 2]
        out["avg_price"] = round(sum(prices) / len(prices), 2)
        out["last_sold_price"] = sales[0]["price"]
        out["last_sold_date"] = sales[0]["date"]
    return out


def _parse_market(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    listings: list[dict] = []

    # Copie in vendita = totale paginazione "1 – 25 of N"
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
                # primo span dopo "Media Condition"
                spans = mc.find_all("span")
                txt = mc.get_text(" ", strip=True)
                m = re.search(r"Media Condition:\s*(.+?)(?:Sleeve|$)", txt)
                if m:
                    media = m.group(1).strip()
            sl = desc.select_one(".item_sleeve_condition")
            if sl:
                sleeve = sl.get_text(strip=True)

            # Prezzo + shipping + converted
            price = ship = total = None
            cur = "EUR"
            price_span = row.select_one(".item_price .price, td.item_price .price, .price")
            if price_span:
                cur = _currency(price_span.get_text())
                pv = price_span.get("data-pricevalue")
                price = float(pv) if pv else _num(price_span.get_text())
            ship_span = row.select_one(".item_shipping")
            if ship_span:
                ship = _num(ship_span.get_text())
            conv = row.select_one(".converted_price")
            if conv:
                total = _num(conv.get_text())

            seller = feedback_pct = ship_from = ""
            feedback_count = None
            if seller_td:
                su = seller_td.select_one("a[href*='/seller/']")
                if su:
                    seller = su.get_text(strip=True)
                fb = seller_td.find("strong", string=re.compile(r"%"))
                if fb:
                    feedback_pct = fb.get_text(strip=True)
                fc = seller_td.select_one("a[href*='seller_feedback']")
                if fc:
                    mm = re.search(r"([\d,]+)", fc.get_text())
                    if mm:
                        feedback_count = int(mm.group(1).replace(",", ""))
                for li in seller_td.find_all("li"):
                    t = li.get_text(" ", strip=True)
                    if "Ships From" in t:
                        ship_from = t.split("Ships From:")[-1].strip()

            listings.append({
                "seller": seller, "feedback_pct": feedback_pct,
                "feedback_count": feedback_count, "ship_from": ship_from,
                "media": media, "sleeve": sleeve,
                "price": price, "shipping": ship, "total": total, "currency": cur,
            })

    # have / want / rating (best-effort)
    have = want = ratings_count = None
    avg_rating = None
    for res in soup.select(".community_result"):
        label = res.get_text(" ", strip=True).lower()
        num = res.select_one(".community_number")
        if not num:
            continue
        val = _num(num.get_text())
        if val is None:
            continue
        if "have" in label:
            have = int(val)
        elif "want" in label:
            want = int(val)

    return {
        "market_listings": listings,
        "items_for_sale": items_for_sale if items_for_sale is not None else len(listings),
        "have": have, "want": want,
        "avg_rating": avg_rating, "ratings_count": ratings_count,
    }


class DiscogsScraper:
    """Context manager async: gestisce browser, cookie e login."""

    def __init__(self) -> None:
        self._pw = None
        self._browser = None
        self._ctx = None
        self._page = None

    async def __aenter__(self) -> "DiscogsScraper":
        self._pw = await async_playwright().start()
        self._browser = await self._pw.firefox.launch(headless=True)
        state = settings.DISCOGS_STATE_PATH
        if os.path.exists(state):
            self._ctx = await self._browser.new_context(storage_state=state)
        else:
            self._ctx = await self._browser.new_context()
        self._page = await self._ctx.new_page()
        return self

    async def __aexit__(self, *a) -> None:
        try:
            if self._ctx:
                await self._ctx.close()
            if self._browser:
                await self._browser.close()
            if self._pw:
                await self._pw.stop()
        except Exception:
            pass

    async def _save_state(self) -> None:
        try:
            os.makedirs(os.path.dirname(settings.DISCOGS_STATE_PATH), exist_ok=True)
            await self._ctx.storage_state(path=settings.DISCOGS_STATE_PATH)
        except Exception:
            pass

    async def _is_logged_in(self) -> bool:
        try:
            return await self._page.locator("a[href*='/settings/']").count() > 0 \
                or await self._page.locator("a[href*='/mywants']").count() > 0 \
                or await self._page.locator("#dummy_account_menu, .navbar_user, [data-track-page='Account']").count() > 0
        except Exception:
            return False

    async def login(self) -> bool:
        if not settings.DISCOGS_USERNAME or not settings.DISCOGS_PASSWORD:
            raise RuntimeError("DISCOGS_USERNAME/PASSWORD non configurati nel .env")
        await self._page.goto(f"{_BASE}/login", wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(2)
        try:
            await self._page.fill("input#username", settings.DISCOGS_USERNAME)
            await self._page.fill("input#password", settings.DISCOGS_PASSWORD)
            await self._page.click("button[type='submit']")
            await self._page.wait_for_load_state("networkidle", timeout=30000)
        except Exception as e:
            raise RuntimeError(f"Login Discogs fallito: {e}")
        await asyncio.sleep(2)
        ok = await self._is_logged_in()
        if ok:
            await self._save_state()
        return ok

    async def _ensure_login(self) -> None:
        await self._page.goto(f"{_BASE}/", wait_until="domcontentloaded", timeout=30000)
        if await self._is_logged_in():
            return  # cookie validi
        # Cookie assenti/scaduti → tenta login automatico (se credenziali presenti)
        if not (settings.DISCOGS_USERNAME and settings.DISCOGS_PASSWORD):
            raise RuntimeError(
                "Sessione Discogs scaduta e nessuna credenziale. "
                "Rigenera i cookie con scripts/discogs_login_local.py e ricaricali sul server.")
        if not await self.login():
            raise RuntimeError(
                "Login automatico fallito (probabile captcha). "
                "Usa scripts/discogs_login_local.py per fare login manuale e caricare i cookie.")

    async def _safe_goto(self, url: str, wait_selector: str) -> str:
        """Naviga in modo tollerante: le pagine Discogs sono server-rendered,
        quindi se il goto va in timeout (tracker che tengono aperte connessioni)
        leggiamo comunque l'HTML già presente."""
        try:
            await self._page.goto(url, wait_until="commit", timeout=60000)
        except Exception:
            pass
        # Aspetta che compaia il contenuto che ci serve (o scade)
        try:
            await self._page.wait_for_selector(wait_selector, timeout=15000)
        except Exception:
            pass
        await asyncio.sleep(_SLEEP)
        return await self._page.content()

    async def scrape_release(self, release_id: str, do_login_check: bool = True) -> dict:
        """Scarica storico vendite + mercato per una release."""
        if do_login_check:
            await self._ensure_login()

        # Storico vendite
        html_h = await self._safe_goto(
            f"{_BASE}/sell/history/{release_id}",
            "table, .sales-history-row, #page_content",
        )
        hist = _parse_sales_history(html_h)

        # Mercato attuale (ordinato per prezzo crescente)
        html_m = await self._safe_goto(
            f"{_BASE}/sell/release/{release_id}?sort=price&sort_order=asc",
            "table.mpitems, .pagination_total, #page_content",
        )
        market = _parse_market(html_m)

        # DEBUG temporaneo: salva l'HTML per ispezione
        if os.getenv("SCRAPE_DEBUG"):
            try:
                d = os.path.dirname(settings.DISCOGS_STATE_PATH)
                with open(os.path.join(d, "_dbg_history.html"), "w", encoding="utf-8") as f:
                    f.write(html_h)
                with open(os.path.join(d, "_dbg_market.html"), "w", encoding="utf-8") as f:
                    f.write(html_m)
            except Exception:
                pass

        return {**hist, **market}
