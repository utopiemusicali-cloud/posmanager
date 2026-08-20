from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InventoryEvent(Base):
    """Storico delle modifiche a un articolo di inventario.

    Una riga per singolo campo modificato: così la cronologia di un articolo
    si legge come un diario ("prezzo 12 -> 10", "status For Sale -> Sold")
    invece che come un blob JSON da interpretare.

    Nessuna FK verso users: gli utenti stanno in posmanager_main mentre questa
    tabella vive nel DB dell'azienda. username viene denormalizzato al momento
    dell'evento, così lo storico resta leggibile anche se l'utente viene poi
    rinominato o disattivato.
    """

    __tablename__ = "inventory_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Riferimento all'articolo (non FK: i listing Discogs possono sparire
    # dall'export e venire cancellati, ma il loro storico resta consultabile).
    listing_id: Mapped[str] = mapped_column(String(20), index=True)

    # "created" | "updated" | "deleted" | "sold" | "discogs_push" | "import"
    event_type: Mapped[str] = mapped_column(String(20), index=True)

    # Campo modificato (price, media_condition, status, ...). Vuoto per
    # eventi che non riguardano un singolo campo (es. "created").
    field: Mapped[str] = mapped_column(String(40), default="")
    old_value: Mapped[str] = mapped_column(Text, default="")
    new_value: Mapped[str] = mapped_column(Text, default="")

    # Chi/cosa ha generato l'evento. source distingue le modifiche manuali
    # da quelle arrivate dal sync Discogs, che non hanno un utente.
    source: Mapped[str] = mapped_column(String(20), default="ui")  # ui | discogs_sync | system
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    username: Mapped[str] = mapped_column(String(64), default="")

    note: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), index=True
    )

    __table_args__ = (
        # La query più frequente è "storico di questo articolo, dal più recente":
        # indice composto per evitare un filesort su una tabella che cresce sempre.
        Index("ix_inventory_events_listing_created", "listing_id", "created_at"),
    )
