"""
Item-level close for Sales Orders.

Closing a Sales Order item applies the standard whole-order "Close" rules to a
single row:

  • the row's undelivered qty is released from Bin.reserved_qty
    (see export/api/so_reserved_qty.py)
  • the row can no longer be delivered, invoiced or purchased against
    (mappers skip it; Delivery Note / Sales Invoice / Purchase Order validation
    blocks it, returns excepted — same as a closed Sales Order)
  • the row cannot be changed or deleted through "Update Items"
  • re-opening restores the reservation and re-checks the credit limit

When every row is either item-closed or fully delivered and billed, the standard
whole-order Close (SalesOrder.update_status("Closed")) is run automatically.

Standard Delivered % / Billed % / status logic is never modified; orders without
closed rows behave exactly as before.
"""

import frappe
from frappe import _
from frappe.utils import flt, getdate, now_datetime

CLOSED_FIELD = "custom_item_closed"


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_closed_rows(so_item_names):
    """Return the subset of the given Sales Order Item names that are item-closed."""
    so_item_names = [name for name in set(so_item_names or []) if name]
    if not so_item_names or not frappe.db.has_column("Sales Order Item", CLOSED_FIELD):
        return set()

    return set(
        frappe.get_all(
            "Sales Order Item",
            filters={"name": ["in", so_item_names], CLOSED_FIELD: 1},
            pluck="name",
        )
    )


def can_close_row(row):
    """Same condition as the standard Close button: something is left to deliver or bill."""
    if row.get(CLOSED_FIELD):
        return False
    return flt(row.delivered_qty) < flt(row.qty) or flt(row.billed_amt) < flt(row.amount)


def is_row_complete(so, row):
    delivered = so.skip_delivery_note or flt(row.delivered_qty) >= flt(row.qty)
    precision = row.precision("amount")
    billed = flt(row.billed_amt, precision) >= flt(row.amount, precision)
    return delivered and billed


def _describe(rows):
    return ", ".join(f"#{row.idx} {row.item_code}" for row in rows)


def _get_sales_order(sales_order):
    # Same permission the standard Close / Re-open uses.
    frappe.has_permission("Sales Order", "submit", sales_order, throw=True)

    so = frappe.get_doc("Sales Order", sales_order)
    if so.docstatus != 1:
        frappe.throw(_("Items can only be closed or re-opened on a submitted Sales Order."))
    if so.status == "Closed":
        frappe.throw(_("Sales Order {0} is Closed. Re-open the Sales Order first.").format(so.name))
    return so


def _get_rows(so, so_item_names):
    so_item_names = frappe.parse_json(so_item_names) or []
    rows = [row for row in so.items if row.name in so_item_names]
    if not rows:
        frappe.throw(_("Please select at least one item."))
    return rows


def _validate_can_close(row):
    if not can_close_row(row):
        frappe.throw(_("Row #{0}: Item {1} is already fully delivered and billed.").format(row.idx, row.item_code))


def _closed_values(row, now):
    return {
        CLOSED_FIELD: 1,
        "custom_closed_qty": max(flt(row.qty) - flt(row.delivered_qty), 0),
        "custom_closed_by": frappe.session.user,
        "custom_closed_on": now,
    }


def _reopened_values(now):
    return {
        CLOSED_FIELD: 0,
        "custom_closed_qty": 0,
        "custom_reopened_by": frappe.session.user,
        "custom_reopened_on": now,
    }


def _apply_changes(so, closed_rows, reopened_rows):
    """Reservation, timeline and credit limit — same for the popup and the row checkbox."""
    changed = closed_rows + reopened_rows
    if not changed:
        return False

    so.update_reserved_qty(so_item_rows=[row.name for row in changed])
    if closed_rows:
        so.add_comment("Info", _("Closed item(s): {0}").format(_describe(closed_rows)))
    if reopened_rows:
        so.add_comment("Info", _("Re-opened item(s): {0}").format(_describe(reopened_rows)))
        # Standard Re-open checks the credit limit once the reservation is back.
        so.check_credit_limit()

    return auto_close_if_done(so.name)


# ── Close / Re-open (Status → Close Items / Re-open Items popup) ─────────────

@frappe.whitelist()
def close_items(sales_order, items):
    so = _get_sales_order(sales_order)
    rows = _get_rows(so, items)

    for row in rows:
        if row.get(CLOSED_FIELD):
            frappe.throw(_("Row #{0}: Item {1} is already closed.").format(row.idx, row.item_code))
        _validate_can_close(row)

    now = now_datetime()
    for row in rows:
        row.db_set(_closed_values(row, now), update_modified=False)

    # Bump the parent's modified timestamp so a form opened before this change
    # cannot overwrite the closed flags with stale values.
    frappe.db.set_value("Sales Order", so.name, "modified_by", frappe.session.user)
    _apply_changes(so, rows, [])
    so.notify_update()


@frappe.whitelist()
def reopen_items(sales_order, items):
    so = _get_sales_order(sales_order)
    rows = _get_rows(so, items)

    for row in rows:
        if not row.get(CLOSED_FIELD):
            frappe.throw(_("Row #{0}: Item {1} is not closed.").format(row.idx, row.item_code))

    now = now_datetime()
    for row in rows:
        row.db_set(_reopened_values(now), update_modified=False)

    frappe.db.set_value("Sales Order", so.name, "modified_by", frappe.session.user)
    _apply_changes(so, [], rows)
    so.notify_update()


# ── Close / Re-open by ticking "Item Closed" in the row and clicking Update ──

_CLOSE_FIELDS = (
    CLOSED_FIELD,
    "custom_closed_qty",
    "custom_closed_by",
    "custom_closed_on",
    "custom_reopened_by",
    "custom_reopened_on",
)


def validate_sales_order(doc, method=None):
    """Sales Order validate (draft saves): items can only be closed once submitted."""
    for row in doc.items:
        for field in _CLOSE_FIELDS:
            if row.get(field):
                row.set(field, None)


def before_sales_order_update(doc, method=None):
    """Sales Order before_update_after_submit: handle rows whose Item Closed checkbox changed."""
    before = doc.get_doc_before_save()
    if not before or not frappe.db.has_column("Sales Order Item", CLOSED_FIELD):
        return

    old_rows = {row.name: row for row in before.items}
    closed, reopened = [], []
    now = now_datetime()

    for row in doc.items:
        old = old_rows.get(row.name)
        was_closed = bool(old and old.get(CLOSED_FIELD))
        is_closed = bool(row.get(CLOSED_FIELD))

        if old:
            # Only Item Closed is user-editable; the audit fields always come from the server.
            for field in _CLOSE_FIELDS[1:]:
                row.set(field, old.get(field))

        if is_closed == was_closed:
            continue

        if before.status == "Closed":
            frappe.throw(_("Sales Order {0} is Closed. Re-open the Sales Order first.").format(doc.name))

        if is_closed:
            # Eligibility is checked on the saved row (Item Closed still unticked there).
            _validate_can_close(old or row)
            row.update(_closed_values(row, now))
            closed.append(row)
        else:
            row.update(_reopened_values(now))
            reopened.append(row)

    doc.flags.gme_item_close_changes = (closed, reopened)


def after_sales_order_update(doc, method=None):
    """Sales Order on_update_after_submit: reservation, timeline, credit limit, auto close."""
    closed, reopened = doc.flags.pop("gme_item_close_changes", None) or ([], [])
    if _apply_changes(doc, closed, reopened):
        # The order was closed in the database; keep the returned form in sync.
        doc.status, doc.modified = frappe.db.get_value("Sales Order", doc.name, ["status", "modified"])


# ── Automatic whole-order close ───────────────────────────────────────────────

def auto_close_if_done(sales_order):
    """Run the standard Close when nothing is left: every row closed or delivered + billed."""
    if not frappe.db.exists("Sales Order Item", {"parent": sales_order, CLOSED_FIELD: 1}):
        return

    so = frappe.get_doc("Sales Order", sales_order)
    if so.docstatus != 1 or so.status in ("Closed", "On Hold", "Completed"):
        return

    if all(row.get(CLOSED_FIELD) or is_row_complete(so, row) for row in so.items):
        so.update_status("Closed")
        so.add_comment(
            "Info",
            _("Sales Order closed automatically: every item is either closed or fully delivered and billed."),
        )
        return True
    return False


def sync_closed_qty(doc, method=None):
    """
    Delivery Note / Sales Invoice on_submit + on_cancel: keep Closed Qty equal to the
    undelivered qty of a closed row when its delivered qty moves afterwards — a return
    brings qty back, cancelling an earlier delivery does the same.
    """
    closed = get_closed_rows([row.get("so_detail") for row in doc.items])
    for so_item in closed:
        qty, delivered_qty = frappe.db.get_value("Sales Order Item", so_item, ["qty", "delivered_qty"])
        frappe.db.set_value(
            "Sales Order Item",
            so_item,
            "custom_closed_qty",
            max(flt(qty) - flt(delivered_qty), 0),
            update_modified=False,
        )


def auto_close_linked_sales_orders(doc, method=None):
    """Delivery Note / Sales Invoice on_submit."""
    if doc.get("is_return"):
        return

    link_field = "against_sales_order" if doc.doctype == "Delivery Note" else "sales_order"
    for sales_order in {row.get(link_field) for row in doc.items if row.get(link_field)}:
        auto_close_if_done(sales_order)


# ── Blocking closed rows in downstream documents ──────────────────────────────

def _throw_if_closed_rows(doc, link_field):
    closed = get_closed_rows([row.get(link_field) for row in doc.items])
    if not closed:
        return

    rows = [row for row in doc.items if row.get(link_field) in closed]
    frappe.throw(
        _("These rows are linked to closed Sales Order items: {0}.<br>Re-open the item in the Sales Order or remove the row.").format(
            _describe(rows)
        ),
        title=_("Sales Order Item Closed"),
    )


def validate_delivery_note(doc, method=None):
    if not doc.is_return:
        _throw_if_closed_rows(doc, "so_detail")


def validate_sales_invoice(doc, method=None):
    if not doc.is_return:
        _throw_if_closed_rows(doc, "so_detail")


def validate_purchase_order(doc, method=None):
    if doc.docstatus == 0 or doc.is_new():
        _throw_if_closed_rows(doc, "sales_order_item")


def remove_closed_rows(doc, link_field):
    """Drop rows mapped from closed Sales Order items out of a freshly mapped document."""
    closed = get_closed_rows([row.get(link_field) for row in doc.items])
    if not closed:
        return []

    removed = [row for row in doc.items if row.get(link_field) in closed]
    doc.set("items", [row for row in doc.items if row.get(link_field) not in closed])
    if not doc.items:
        frappe.throw(_("All pending items of this Sales Order are closed."), title=_("Sales Order Item Closed"))

    for idx, row in enumerate(doc.items, start=1):
        row.idx = idx
    if doc.meta.has_field("payment_schedule"):
        doc.set("payment_schedule", [])
    doc.run_method("calculate_taxes_and_totals")

    frappe.msgprint(
        _("Closed Sales Order items were skipped: {0}").format(", ".join(row.item_code for row in removed)),
        alert=True,
        indicator="orange",
    )
    return removed


def strip_closed_rows_from_purchase_order(doc, method=None):
    """Purchase Order before_validate — only during make_purchase_order_for_default_supplier."""
    if frappe.flags.gme_strip_closed_so_rows and doc.is_new():
        remove_closed_rows(doc, "sales_order_item")


# ── Whitelisted overrides ─────────────────────────────────────────────────────

@frappe.whitelist()
def update_child_qty_rate(parent_doctype, trans_items, parent_doctype_name, child_docname="items"):
    """Update Items: closed rows cannot be changed or deleted (same as a closed order)."""
    from erpnext.controllers.accounts_controller import update_child_qty_rate as standard

    if parent_doctype == "Sales Order":
        _validate_closed_rows_unchanged(parent_doctype_name, frappe.parse_json(trans_items))
    elif parent_doctype == "Purchase Order":
        from export.api.po_item_close import validate_closed_rows_unchanged

        validate_closed_rows_unchanged(parent_doctype_name, frappe.parse_json(trans_items))

    return standard(parent_doctype, trans_items, parent_doctype_name, child_docname)


def _validate_closed_rows_unchanged(sales_order, trans_items):
    if not frappe.db.has_column("Sales Order Item", CLOSED_FIELD):
        return

    closed_rows = frappe.get_all(
        "Sales Order Item",
        filters={"parent": sales_order, "parenttype": "Sales Order", CLOSED_FIELD: 1},
        fields=["name", "idx", "item_code", "qty", "rate", "uom", "conversion_factor", "delivery_date"],
    )
    if not closed_rows:
        return

    rate_precision = frappe.get_precision("Sales Order Item", "rate")
    updates = {d.get("docname"): d for d in trans_items if d.get("docname")}

    for row in closed_rows:
        new = updates.get(row.name)
        changed = (
            not new
            or new.get("item_code") != row.item_code
            or flt(new.get("qty")) != flt(row.qty)
            or flt(new.get("rate"), rate_precision) != flt(row.rate, rate_precision)
            or (new.get("uom") and new.get("uom") != row.uom)
            or (new.get("conversion_factor") and flt(new.get("conversion_factor")) != flt(row.conversion_factor))
            or (new.get("delivery_date") and getdate(new.get("delivery_date")) != getdate(row.delivery_date))
        )
        if changed:
            frappe.throw(
                _("Row #{0}: Item {1} is closed and cannot be changed or deleted. Re-open the item first.").format(
                    row.idx, row.item_code
                ),
                title=_("Sales Order Item Closed"),
            )


def _filter_po_selection(source_name, selected_items):
    """Drop selected items whose every pending Sales Order row is closed."""
    selected_items = frappe.parse_json(selected_items) or []
    if not selected_items or not frappe.db.has_column("Sales Order Item", CLOSED_FIELD):
        return selected_items

    open_item_codes = {
        row.item_code
        for row in frappe.get_all(
            "Sales Order Item",
            filters={"parent": source_name, "parenttype": "Sales Order", CLOSED_FIELD: 0},
            fields=["item_code"],
        )
    }
    kept = [d for d in selected_items if d.get("item_code") in open_item_codes]
    if not kept:
        frappe.throw(_("All selected items are closed in this Sales Order."), title=_("Sales Order Item Closed"))
    return kept


@frappe.whitelist()
def make_purchase_order(source_name, selected_items=None, target_doc=None):
    from erpnext.selling.doctype.sales_order.sales_order import make_purchase_order as standard

    doc = standard(source_name, _filter_po_selection(source_name, selected_items), target_doc)
    if doc:
        remove_closed_rows(doc, "sales_order_item")
    return doc


@frappe.whitelist()
def make_purchase_order_for_default_supplier(source_name, selected_items=None, target_doc=None):
    from erpnext.selling.doctype.sales_order.sales_order import (
        make_purchase_order_for_default_supplier as standard,
    )

    selected_items = _filter_po_selection(source_name, selected_items)
    frappe.flags.gme_strip_closed_so_rows = True
    try:
        return standard(source_name, selected_items, target_doc)
    finally:
        frappe.flags.gme_strip_closed_so_rows = False
