import frappe


def before_save(doc, method):
    if doc.custom_item_description:
        doc.description = doc.custom_item_description


def bom_on_submit(doc, method):
    """When a BOM is submitted, sync its items into the linked Item's custom_sub_items."""
    item_doc = frappe.get_doc("Item", doc.item)

    item_doc.custom_sub_items = []
    for bom_item in (doc.items or []):
        item_doc.append("custom_sub_items", {
            "sub_item_code": bom_item.item_code,
            "sub_item_name": bom_item.item_name or "",
            "sub_description": frappe.utils.strip_html(bom_item.description or ""),
            "qty": bom_item.qty,
        })

    item_doc.save(ignore_permissions=True)
