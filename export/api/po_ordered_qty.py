"""
Ordered-qty adjustment for item-level Purchase Order close.

ERPNext keeps Bin.ordered_qty = unreceived qty of every submitted Purchase Order
that is not Closed / Delivered (erpnext.stock.stock_balance.get_purchase_order_qty,
called by get_ordered_qty). Closing a whole Purchase Order therefore releases its
ordered qty.

Item-level close (see export/api/po_item_close.py) must do the same for a single
row, so the standard function is wrapped: it returns the standard figure minus the
contribution of item-closed rows (computed with exactly the same formula and
filters as the standard query). Orders with no closed rows are unaffected.

The wrapper is installed by apply() — registered as a before_request / before_job
hook so it is active in every web worker and background job.
"""

import frappe
from frappe.utils import flt

_PATCHED_ATTR = "_gme_item_close_patched"


def apply():
    from erpnext.stock import stock_balance

    if getattr(stock_balance.get_purchase_order_qty, _PATCHED_ATTR, False):
        return

    standard = stock_balance.get_purchase_order_qty

    def get_purchase_order_qty(item_code, warehouse):
        return max(flt(standard(item_code, warehouse)) - get_closed_rows_ordered_qty(item_code, warehouse), 0)

    setattr(get_purchase_order_qty, _PATCHED_ATTR, True)
    get_purchase_order_qty.standard = standard

    # get_ordered_qty looks the name up in stock_balance at call time, so replacing
    # the module attribute covers Purchase Order, Bin and stock reposting alike.
    stock_balance.get_purchase_order_qty = get_purchase_order_qty


def get_closed_rows_ordered_qty(item_code, warehouse):
    """Ordered qty that the standard query attributes to item-closed Purchase Order rows."""
    if not frappe.db.has_column("Purchase Order Item", "custom_item_closed"):
        return 0

    closed_qty = frappe.db.sql(
        """
        select sum((poi.qty - poi.received_qty) * poi.conversion_factor)
        from `tabPurchase Order Item` poi
        join `tabPurchase Order` po on po.name = poi.parent
        where poi.item_code = %(item_code)s and poi.warehouse = %(warehouse)s
            and poi.qty > poi.received_qty
            and po.status not in ('Closed', 'Delivered')
            and po.docstatus = 1
            and coalesce(poi.delivered_by_supplier, 0) = 0
            and poi.custom_item_closed = 1
        """,
        {"item_code": item_code, "warehouse": warehouse},
    )

    return flt(closed_qty[0][0]) if closed_qty else 0
