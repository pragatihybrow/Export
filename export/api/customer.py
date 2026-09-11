import frappe

ID_PREFIX = "C"
ID_START = 1001


def set_customer_id_no(doc, method):
    """Auto-populate the read-only Customer ID No (C1001, C1002, ...) on creation."""
    if doc.custom_customer_id_no:
        return

    doc.custom_customer_id_no = get_next_customer_id_no()


def get_next_customer_id_no():
    last_number = frappe.db.sql(
        """
        select max(cast(substring(custom_customer_id_no, %s) as unsigned))
        from `tabCustomer`
        where custom_customer_id_no like %s
        """,
        (len(ID_PREFIX) + 1, f"{ID_PREFIX}%"),
    )[0][0]

    next_number = (last_number or (ID_START - 1)) + 1
    return f"{ID_PREFIX}{next_number}"
