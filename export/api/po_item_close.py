"""
Item-level close for Purchase Orders.

Closing a Purchase Order item applies the standard whole-order "Close" rules to a
single row (same approach as export/api/so_item_close.py for Sales Orders):

  • the row's unreceived qty is released from Bin.ordered_qty
    (see export/api/po_ordered_qty.py)
  • the row can no longer be received or invoiced directly from the Purchase Order
    (mappers skip it; Purchase Receipt / Purchase Invoice validation blocks it,
    returns excepted). A Purchase Invoice made from a Purchase Receipt is still
    allowed — the standard Closed check skips those rows as well.
  • the row cannot be changed or deleted through "Update Items"

When every row is either item-closed or fully received and billed, the standard
whole-order Close (PurchaseOrder.update_status("Closed")) is run automatically.

Standard Received % / Billed % / status logic is never modified; orders without
closed rows behave exactly as before.
"""

import frappe
from frappe import _
from frappe.utils import flt, getdate, now_datetime

CLOSED_FIELD = "custom_item_closed"


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_closed_rows(po_item_names):
    """Return the subset of the given Purchase Order Item names that are item-closed."""
    po_item_names = [name for name in set(po_item_names or []) if name]
    if not po_item_names or not frappe.db.has_column("Purchase Order Item", CLOSED_FIELD):
        return set()

    return set(
        frappe.get_all(
            "Purchase Order Item",
            filters={"name": ["in", po_item_names], CLOSED_FIELD: 1},
            pluck="name",
        )
    )


def can_close_row(row):
    """Same condition as the standard Close button: something is left to receive or bill."""
    if row.get(CLOSED_FIELD):
        return False
    return flt(row.received_qty) < flt(row.qty) or flt(row.billed_amt) < flt(row.amount)


def is_row_complete(row):
    received = row.delivered_by_supplier or flt(row.received_qty) >= flt(row.qty)
    precision = row.precision("amount")
    billed = flt(row.billed_amt, precision) >= flt(row.amount, precision)
    return received and billed


def _describe(rows):
    return ", ".join(f"#{row.idx} {row.item_code}" for row in rows)


def _validate_supported(po):
    # The new subcontracting flow keeps its own Subcontracting Order; item close
    # would leave it out of sync, so only the standard whole-order Close applies there.
    if po.is_subcontracted and not po.is_old_subcontracting_flow:
        frappe.throw(_("Item close is not available for subcontracted Purchase Orders."))


def _get_purchase_order(purchase_order):
    # Same permission the standard Close / Re-open uses.
    frappe.has_permission("Purchase Order", "submit", purchase_order, throw=True)

    po = frappe.get_doc("Purchase Order", purchase_order)
    if po.docstatus != 1:
        frappe.throw(_("Items can only be closed or re-opened on a submitted Purchase Order."))
    if po.status == "Closed":
        frappe.throw(_("Purchase Order {0} is Closed. Re-open the Purchase Order first.").format(po.name))
    _validate_supported(po)
    return po


def _get_rows(po, po_item_names):
    po_item_names = frappe.parse_json(po_item_names) or []
    rows = [row for row in po.items if row.name in po_item_names]
    if not rows:
        frappe.throw(_("Please select at least one item."))
    return rows


def _validate_can_close(row):
    if not can_close_row(row):
        frappe.throw(_("Row #{0}: Item {1} is already fully received and billed.").format(row.idx, row.item_code))


def _closed_values(row, now):
    return {
        CLOSED_FIELD: 1,
        "custom_closed_qty": max(flt(row.qty) - flt(row.received_qty), 0),
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


def _apply_changes(po, closed_rows, reopened_rows):
    """Ordered qty, timeline and auto close — same for the popup and the row checkbox."""
    changed = closed_rows + reopened_rows
    if not changed:
        return False

    po.update_ordered_qty(po_item_rows=[row.name for row in changed])
    if closed_rows:
        po.add_comment("Info", _("Closed item(s): {0}").format(_describe(closed_rows)))
    if reopened_rows:
        po.add_comment("Info", _("Re-opened item(s): {0}").format(_describe(reopened_rows)))

    return auto_close_if_done(po.name)


# ── Close / Re-open (Status → Close Items / Re-open Items popup) ─────────────

@frappe.whitelist()
def close_items(purchase_order, items):
    po = _get_purchase_order(purchase_order)
    rows = _get_rows(po, items)

    for row in rows:
        if row.get(CLOSED_FIELD):
            frappe.throw(_("Row #{0}: Item {1} is already closed.").format(row.idx, row.item_code))
        _validate_can_close(row)

    now = now_datetime()
    for row in rows:
        row.db_set(_closed_values(row, now), update_modified=False)

    # Bump the parent's modified timestamp so a form opened before this change
    # cannot overwrite the closed flags with stale values.
    frappe.db.set_value("Purchase Order", po.name, "modified_by", frappe.session.user)
    _apply_changes(po, rows, [])
    po.notify_update()


@frappe.whitelist()
def reopen_items(purchase_order, items):
    po = _get_purchase_order(purchase_order)
    rows = _get_rows(po, items)

    for row in rows:
        if not row.get(CLOSED_FIELD):
            frappe.throw(_("Row #{0}: Item {1} is not closed.").format(row.idx, row.item_code))

    now = now_datetime()
    for row in rows:
        row.db_set(_reopened_values(now), update_modified=False)

    frappe.db.set_value("Purchase Order", po.name, "modified_by", frappe.session.user)
    _apply_changes(po, [], rows)
    po.notify_update()


# ── Close / Re-open by ticking "Item Closed" in the row and clicking Update ──

_CLOSE_FIELDS = (
    CLOSED_FIELD,
    "custom_closed_qty",
    "custom_closed_by",
    "custom_closed_on",
    "custom_reopened_by",
    "custom_reopened_on",
)


def validate_purchase_order(doc, method=None):
    """Purchase Order validate (draft saves): items can only be closed once submitted."""
    for row in doc.items:
        for field in _CLOSE_FIELDS:
            if row.get(field):
                row.set(field, None)


def before_purchase_order_update(doc, method=None):
    """Purchase Order before_update_after_submit: handle rows whose Item Closed checkbox changed."""
    before = doc.get_doc_before_save()
    if not before or not frappe.db.has_column("Purchase Order Item", CLOSED_FIELD):
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

        if not closed and not reopened:
            # Same permission as the popup / standard Close, not just write access.
            frappe.has_permission("Purchase Order", "submit", doc, throw=True)
            if before.status == "Closed":
                frappe.throw(_("Purchase Order {0} is Closed. Re-open the Purchase Order first.").format(doc.name))
            _validate_supported(doc)

        if is_closed:
            # Eligibility is checked on the saved row (Item Closed still unticked there).
            _validate_can_close(old or row)
            row.update(_closed_values(row, now))
            closed.append(row)
        else:
            row.update(_reopened_values(now))
            reopened.append(row)

    doc.flags.gme_item_close_changes = (closed, reopened)


def after_purchase_order_update(doc, method=None):
    """Purchase Order on_update_after_submit: ordered qty, timeline, auto close."""
    closed, reopened = doc.flags.pop("gme_item_close_changes", None) or ([], [])
    if _apply_changes(doc, closed, reopened):
        # The order was closed in the database; keep the returned form in sync.
        doc.status, doc.modified = frappe.db.get_value("Purchase Order", doc.name, ["status", "modified"])


# ── Automatic whole-order close ───────────────────────────────────────────────

def auto_close_if_done(purchase_order):
    """Run the standard Close when nothing is left: every row closed or received + billed."""
    if not frappe.db.exists("Purchase Order Item", {"parent": purchase_order, CLOSED_FIELD: 1}):
        return

    po = frappe.get_doc("Purchase Order", purchase_order)
    if po.docstatus != 1 or po.status in ("Closed", "On Hold", "Completed", "Delivered"):
        return

    if all(row.get(CLOSED_FIELD) or is_row_complete(row) for row in po.items):
        # Same calls as the standard whitelisted update_status("Closed", name).
        po.update_status("Closed")
        po.update_delivered_qty_in_sales_order()
        po.add_comment(
            "Info",
            _("Purchase Order closed automatically: every item is either closed or fully received and billed."),
        )
        return True
    return False


_PO_ITEM_LINK = {"Purchase Receipt": "purchase_order_item", "Purchase Invoice": "po_detail"}


def sync_closed_qty(doc, method=None):
    """
    Purchase Receipt / Purchase Invoice on_submit + on_cancel: keep Closed Qty equal to
    the unreceived qty of a closed row when its received qty moves afterwards — a return
    brings qty back, cancelling an earlier receipt does the same.
    """
    closed = get_closed_rows([row.get(_PO_ITEM_LINK[doc.doctype]) for row in doc.items])
    for po_item in closed:
        qty, received_qty = frappe.db.get_value("Purchase Order Item", po_item, ["qty", "received_qty"])
        frappe.db.set_value(
            "Purchase Order Item",
            po_item,
            "custom_closed_qty",
            max(flt(qty) - flt(received_qty), 0),
            update_modified=False,
        )


def auto_close_linked_purchase_orders(doc, method=None):
    """Purchase Receipt / Purchase Invoice on_submit."""
    if doc.get("is_return"):
        return

    for purchase_order in {row.get("purchase_order") for row in doc.items if row.get("purchase_order")}:
        auto_close_if_done(purchase_order)


# ── Blocking closed rows in downstream documents ──────────────────────────────

def _throw_if_closed_rows(doc, rows, link_field):
    closed = get_closed_rows([row.get(link_field) for row in rows])
    if not closed:
        return

    rows = [row for row in rows if row.get(link_field) in closed]
    frappe.throw(
        _("These rows are linked to closed Purchase Order items: {0}.<br>Re-open the item in the Purchase Order or remove the row.").format(
            _describe(rows)
        ),
        title=_("Purchase Order Item Closed"),
    )


def validate_purchase_receipt(doc, method=None):
    if not doc.is_return:
        _throw_if_closed_rows(doc, doc.items, "purchase_order_item")


def validate_purchase_invoice(doc, method=None):
    # Rows billed against a Purchase Receipt are allowed, as in the standard
    # Closed check (PurchaseInvoice.check_on_hold_or_closed_status).
    if not doc.is_return:
        _throw_if_closed_rows(doc, [row for row in doc.items if not row.purchase_receipt], "po_detail")


def remove_closed_rows(doc, link_field):
    """Drop rows mapped from closed Purchase Order items out of a freshly mapped document."""
    closed = get_closed_rows([row.get(link_field) for row in doc.items])
    if not closed:
        return []

    removed = [row for row in doc.items if row.get(link_field) in closed]
    doc.set("items", [row for row in doc.items if row.get(link_field) not in closed])
    if not doc.items:
        frappe.throw(_("All pending items of this Purchase Order are closed."), title=_("Purchase Order Item Closed"))

    for idx, row in enumerate(doc.items, start=1):
        row.idx = idx
    if doc.meta.has_field("payment_schedule"):
        doc.set("payment_schedule", [])
    doc.run_method("calculate_taxes_and_totals")

    frappe.msgprint(
        _("Closed Purchase Order items were skipped: {0}").format(", ".join(row.item_code for row in removed)),
        alert=True,
        indicator="orange",
    )
    return removed


# ── Whitelisted overrides ─────────────────────────────────────────────────────

def validate_closed_rows_unchanged(purchase_order, trans_items):
    """Update Items: closed rows cannot be changed or deleted (same as a closed order).

    Called from export.api.so_item_close.update_child_qty_rate, which overrides the
    standard method for both Sales and Purchase Orders.
    """
    if not frappe.db.has_column("Purchase Order Item", CLOSED_FIELD):
        return

    closed_rows = frappe.get_all(
        "Purchase Order Item",
        filters={"parent": purchase_order, "parenttype": "Purchase Order", CLOSED_FIELD: 1},
        fields=["name", "idx", "item_code", "qty", "rate", "uom", "conversion_factor", "schedule_date"],
    )
    if not closed_rows:
        return

    rate_precision = frappe.get_precision("Purchase Order Item", "rate")
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
            or (new.get("schedule_date") and getdate(new.get("schedule_date")) != getdate(row.schedule_date))
        )
        if changed:
            frappe.throw(
                _("Row #{0}: Item {1} is closed and cannot be changed or deleted. Re-open the item first.").format(
                    row.idx, row.item_code
                ),
                title=_("Purchase Order Item Closed"),
            )


@frappe.whitelist()
def make_purchase_receipt(source_name, target_doc=None, args=None):
    from erpnext.buying.doctype.purchase_order.purchase_order import make_purchase_receipt as standard

    doc = standard(source_name, target_doc, args)
    remove_closed_rows(doc, "purchase_order_item")
    return doc


@frappe.whitelist()
def make_purchase_invoice(source_name, target_doc=None, args=None):
    from erpnext.buying.doctype.purchase_order.purchase_order import make_purchase_invoice as standard

    doc = standard(source_name, target_doc, args)
    remove_closed_rows(doc, "po_detail")
    return doc
