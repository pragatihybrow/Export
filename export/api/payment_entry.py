import frappe


def round_payment_entry_gl_amounts(doc, method=None):
	"""
	ERPNext computes Payment Entry GL amounts via USD * exchange_rate multiplication
	which produces floating-point residues (e.g. 16992.499986817 instead of 16992.50).
	Round all GL rows for this Payment Entry to 2 decimal places after core on_submit
	has already written them.
	"""
	frappe.db.sql("""
		UPDATE `tabGL Entry`
		SET
			debit                      = ROUND(debit, 2),
			credit                     = ROUND(credit, 2),
			debit_in_account_currency  = ROUND(debit_in_account_currency, 2),
			credit_in_account_currency = ROUND(credit_in_account_currency, 2)
		WHERE voucher_type = 'Payment Entry'
		AND voucher_no = %s
		AND is_cancelled = 0
	""", doc.name)
