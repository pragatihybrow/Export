# Copy of erpnext/buying/report/purchase_order_analysis with item-level close
# details (export/api/po_item_close.py). The standard report is left untouched.
#
# Added columns: Item Status, Closed Qty, Net Order Qty, Net Qty to Receive,
# Closed Amount, Net Pending Amount, Purchase Receipts, Purchase Invoices,
# Closed By / On, Re-opened By / On.

import copy
from collections import defaultdict

import frappe
from frappe import _
from frappe.query_builder.functions import IfNull, Sum
from frappe.utils import date_diff, flt, getdate

ITEM_STATUSES = ["Open", "Closed"]


def execute(filters=None):
    if not filters:
        return [], []

    validate_filters(filters)

    columns = get_columns(filters)
    data = get_data(filters)

    if not data:
        return [], [], None, []

    update_received_amount(data)
    update_linked_documents(data)

    data, chart_data = prepare_data(data, filters)

    return columns, data, None, chart_data


def validate_filters(filters):
    from_date, to_date = filters.get("from_date"), filters.get("to_date")

    if not from_date and to_date:
        frappe.throw(_("From and To Dates are required."))
    elif date_diff(to_date, from_date) < 0:
        frappe.throw(_("To Date cannot be before From Date."))


def get_data(filters):
    po = frappe.qb.DocType("Purchase Order")
    po_item = frappe.qb.DocType("Purchase Order Item")
    pi_item = frappe.qb.DocType("Purchase Invoice Item")

    query = (
        frappe.qb.from_(po)
        .inner_join(po_item)
        .on(po_item.parent == po.name)
        .left_join(pi_item)
        .on((pi_item.po_detail == po_item.name) & (pi_item.docstatus == 1))
        .select(
            po.transaction_date.as_("date"),
            po_item.schedule_date.as_("required_date"),
            po_item.project,
            po.name.as_("purchase_order"),
            po.status,
            po.supplier,
            po_item.item_code,
            po_item.description,
            po_item.qty,
            po_item.received_qty,
            (po_item.qty - po_item.received_qty).as_("pending_qty"),
            Sum(IfNull(pi_item.qty, 0)).as_("billed_qty"),
            po_item.base_amount.as_("amount"),
            (po_item.billed_amt * IfNull(po.conversion_rate, 1)).as_("billed_amount"),
            (po_item.base_amount - (po_item.billed_amt * IfNull(po.conversion_rate, 1))).as_(
                "pending_amount"
            ),
            po.set_warehouse.as_("warehouse"),
            po.company,
            po_item.name,
            po_item.base_rate,
            po_item.custom_item_closed.as_("item_closed"),
            po_item.custom_closed_qty.as_("closed_qty"),
            po_item.custom_closed_by.as_("closed_by"),
            po_item.custom_closed_on.as_("closed_on"),
            po_item.custom_reopened_by.as_("reopened_by"),
            po_item.custom_reopened_on.as_("reopened_on"),
        )
        .where((po_item.parent == po.name) & (po.status.notin(("Stopped", "On Hold"))) & (po.docstatus == 1))
        .groupby(po_item.name)
        .orderby(po.transaction_date)
    )

    if filters.get("company"):
        query = query.where(po.company == filters.get("company"))

    if filters.get("name"):
        query = query.where(po.name.isin(filters.get("name")))

    if filters.get("from_date") and filters.get("to_date"):
        query = query.where(po.transaction_date.between(filters.get("from_date"), filters.get("to_date")))

    if filters.get("status"):
        query = query.where(po.status.isin(filters.get("status")))

    if filters.get("project"):
        query = query.where(po_item.project == filters.get("project"))

    data = query.run(as_dict=True)

    return data


def update_received_amount(data):
    pr_data = get_received_amount_data(data)

    for row in data:
        row.received_qty_amount = flt(pr_data.get(row.name))


def get_received_amount_data(data):
    pr = frappe.qb.DocType("Purchase Receipt")
    pr_item = frappe.qb.DocType("Purchase Receipt Item")

    po_items = [row.name for row in data]

    if not po_items:
        return frappe._dict()

    query = (
        frappe.qb.from_(pr)
        .inner_join(pr_item)
        .on(pr_item.parent == pr.name)
        .select(
            pr_item.purchase_order_item,
            Sum(pr_item.base_amount).as_("received_qty_amount"),
        )
        .where((pr.docstatus == 1) & (pr_item.purchase_order_item.isin(po_items)))
        .groupby(pr_item.purchase_order_item)
    )

    data = query.run()

    if not data:
        return frappe._dict()

    return frappe._dict(data)


def update_linked_documents(data):
    """Submitted Purchase Receipts / Purchase Invoices per Purchase Order Item row."""
    po_items = [row.name for row in data]
    linked = {
        "purchase_receipts": ("Purchase Receipt Item", "purchase_order_item"),
        "purchase_invoices": ("Purchase Invoice Item", "po_detail"),
    }

    for field, (doctype, link_field) in linked.items():
        names = defaultdict(set)
        for d in frappe.get_all(
            doctype,
            filters={link_field: ["in", po_items], "docstatus": 1},
            fields=["parent", link_field],
        ):
            names[d[link_field]].add(d.parent)

        for row in data:
            row[field] = ", ".join(sorted(names.get(row.name, ())))


def set_item_close_details(row):
    """Item Status and the close-adjusted quantities / amounts for one Purchase Order Item row."""
    item_closed = bool(row["item_closed"])
    closed_qty = flt(row["closed_qty"]) if item_closed else 0

    # Closed = the item or the whole order is closed; everything else is Open
    row["item_status"] = "Closed" if item_closed or row["status"] == "Closed" else "Open"

    row["closed_qty"] = closed_qty
    row["net_qty"] = flt(row["qty"]) - closed_qty
    row["net_pending_qty"] = 0 if item_closed else flt(row["pending_qty"])
    row["closed_amount"] = closed_qty * flt(row["base_rate"])
    row["net_pending_amount"] = max(flt(row["pending_amount"]) - row["closed_amount"], 0)


def prepare_data(data, filters):
    completed, pending, closed = 0, 0, 0
    pending_field = "net_pending_amount"
    completed_field = "billed_amount"

    for row in data:
        set_item_close_details(row)

    if filters.get("item_status"):
        data = [row for row in data if row["item_status"] in filters.get("item_status")]

    if filters.get("group_by_po"):
        purchase_order_map = {}

    for row in data:
        # sum data for chart
        completed += row[completed_field]
        pending += row[pending_field]
        closed += row["closed_amount"]

        # prepare data for report view
        row["qty_to_bill"] = flt(row["qty"]) - flt(row["billed_qty"])

        if filters.get("group_by_po"):
            po_name = row["purchase_order"]

            if po_name not in purchase_order_map:
                # create an entry
                row_copy = copy.deepcopy(row)
                purchase_order_map[po_name] = row_copy
            else:
                # update existing entry
                po_row = purchase_order_map[po_name]
                po_row["required_date"] = min(getdate(po_row["required_date"]), getdate(row["required_date"]))

                # sum numeric columns
                fields = [
                    "qty",
                    "received_qty",
                    "pending_qty",
                    "billed_qty",
                    "qty_to_bill",
                    "amount",
                    "received_qty_amount",
                    "billed_amount",
                    "pending_amount",
                    "closed_qty",
                    "net_qty",
                    "net_pending_qty",
                    "closed_amount",
                    "net_pending_amount",
                ]
                for field in fields:
                    po_row[field] = flt(row[field]) + flt(po_row[field])

                # merge document references
                for field in ("purchase_receipts", "purchase_invoices"):
                    names = set(filter(None, (po_row[field] or "").split(", ") + (row[field] or "").split(", ")))
                    po_row[field] = ", ".join(sorted(names))

    chart_data = prepare_chart_data(pending, completed, closed)

    if filters.get("group_by_po"):
        data = []
        for po in purchase_order_map:
            data.append(purchase_order_map[po])
        return data, chart_data

    return data, chart_data


def prepare_chart_data(pending, completed, closed):
    labels = [_("Amount to Bill"), _("Billed Amount"), _("Closed Amount")]

    return {
        "data": {"labels": labels, "datasets": [{"values": [pending, completed, closed]}]},
        "type": "donut",
        "height": 300,
    }


def get_columns(filters):
    group_by_po = filters.get("group_by_po")

    columns = [
        {"label": _("Date"), "fieldname": "date", "fieldtype": "Date", "width": 90},
        {"label": _("Required By"), "fieldname": "required_date", "fieldtype": "Date", "width": 90},
        {
            "label": _("Purchase Order"),
            "fieldname": "purchase_order",
            "fieldtype": "Link",
            "options": "Purchase Order",
            "width": 160,
        },
        {"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 130},
        {
            "label": _("Supplier"),
            "fieldname": "supplier",
            "fieldtype": "Link",
            "options": "Supplier",
            "width": 130,
        },
        {
            "label": _("Project"),
            "fieldname": "project",
            "fieldtype": "Link",
            "options": "Project",
            "width": 130,
        },
    ]

    if not group_by_po:
        columns.append(
            {
                "label": _("Item Code"),
                "fieldname": "item_code",
                "fieldtype": "Link",
                "options": "Item",
                "width": 100,
            }
        )
        columns.append(
            {"label": _("Description"), "fieldname": "description", "fieldtype": "Small Text", "width": 100}
        )
        columns.append({"label": _("Item Status"), "fieldname": "item_status", "fieldtype": "Data", "width": 110})

    columns.extend(
        [
            {
                "label": _("Qty"),
                "fieldname": "qty",
                "fieldtype": "Float",
                "width": 120,
                "convertible": "qty",
            },
            {
                "label": _("Closed Qty"),
                "fieldname": "closed_qty",
                "fieldtype": "Float",
                "width": 100,
                "convertible": "qty",
            },
            {
                "label": _("Net Order Qty"),
                "fieldname": "net_qty",
                "fieldtype": "Float",
                "width": 110,
                "convertible": "qty",
            },
            {
                "label": _("Received Qty"),
                "fieldname": "received_qty",
                "fieldtype": "Float",
                "width": 120,
                "convertible": "qty",
            },
            {
                "label": _("Pending Qty"),
                "fieldname": "pending_qty",
                "fieldtype": "Float",
                "width": 80,
                "convertible": "qty",
            },
            {
                "label": _("Net Qty to Receive"),
                "fieldname": "net_pending_qty",
                "fieldtype": "Float",
                "width": 130,
                "convertible": "qty",
            },
            {
                "label": _("Billed Qty"),
                "fieldname": "billed_qty",
                "fieldtype": "Float",
                "width": 80,
                "convertible": "qty",
            },
            {
                "label": _("Qty to Bill"),
                "fieldname": "qty_to_bill",
                "fieldtype": "Float",
                "width": 80,
                "convertible": "qty",
            },
            {
                "label": _("Amount"),
                "fieldname": "amount",
                "fieldtype": "Currency",
                "width": 110,
                "options": "Company:company:default_currency",
                "convertible": "rate",
            },
            {
                "label": _("Billed Amount"),
                "fieldname": "billed_amount",
                "fieldtype": "Currency",
                "width": 110,
                "options": "Company:company:default_currency",
                "convertible": "rate",
            },
            {
                "label": _("Pending Amount"),
                "fieldname": "pending_amount",
                "fieldtype": "Currency",
                "width": 130,
                "options": "Company:company:default_currency",
                "convertible": "rate",
            },
            {
                "label": _("Closed Amount"),
                "fieldname": "closed_amount",
                "fieldtype": "Currency",
                "width": 120,
                "options": "Company:company:default_currency",
                "convertible": "rate",
            },
            {
                "label": _("Net Pending Amount"),
                "fieldname": "net_pending_amount",
                "fieldtype": "Currency",
                "width": 140,
                "options": "Company:company:default_currency",
                "convertible": "rate",
            },
            {
                "label": _("Received Qty Amount"),
                "fieldname": "received_qty_amount",
                "fieldtype": "Currency",
                "width": 130,
                "options": "Company:company:default_currency",
                "convertible": "rate",
            },
            {"label": _("Purchase Receipts"), "fieldname": "purchase_receipts", "fieldtype": "Data", "width": 180},
            {"label": _("Purchase Invoices"), "fieldname": "purchase_invoices", "fieldtype": "Data", "width": 180},
        ]
    )
    if not group_by_po:
        columns.extend(
            [
                {
                    "label": _("Closed By"),
                    "fieldname": "closed_by",
                    "fieldtype": "Link",
                    "options": "User",
                    "width": 140,
                },
                {"label": _("Closed On"), "fieldname": "closed_on", "fieldtype": "Datetime", "width": 150},
                {
                    "label": _("Re-opened By"),
                    "fieldname": "reopened_by",
                    "fieldtype": "Link",
                    "options": "User",
                    "width": 140,
                },
                {"label": _("Re-opened On"), "fieldname": "reopened_on", "fieldtype": "Datetime", "width": 150},
            ]
        )
    columns.extend(
        [
            {
                "label": _("Warehouse"),
                "fieldname": "warehouse",
                "fieldtype": "Link",
                "options": "Warehouse",
                "width": 100,
            },
            {
                "label": _("Company"),
                "fieldname": "company",
                "fieldtype": "Link",
                "options": "Company",
                "width": 100,
            },
        ]
    )

    return columns
