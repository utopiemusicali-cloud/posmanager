# Importa tutti i modelli per farli riconoscere da Alembic
from app.models.base import Base, TimestampMixin
from app.models.user import User
from app.models.customer import Customer
from app.models.shop_receipt import ShopReceipt
from app.models.cash_movement import CashMovement
from app.models.expense import Expense
from app.models.cash_session import CashSession
from app.models.daily_closure import DailyClosure
from app.models.digital_transaction import DigitalTransaction
from app.models.deletion_log import DeletionLog
from app.models.cost_center import CostCenter

__all__ = [
    "Base",
    "TimestampMixin",
    "User",
    "Customer",
    "ShopReceipt",
    "CashMovement",
    "Expense",
    "CashSession",
    "DailyClosure",
    "DigitalTransaction",
    "DeletionLog",
    "CostCenter",
]
