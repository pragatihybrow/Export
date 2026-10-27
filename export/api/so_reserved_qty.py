"""
Reserved-qty adjustment for item-level Sales Order close.

ERPNext keeps Bin.reserved_qty = undelivered qty of every submitted Sales Order
that is not Closed / On Hold (erpnext.stock.stock_balance.get_reserved_qty).
Closing a whole Sales Order therefore releases its reservation.

Item-level close (see export/api/so_item_close.py) must do the same for a single
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
    from erpnext.selling.doctype.sales_order import sales_order
    from erpnext.stock import stock_balance

    if getattr(stock_balance.get_reserved_qty, _PATCHED_ATTR, False):
        return

    standard = stock_balance.get_reserved_qty

    def get_reserved_qty(item_code, warehouse):
        return max(flt(standard(item_code, warehouse)) - get_closed_rows_reserved_qty(item_code, warehouse), 0)

    setattr(get_reserved_qty, _PATCHED_ATTR, True)
    get_reserved_qty.standard = standard

    # stock_balance is imported lazily by Bin / accounts_controller, but sales_order.py
    # binds the name at import time, so both references are replaced.
    stock_balance.get_reserved_qty = get_reserved_qty
    sales_order.get_reserved_qty = get_reserved_qty


def get_closed_rows_reserved_qty(item_code, warehouse):
    """Reserved qty that the standard query attributes to item-closed Sales Order rows."""
    if not frappe.db.has_column("Sales Order Item", "custom_item_closed"):
        return 0

    dont_reserve_on_return = frappe.get_cached_value(
        "Selling Settings", "Selling Settings", "dont_reserve_sales_order_qty_on_sales_return"
    )
    values = {"item_code": item_code, "warehouse": warehouse, "dont_reserve": dont_reserve_on_return or 0}

    closed_qty = frappe.db.sql(
        """
        select sum(reserved) from (
            (select
                dnpi.qty * ((soi.qty - soi.delivered_qty
                    - if(%(dont_reserve)s, soi.returned_qty, 0)) / soi.qty) as reserved
            from `tabPacked Item` dnpi
            join `tabSales Order Item` soi on soi.name = dnpi.parent_detail_docname
            join `tabSales Order` so on so.name = dnpi.parent
            where dnpi.item_code = %(item_code)s and dnpi.warehouse = %(warehouse)s
                and dnpi.parenttype = 'Sales Order'
                and dnpi.item_code != dnpi.parent_item
                and soi.custom_item_closed = 1
                and soi.delivered_by_supplier = 0
                and so.docstatus = 1 and so.status not in ('On Hold', 'Closed')
                and soi.qty >= soi.delivered_qty)
            union all
            (select
                soi.stock_qty * ((soi.qty - soi.delivered_qty
                    - if(%(dont_reserve)s, soi.returned_qty, 0)) / soi.qty) as reserved
            from `tabSales Order Item` soi
            join `tabSales Order` so on so.name = soi.parent
            where soi.item_code = %(item_code)s and soi.warehouse = %(warehouse)s
                and (soi.delivered_by_supplier is null or soi.delivered_by_supplier = 0)
                and soi.custom_item_closed = 1
                and so.docstatus = 1 and so.status not in ('On Hold', 'Closed')
                and soi.qty >= soi.delivered_qty)
        ) closed_rows
        """,
        values,
    )

    return flt(closed_qty[0][0]) if closed_qty else 0
