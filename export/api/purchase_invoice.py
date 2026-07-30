import frappe


def validate(doc, method=None):
    _validate_bill_no_unique(doc)
    _validate_credit_to_currency(doc)


def _validate_bill_no_unique(doc):
    """
    Prevent saving a Purchase Invoice whose bill_no already exists in another
    non-cancelled Purchase Invoice.

    Scope  : all suppliers, all dates (stricter than the ERPNext built-in check
             which is supplier+fiscal-year scoped and requires a settings flag).
    Skipped: blank bill_no, cancelled documents, the document itself.
    """
    bill_no = (doc.bill_no or "").strip()
    if not bill_no:
        return

    duplicate = frappe.db.get_value(
        "Purchase Invoice",
        {
            "bill_no":   bill_no,
            "name":      ("!=", doc.name),
            "docstatus": ("<", 2),          # 0=Draft, 1=Submitted — both count; 2=Cancelled is excluded
        },
        ["name", "supplier", "posting_date"],
        as_dict=True,
    )

    if duplicate:
        frappe.throw(
            frappe._(
                "Supplier Invoice No <b>{bill_no}</b> already exists in "
                "{link} (Supplier: {supplier}, Date: {date}). "
                "Duplicate bill_no entries are not allowed."
            ).format(
                bill_no=bill_no,
                link=frappe.utils.get_link_to_form("Purchase Invoice", duplicate.name),
                supplier=duplicate.supplier,
                date=frappe.utils.formatdate(duplicate.posting_date),
            ),
            title=frappe._("Duplicate Supplier Invoice No"),
        )


def _validate_credit_to_currency(doc):
    """
    Ensure the payable account selected in Credit To matches the invoice's
    transaction currency. Prevents postings like Creditors INR being used on
    a USD invoice, which silently misstates the supplier's ledger balance.
    """
    if not doc.credit_to or not doc.currency:
        return

    account_currency = frappe.get_cached_value("Account", doc.credit_to, "account_currency")
    if account_currency and account_currency != doc.currency:
        frappe.throw(
            frappe._(
                "Credit To account {account} is in {account_currency}, "
                "but this invoice's currency is {doc_currency}. "
                "Please select a Creditors account in {doc_currency}."
            ).format(
                account=frappe.bold(doc.credit_to),
                account_currency=frappe.bold(account_currency),
                doc_currency=frappe.bold(doc.currency),
            ),
            title=frappe._("Currency Mismatch"),
        )
