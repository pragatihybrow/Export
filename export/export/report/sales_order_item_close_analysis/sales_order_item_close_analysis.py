# Copy of erpnext/selling/report/sales_order_analysis with item-level close
# details (export/api/so_item_close.py). The standard report is left untouched.
#
# Added columns: Item Status, Closed Qty, Net Order Qty, Net Qty to Deliver,
# Closed Amount, Net Pending Amount, Delivery Notes, Sales Invoices,
# Closed By / On, Re-opened By / On.

import copy
from collections import OrderedDict

import frappe
from frappe import _, qb
from frappe.query_builder import CustomFunction
from frappe.query_builder.functions import Max
from frappe.utils import date_diff, flt, getdate

ITEM_STATUSES = ["Open", "Closed"]


def execute(filters=None):
    if not filters:
        return [], [], None, []

    validate_filters(filters)

    columns = get_columns(filters)
    conditions = get_conditions(filters)
    data = get_data(conditions, filters)
    so_elapsed_time = get_so_elapsed_time(data)

    if not data:
        return [], [], None, []

    data, chart_data = prepare_data(data, so_elapsed_time, filters)

    return columns, data, None, chart_data


def validate_filters(filters):
    from_date, to_date = filters.get("from_date"), filters.get("to_date")

    if not from_date and to_date:
        frappe.throw(_("From and To Dates are required."))
    elif date_diff(to_date, from_date) < 0:
        frappe.throw(_("To Date cannot be before From Date."))


def get_conditions(filters):
    conditions = ""
    if filters.get("from_date") and filters.get("to_date"):
        conditions += " and so.transaction_date between %(from_date)s and %(to_date)s"

    if filters.get("company"):
        conditions += " and so.company = %(company)s"

    if filters.get("sales_order"):
        conditions += " and so.name in %(sales_order)s"

    if filters.get("status"):
        conditions += " and so.status in %(status)s"

    if filters.get("warehouse"):
        conditions += " and soi.warehouse = %(warehouse)s"

    return conditions


def get_data(conditions, filters):
    data = frappe.db.sql(
        f"""
        SELECT
            so.transaction_date as date,
            soi.delivery_date as delivery_date,
            so.name as sales_order,
            so.status, so.customer, soi.item_code,
            DATEDIFF(CURRENT_DATE, soi.delivery_date) as delay_days,
            IF(so.status in ('Completed','To Bill'), 0, (SELECT delay_days)) as delay,
            soi.qty, soi.delivered_qty,
            (soi.qty - soi.delivered_qty) AS pending_qty,
            IFNULL(SUM(sii.qty), 0) as billed_qty,
            soi.base_amount as amount,
            (soi.delivered_qty * soi.base_rate) as delivered_qty_amount,
            (soi.billed_amt * IFNULL(so.conversion_rate, 1)) as billed_amount,
            (soi.base_amount - (soi.billed_amt * IFNULL(so.conversion_rate, 1))) as pending_amount,
            soi.warehouse as warehouse,
            so.company, soi.name,
            soi.description as description,
            soi.base_rate, soi.rate, so.currency,
            soi.custom_item_closed as item_closed,
            soi.custom_closed_qty as closed_qty,
            soi.custom_closed_by as closed_by,
            soi.custom_closed_on as closed_on,
            soi.custom_reopened_by as reopened_by,
            soi.custom_reopened_on as reopened_on,
            GROUP_CONCAT(DISTINCT sii.parent ORDER BY sii.parent SEPARATOR ', ') as sales_invoices,
            (
                SELECT GROUP_CONCAT(DISTINCT dni.parent ORDER BY dni.parent SEPARATOR ', ')
                FROM `tabDelivery Note Item` dni
                WHERE dni.so_detail = soi.name and dni.docstatus = 1
            ) as delivery_notes
        FROM
            `tabSales Order` so,
            `tabSales Order Item` soi
        LEFT JOIN `tabSales Invoice Item` sii
            ON sii.so_detail = soi.name and sii.docstatus = 1
        WHERE
            soi.parent = so.name
            and so.status not in ('Stopped', 'On Hold')
            and so.docstatus = 1
            {conditions}
        GROUP BY soi.name
        ORDER BY so.transaction_date ASC, soi.item_code ASC
    """,
        filters,
        as_dict=1,
    )

    return data


def get_so_elapsed_time(data):
    """
    query SO's elapsed time till latest delivery note
    """
    so_elapsed_time = OrderedDict()
    if data:
        sales_orders = [x.sales_order for x in data]

        so = qb.DocType("Sales Order")
        soi = qb.DocType("Sales Order Item")
        dn = qb.DocType("Delivery Note")
        dni = qb.DocType("Delivery Note Item")

        to_seconds = CustomFunction("TO_SECONDS", ["date"])

        query = (
            qb.from_(so)
            .inner_join(soi)
            .on(soi.parent == so.name)
            .left_join(dni)
            .on(dni.so_detail == soi.name)
            .left_join(dn)
            .on(dni.parent == dn.name)
            .select(
                so.name.as_("sales_order"),
                soi.item_code.as_("so_item_code"),
                (to_seconds(Max(dn.posting_date)) - to_seconds(so.transaction_date)).as_("elapsed_seconds"),
            )
            .where((so.name.isin(sales_orders)) & (dn.docstatus == 1))
            .orderby(so.name, soi.name)
            .groupby(soi.name)
        )
        dn_elapsed_time = query.run(as_dict=True)

        for e in dn_elapsed_time:
            key = (e.sales_order, e.so_item_code)
            so_elapsed_time[key] = e.elapsed_seconds

    return so_elapsed_time


def set_item_close_details(row):
    """Item Status and the close-adjusted quantities / amounts for one Sales Order Item row."""
    item_closed = bool(row["item_closed"])
    closed_qty = flt(row["closed_qty"]) if item_closed else 0

    # Closed = the item or the whole order is closed; everything else is Open
    row["item_status"] = "Closed" if item_closed or row["status"] == "Closed" else "Open"

    row["closed_qty"] = closed_qty
    row["net_qty"] = flt(row["qty"]) - closed_qty
    row["net_pending_qty"] = 0 if item_closed else flt(row["pending_qty"])
    row["closed_amount"] = closed_qty * flt(row["base_rate"])
    row["net_pending_amount"] = max(flt(row["pending_amount"]) - row["closed_amount"], 0)


def prepare_data(data, so_elapsed_time, filters):
    completed, pending, closed = 0, 0, 0

    for row in data:
        set_item_close_details(row)

    if filters.get("item_status"):
        data = [row for row in data if row["item_status"] in filters.get("item_status")]

    if filters.get("group_by_so"):
        sales_order_map = {}

    for row in data:
        # sum data for chart
        completed += row["billed_amount"]
        pending += row["net_pending_amount"]
        closed += row["closed_amount"]

        # prepare data for report view
        row["qty_to_bill"] = flt(row["qty"]) - flt(row["billed_qty"])

        row["delay"] = 0 if row["delay"] and row["delay"] < 0 else row["delay"]

        row["time_taken_to_deliver"] = (
            so_elapsed_time.get((row.sales_order, row.item_code))
            if row["status"] in ("To Bill", "Completed")
            else 0
        )

        if filters.get("group_by_so"):
            so_name = row["sales_order"]

            if so_name not in sales_order_map:
                # create an entry
                row_copy = copy.deepcopy(row)
                sales_order_map[so_name] = row_copy
            else:
                # update existing entry
                so_row = sales_order_map[so_name]
                so_row["required_date"] = max(getdate(so_row["delivery_date"]), getdate(row["delivery_date"]))
                so_row["delay"] = (
                    min(so_row["delay"], row["delay"])
                    if row["delay"] and so_row["delay"]
                    else so_row["delay"]
                )

                # sum numeric columns
                fields = [
                    "qty",
                    "delivered_qty",
                    "pending_qty",
                    "billed_qty",
                    "qty_to_bill",
                    "amount",
                    "delivered_qty_amount",
                    "billed_amount",
                    "pending_amount",
                    "closed_qty",
                    "net_qty",
                    "net_pending_qty",
                    "closed_amount",
                    "net_pending_amount",
                ]
                for field in fields:
                    so_row[field] = flt(row[field]) + flt(so_row[field])

                # merge document references
                for field in ("delivery_notes", "sales_invoices"):
                    names = set(filter(None, (so_row[field] or "").split(", ") + (row[field] or "").split(", ")))
                    so_row[field] = ", ".join(sorted(names))

    chart_data = prepare_chart_data(pending, completed, closed)

    if filters.get("group_by_so"):
        data = []
        for so in sales_order_map:
            data.append(sales_order_map[so])
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
    group_by_so = filters.get("group_by_so")

    columns = [
        {"label": _("Date"), "fieldname": "date", "fieldtype": "Date", "width": 90},
        {
            "label": _("Sales Order"),
            "fieldname": "sales_order",
            "fieldtype": "Link",
            "options": "Sales Order",
            "width": 160,
        },
        {"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 130},
        {
            "label": _("Customer"),
            "fieldname": "customer",
            "fieldtype": "Link",
            "options": "Customer",
            "width": 130,
        },
    ]

    if not group_by_so:
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
                "label": _("Delivered Qty"),
                "fieldname": "delivered_qty",
                "fieldtype": "Float",
                "width": 120,
                "convertible": "qty",
            },
            {
                "label": _("Qty to Deliver"),
                "fieldname": "pending_qty",
                "fieldtype": "Float",
                "width": 120,
                "convertible": "qty",
            },
            {
                "label": _("Net Qty to Deliver"),
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
        ]
    )
    if not group_by_so:
        # Rate from the Sales Order item table, in the order's own currency (e.g. USD)
        columns.append(
            {
                "label": _("Rate (Order Currency)"),
                "fieldname": "rate",
                "fieldtype": "Currency",
                "width": 130,
                "options": "currency",
            }
        )
    columns.extend(
        [
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
                "label": _("Amount Delivered"),
                "fieldname": "delivered_qty_amount",
                "fieldtype": "Currency",
                "width": 100,
                "options": "Company:company:default_currency",
                "convertible": "rate",
            },
            {"label": _("Delivery Date"), "fieldname": "delivery_date", "fieldtype": "Date", "width": 120},
            {"label": _("Delay (in Days)"), "fieldname": "delay", "fieldtype": "Data", "width": 100},
            {
                "label": _("Time Taken to Deliver"),
                "fieldname": "time_taken_to_deliver",
                "fieldtype": "Duration",
                "width": 100,
            },
            {"label": _("Delivery Notes"), "fieldname": "delivery_notes", "fieldtype": "Data", "width": 180},
            {"label": _("Sales Invoices"), "fieldname": "sales_invoices", "fieldtype": "Data", "width": 180},
        ]
    )
    if not group_by_so:
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
                {
                    "label": _("Warehouse"),
                    "fieldname": "warehouse",
                    "fieldtype": "Link",
                    "options": "Warehouse",
                    "width": 100,
                },
            ]
        )
    columns.append(
        {
            "label": _("Company"),
            "fieldname": "company",
            "fieldtype": "Link",
            "options": "Company",
            "width": 100,
        }
    )

    return columns
