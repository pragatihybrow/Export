import frappe
from erpnext.selling.doctype.sales_order.sales_order import (
    make_sales_invoice,
    make_delivery_note,
)

from export.api.so_item_close import remove_closed_rows


# ── Module-level field lists ──────────────────────────────────────────────────

# Parent-level fields copied SO → Sales Invoice for Export orders.
_SO_EXPORT_PARENT_FIELDS = [
    "custom_total_amount",
    "custom_total_company_currency",
    "custom_cif_total_amount_",
    "custom_cif_total_amount_company_currency",
    "custom_mode",
    "custom_loading_port",
    "custom_loading_port_code",
    "custom_discharge_port",
    "custom_discharge_port_code",
    "custom_final_destination",
    "custom_shipping_mark",
    "custom_the_state_of_origin_of_goods",
    "custom_district_of_origin_of_goods",
    "custom_we_intend_to_claim_benefit_under_rodtep_scheme",
    "custom_export_under_advance_license",
    "custom_details_of_preferential_agreements",
]

# Item-level CIF fields copied SO Item → Sales Invoice Item for Export orders.
_SO_EXPORT_ITEM_FIELDS = [
    "custom_duty_drawback",
    "custom_net_weight",
    "custom_freight__insurance_",
    "custom_cif_unit_price",
    "custom__cif_total_amount",
    "custom_cif_unit_price_",
    "custom___cif_total_amount",
]

# Fields copied from each SO Sub Item row → Delivery Note / Sales Invoice Sub Item row.
_SUB_ITEM_FIELDS = [
    "parent_item",
    "parent_item_name",
    "sub_item_code",
    "sub_item_name",
    "sub_description",
    "qty",
    "custom_net_weight",
    "base_rate",
    "rate",
    "amount",
    "custom_freight__insurance_",
    "custom_cif_unit_price",
    "custom__cif_total_amount",
    "custom_cif_unit_price_",
    "custom___cif_total_amount",
]

# Field remap for SO Sub Item → Sales Invoice Sub Item (different fieldnames).
# Key: SO Sub Item fieldname  →  Value: SI Sub Item fieldname
_SI_SUB_ITEM_REMAP = {
    "custom_duty_drawback": "duty_drawback",
}


# ── Private helpers ───────────────────────────────────────────────────────────

def _reset_weight_per_unit(doc):
    """
    Overwrite weight_per_unit on every item row with the current Item master value.

    get_mapped_doc inherits weight_per_unit from the source document, but the
    Item master is always authoritative for per-unit weight.
    """
    item_codes = list({item.item_code for item in doc.items if item.item_code})
    if not item_codes:
        return

    weight_map = {
        r.name: r.weight_per_unit
        for r in frappe.get_all(
            "Item",
            filters={"name": ["in", item_codes]},
            fields=["name", "weight_per_unit"],
        )
    }
    for item in doc.items:
        if item.item_code in weight_map:
            item.weight_per_unit = weight_map[item.item_code]


def _carry_forward_so_sub_items(so, doc, field_remap=None):
    """
    Append SO custom_sub_items rows into the target doc's custom_sub_items table
    for every parent SO item that was mapped into the target doc.

    Linkage key
    -----------
    SO Sub Item.parent_row_uid  ==  SO Item.custom_row_uid  ==  doc Item.custom_row_uid
    custom_row_uid is auto-copied SO Item → doc Item by get_mapped_doc (no_copy = 0).

    NULL parent_row_uid (legacy data)
    ----------------------------------
    SO items created before UID tracking was active have custom_row_uid = NULL, so
    their sub items carry parent_row_uid = NULL as well.  These rows are carried
    forward as "orphaned" sub items (parent_row_uid stays NULL on the target side),
    which matches the behaviour of the legacy JS carry_forward_sub_items fallback.

    Duplicate prevention
    --------------------
    The dedup key is (parent_row_uid, sub_item_code).  NULL is preserved so that
    re-running "Get Items From" on the same SO correctly skips both linked and
    orphaned rows without adding duplicates.

    field_remap
    -----------
    Optional dict mapping SO Sub Item fieldname → target Sub Item fieldname for
    fields whose names differ between doctypes (e.g. custom_duty_drawback → duty_drawback
    for Sales Invoice Sub Items).
    """
    if not so.get("custom_sub_items"):
        return

    # Build lookup: SO item custom_row_uid → matching target item row.
    # NULL keys are excluded here; the NULL path is handled explicitly below.
    custom_uid_to_item = {
        item.custom_row_uid: item
        for item in doc.items
        if item.custom_row_uid
    }

    # Build customer_item_code lookup from Item Customer Detail.
    sub_item_codes = list({s.sub_item_code for s in so.custom_sub_items if s.sub_item_code})
    customer_item_map = {}
    if sub_item_codes and so.customer:
        rows = frappe.get_all(
            "Item Customer Detail",
            filters={"parent": ["in", sub_item_codes], "customer_name": so.customer},
            fields=["parent", "ref_code"],
        )
        customer_item_map = {r.parent: r.ref_code for r in rows}

    # Snapshot of (parent_row_uid, sub_item_code) pairs already in the doc.
    existing = {
        (row.parent_row_uid, row.sub_item_code)
        for row in (doc.get("custom_sub_items") or [])
    }

    for so_sub in so.custom_sub_items:
        if so_sub.parent_row_uid:
            # Linked sub item: find the target item via its copied custom_row_uid.
            target_item = custom_uid_to_item.get(so_sub.parent_row_uid)
            if not target_item:
                # The parent SO item was not selected / not mapped into this doc.
                continue
            parent_uid_for_target = target_item.custom_row_uid
        else:
            # Orphaned sub item — parent SO item had no custom_row_uid.
            # Carry forward with NULL parent_row_uid (same as old JS behaviour).
            parent_uid_for_target = None

        if (parent_uid_for_target, so_sub.sub_item_code) in existing:
            # Already present — skip to prevent duplication on re-fetch.
            continue

        sub = frappe._dict({field: so_sub.get(field) for field in _SUB_ITEM_FIELDS})
        sub["parent_row_uid"] = parent_uid_for_target
        sub["customer_item_code"] = customer_item_map.get(so_sub.sub_item_code) or None
        sub["custom_customer_po_no"] = so.po_no or None

        # Apply any fieldname remaps (e.g. custom_duty_drawback → duty_drawback for SI).
        if field_remap:
            for src_field, dst_field in field_remap.items():
                sub[dst_field] = so_sub.get(src_field)

        doc.append("custom_sub_items", sub)


# ── Whitelisted entry points ──────────────────────────────────────────────────

@frappe.whitelist()
def make_sales_invoice_custom(source_name, target_doc=None, ignore_permissions=False, args=None):
    """
    SO → Sales Invoice: carry forward export fields and reset item weights.

    Registered in hooks.py as the override for
    erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice.

    """
    if isinstance(ignore_permissions, dict):
        args = ignore_permissions
        ignore_permissions = False

    doc = make_sales_invoice(source_name, target_doc=target_doc, ignore_permissions=ignore_permissions, args=args)
    # Item-closed SO rows cannot be invoiced (see export/api/so_item_close.py).
    remove_closed_rows(doc, "so_detail")

    so = frappe.get_doc("Sales Order", source_name)
    doc.custom_order_type = so.order_type

    if so.order_type == "Export":
        # Carry forward parent-level export header fields.
        for field in _SO_EXPORT_PARENT_FIELDS:
            if hasattr(so, field):
                setattr(doc, field, getattr(so, field))

        # Carry forward item-level CIF fields; match by SO Item name via so_detail.
        so_item_map = {row.name: row for row in so.items}
        for si_item in doc.items:
            so_item = so_item_map.get(si_item.so_detail)
            if not so_item:
                continue
            for field in _SO_EXPORT_ITEM_FIELDS:
                if hasattr(so_item, field):
                    setattr(si_item, field, getattr(so_item, field))

    # Carry forward customer_order_number row-wise — only to items linked to this SO.
    # Guard prevents overwriting PO numbers of items from other SOs already in the doc.
    if so.po_no:
        for si_item in doc.items:
            if si_item.sales_order == so.name:
                si_item.custom_customer_order_number = so.po_no

    _reset_weight_per_unit(doc)
    _carry_forward_so_sub_items(so, doc, field_remap=_SI_SUB_ITEM_REMAP)
    return doc


@frappe.whitelist()
def make_delivery_note_custom(source_name, target_doc=None, ignore_permissions=False):
    """
    SO → Delivery Note: carry forward order type + sub items, reset item weights.

    Registered in hooks.py as the override for
    erpnext.selling.doctype.sales_order.sales_order.make_delivery_note.

    Called by both:
      • Direct creation  — SO form → Create → Delivery Note  (target_doc=None)
      • Get Items From   — button inside an existing DN       (target_doc=existing DN JSON)

    In both cases frappe.model.mapper.map_docs routes here via
    override_whitelisted_methods, so the sub-item carry-forward always runs.

    Note: the third positional parameter is named ignore_permissions for signature
    compatibility, but map_docs passes frappe args (e.g. {filtered_children: [...]})
    in that slot.  It is forwarded as-is to the base make_delivery_note which
    accepts it as its own `kwargs` parameter.
    """
    doc = make_delivery_note(source_name, target_doc, ignore_permissions)
    # Item-closed SO rows cannot be delivered (see export/api/so_item_close.py).
    # Removed before the sub-item carry-forward so their KIT sub items are skipped too.
    remove_closed_rows(doc, "so_detail")

    so = frappe.get_doc("Sales Order", source_name)
    doc.custom_order_type = so.order_type

    _reset_weight_per_unit(doc)
    _carry_forward_so_sub_items(so, doc)

    return doc
