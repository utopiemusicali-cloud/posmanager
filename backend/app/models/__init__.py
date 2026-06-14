# Modelli DB principale (posmanager_main)
from app.models.main_base import MainBase
from app.models.base import Base, TimestampMixin
from app.models.company import Company
from app.models.user import User, UserRole

# Modelli per DB aziendali (posmanager, posmanager_oblique, ...)
from app.models.customer import Customer
from app.models.shop_receipt import ShopReceipt
from app.models.cash_movement import CashMovement
from app.models.expense import Expense
from app.models.cash_session import CashSession
from app.models.daily_closure import DailyClosure
from app.models.digital_transaction import DigitalTransaction
from app.models.deletion_log import DeletionLog
from app.models.cost_center import CostCenter
from app.models.inventory_item import InventoryItem
from app.models.release_meta import ReleaseMeta
from app.models.release_sales import ReleaseSales
from app.models.receipt_payment import ReceiptPayment
from app.models.shop_settings import ShopSettings
from app.models.company_settings import CompanySettings

__all__ = [
    "MainBase",
    "Base",
    "TimestampMixin",
    # main DB
    "Company",
    "User",
    "UserRole",
    # company DB
    "Customer",
    "ShopReceipt",
    "CashMovement",
    "Expense",
    "CashSession",
    "DailyClosure",
    "DigitalTransaction",
    "DeletionLog",
    "CostCenter",
    "InventoryItem",
    "ReleaseMeta",
    "ReleaseSales",
    "ReceiptPayment",
    "ShopSettings",
    "CompanySettings",
]
