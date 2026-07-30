import frappe


def validate(doc, method=None):
	_validate_debit_to_currency(doc)


def _validate_debit_to_currency(doc):
	"""
	Ensure the receivable account selected in Debit To matches the invoice's
	transaction currency. Prevents postings like Debtors INR being used on a
	USD invoice, which silently misstates the customer's ledger balance.
	"""
	if not doc.debit_to or not doc.currency:
		return

	account_currency = frappe.get_cached_value("Account", doc.debit_to, "account_currency")
	if account_currency and account_currency != doc.currency:
		frappe.throw(
			frappe._(
				"Debit To account {account} is in {account_currency}, "
				"but this invoice's currency is {doc_currency}. "
				"Please select a Debtors account in {doc_currency}."
			).format(
				account=frappe.bold(doc.debit_to),
				account_currency=frappe.bold(account_currency),
				doc_currency=frappe.bold(doc.currency),
			),
			title=frappe._("Currency Mismatch"),
		)


def round_sales_invoice_gl_amounts(doc, method=None):
	"""
	ERPNext sometimes posts Rounded Off GL entries with floating-point residues
	(e.g. debit_in_account_currency = 0.009999998 instead of 0.01) due to
	binary float representation of small decimal values.
	Round all GL rows for this Sales Invoice to 2 decimal places after core
	on_submit has written them.
	"""
	frappe.db.sql("""
		UPDATE `tabGL Entry`
		SET
			debit                      = ROUND(debit, 2),
			credit                     = ROUND(credit, 2),
			debit_in_account_currency  = ROUND(debit_in_account_currency, 2),
			credit_in_account_currency = ROUND(credit_in_account_currency, 2)
		WHERE voucher_type = 'Sales Invoice'
		AND voucher_no = %s
		AND is_cancelled = 0
	""", doc.name)
