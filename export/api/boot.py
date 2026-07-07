import frappe


def add_bank_account_numbers(bootinfo):
	"""
	Expose Bank Account -> account number mapping on frappe.boot so print
	formats (e.g. the General Ledger bank statement format) can show the
	account number for whichever GL account is selected, without an extra
	server round trip at print time.
	"""
	bootinfo.bank_account_numbers = frappe._dict(
		frappe.get_all(
			"Bank Account",
			filters={"account": ["is", "set"]},
			fields=["account", "bank_account_no"],
			as_list=1,
		)
	)
