import frappe
from frappe.utils import flt


def ensure_kit_row_uids(doc, items_field="items", sub_items_field="custom_sub_items"):
    """
    Ensure every KIT item row (an item_code with rows in Item Sub Items) is
    correctly linked to its own sub-item breakdown via custom_row_uid.

    custom_row_uid is normally generated only inside the item_code field's
    change-event handler in the browser (sales_order.js / delivery_note.js /
    packing_slip.js). Any row created another way — "Get Items From" run more
    than once, a bulk/template import, a duplicated grid row — never fires that
    event, so the row is left with custom_row_uid = NULL. Worse, when the same
    KIT item appears in several rows, older data can end up with all of their
    sub-items lumped under one shared uid instead of one group per row.

    For each item_code that has more than one row on this document, this:
      1. Leaves any row alone whose custom_row_uid is unique among that item's
         rows and already owns exactly one full sub-item group — nothing to do.
      2. For the rest, looks at the "leftover" sub-item rows for that item_code
         (anything not already cleanly claimed in step 1). If the leftover count
         divides evenly into whole groups matching the number of still-unlinked
         rows, it SPLITS them by document order and re-points each group's
         parent_row_uid at one specific row — preserving whatever weight/box/
         dimension data was already filled in on those rows, rather than
         discarding it.
      3. Only when a row has no leftover group at all to claim does it generate
         a brand-new group from the Item master's KIT definition (blank
         weight/box/dimension fields, qty scaled by the row's own qty) — this is
         the normal, non-ambiguous case for a genuinely new row.
      4. If the leftovers can't be split evenly (an ambiguous case that would
         require guessing), nothing is touched for that item_code and it's
         reported back for manual review instead of risking a wrong assignment.

    Calling this from a validate hook makes every row self-healing on save,
    regardless of how it was created. Idempotent — safe to call on every save.

    Returns {"changed": bool, "review": [...]} — "review" lists any item_code
    groups that could not be confidently auto-repaired.
    """
    items = doc.get(items_field) or []
    if not items:
        return {"changed": False, "review": []}

    rows_by_item_code = {}
    for row in items:
        if row.item_code:
            rows_by_item_code.setdefault(row.item_code, []).append(row)

    if not rows_by_item_code:
        return {"changed": False, "review": []}

    kit_defs = {}
    for def_row in frappe.get_all(
        "Item Sub Items",
        filters={"parent": ["in", list(rows_by_item_code.keys())]},
        fields=["parent", "sub_item_code", "sub_item_name", "sub_description", "qty"],
        order_by="parent, idx",
    ):
        kit_defs.setdefault(def_row.parent, []).append(def_row)

    if not kit_defs:
        return {"changed": False, "review": []}

    sub_items = doc.get(sub_items_field) or []

    changed = False
    review = []

    for item_code, rows in rows_by_item_code.items():
        defs = kit_defs.get(item_code)
        if not defs:
            continue  # not a KIT item

        chunk_size = len(defs)
        rows_sorted = sorted(rows, key=lambda r: r.idx)

        code_sub_items = [s for s in sub_items if (s.parent_item or "").strip() == item_code]
        by_uid = {}
        for s in code_sub_items:
            by_uid.setdefault(s.parent_row_uid, []).append(s)

        uid_usage_count = {}
        for r in rows_sorted:
            u = r.get("custom_row_uid")
            if u:
                uid_usage_count[u] = uid_usage_count.get(u, 0) + 1

        # A row is "resolved" if its uid is used by exactly one row for this
        # item_code AND that uid already owns exactly one full sub-item group.
        resolved_names = set()
        resolved_uids = set()
        for r in rows_sorted:
            u = r.get("custom_row_uid")
            if u and uid_usage_count.get(u) == 1 and len(by_uid.get(u, [])) == chunk_size:
                resolved_names.add(r.name)
                resolved_uids.add(u)

        unresolved_rows = [r for r in rows_sorted if r.name not in resolved_names]
        if not unresolved_rows:
            continue

        leftover = sorted(
            (s for s in code_sub_items if s.parent_row_uid not in resolved_uids),
            key=lambda s: s.idx,
        )

        if leftover and len(leftover) == chunk_size * len(unresolved_rows):
            # Clean split: reassign each existing chunk to one row, in document
            # order, preserving every field already on those sub-item rows.
            for i, row in enumerate(unresolved_rows):
                chunk = leftover[i * chunk_size:(i + 1) * chunk_size]
                uid = row.get("custom_row_uid") or row.name
                row.custom_row_uid = uid
                for s in chunk:
                    s.parent_row_uid = uid
                changed = True

        elif leftover:
            # Can't confidently split without guessing — leave it and report.
            review.append({
                "item_code": item_code,
                "unresolved_row_count": len(unresolved_rows),
                "leftover_sub_item_count": len(leftover),
                "chunk_size": chunk_size,
            })

        else:
            # Genuinely nothing to claim — this row has no KIT breakdown at
            # all yet, so generate a fresh one from the Item master.
            for row in unresolved_rows:
                uid = row.get("custom_row_uid") or row.name
                row.custom_row_uid = uid
                for sub_def in defs:
                    new_sub = doc.append(sub_items_field, {})
                    new_sub.parent_row_uid = uid
                    new_sub.parent_item = item_code
                    new_sub.parent_item_name = row.get("item_name")
                    new_sub.sub_item_code = sub_def.sub_item_code
                    new_sub.sub_item_name = sub_def.sub_item_name
                    new_sub.sub_description = sub_def.sub_description
                    new_sub.qty = flt(sub_def.qty) * (flt(row.qty) or 1)
                changed = True

    return {"changed": changed, "review": review}


def validate_kit_row_uids(doc, method=None):
    """doc_events entry point — see ensure_kit_row_uids()."""
    result = ensure_kit_row_uids(doc)
    if result["review"]:
        frappe.log_error(
            title="KIT sub-items need manual review",
            message=frappe.as_json({
                "doctype": doc.doctype,
                "name": doc.name,
                "review": result["review"],
            }),
        )


def sync_sub_item_return_sign(doc, method=None, sub_items_field="custom_sub_items"):
    """
    Keep custom_sub_items qty sign consistent with the parent document's
    return direction (doc.is_return).

    When a Credit/Debit Note (or a return Delivery Note/Purchase Receipt) is
    created from a normal document, core ERPNext (get_mapped_doc /
    make_return_doc) only knows how to negate qty on its own "Item" child
    table (and Packed Item) — it has no awareness of this app's custom
    custom_sub_items table, so those rows keep whatever sign they had on the
    source document. That mismatch (parent items negative, sub-items still
    positive) then reaches erpnext.controllers.status_updater.validate_qty,
    which walks every child table row with a "qty" field: it raises "quantity
    must be negative/positive", formatting the message with d.item_code — a
    field this sub-item doctype doesn't have (it has sub_item_code instead),
    turning what should be a normal validation message into an
    AttributeError that crashes the save.

    Hooked on "before_validate" (fires before the core validate() call that
    does this check — see frappe.model.document.Document._validate) so the
    sign is already correct by the time that check runs, instead of trying
    to patch it from a "validate" hook, which runs too late.
    """
    is_return = bool(doc.get("is_return"))
    for row in doc.get(sub_items_field) or []:
        qty = flt(row.qty)
        if is_return and qty > 0:
            row.qty = -qty
        elif not is_return and qty < 0:
            row.qty = -qty
