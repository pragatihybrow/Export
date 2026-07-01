import frappe


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
