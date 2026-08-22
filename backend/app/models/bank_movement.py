from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Index, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class BankMovement(Base):
    """Movimenti del conto business (estratto conto SumUp).

    L'API pubblica SumUp non espone il conto: questi dati arrivano
    dall'importazione del file scaricato dal dashboard.

    Sugli importi: l'estratto conto porta DUE coppie di valori. Quella di
    "fatturazione" e' in valuta del conto (cio' che ha davvero movimentato il
    saldo) ed e' quella su cui si fa contabilita'; quella di "transazione" e'
    nella valuta originale dell'operazione e coincide con la prima solo se non
    c'e' cambio. Si conservano entrambe: la seconda serve a spiegare perche' un
    acquisto di 100 USD ha inciso per 92,40 EUR.
    """

    __tablename__ = "bank_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Identificativo dell'estratto conto: rende l'import idempotente senza
    # dover calcolare impronte su data+importo+causale, che confonderebbero
    # due addebiti identici dello stesso giorno.
    codice_transazione: Mapped[str] = mapped_column(String(128), unique=True, index=True)

    data: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    tipo: Mapped[str | None] = mapped_column(String(128), index=True)
    riferimento: Mapped[str | None] = mapped_column(Text)
    causale: Mapped[str | None] = mapped_column(Text)
    stato: Mapped[str | None] = mapped_column(String(64), index=True)

    # Importo con segno in valuta del conto: positivo entrata, negativo uscita.
    # Precalcolato perche' e' il valore su cui si fa ogni somma e filtro, e
    # ricavarlo ogni volta dalle due colonne separate e' fonte di errori.
    importo: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    valuta: Mapped[str | None] = mapped_column(String(8))

    # Valuta originale dell'operazione (diversa solo in caso di cambio)
    importo_valuta_originale: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    valuta_originale: Mapped[str | None] = mapped_column(String(8))
    tasso_cambio: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))

    commissione: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    saldo_disponibile: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))

    # Assegnata a mano dall'utente per far confluire il movimento nei report
    # di spesa (stesse categorie di cost_centers).
    categoria: Mapped[str | None] = mapped_column(String(64), index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_bank_movements_data_importo", "data", "importo"),
    )
