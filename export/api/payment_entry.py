import frappe
from frappe.utils import flt


def validate(doc, method=None):
	_apply_exchange_gain_loss_split(doc)


def _apply_exchange_gain_loss_split(doc):
	"""
	Core ERPNext always forces the row flagged `is_exchange_gain_loss` to the
	FULL Paid/Received difference on every save (payment_entry.py:
	set_exchange_gain_loss), which makes it impossible to split that
	difference across more than one account directly in this table.

	This lets the user add extra deduction rows checked as "Split of
	Exchange Gain/Loss" (custom_split_of_exchange_gain_loss). Whatever they
	put in those rows is carved out of the auto-calculated exchange
	gain/loss row, so the total across all rows still matches the actual
	Paid/Received difference exactly - it's just distributed across
	whichever accounts the user chose instead of all going to one.

	Runs after core's own validate() (via the "validate" doc_event), so it
	has the final say on the deduction amounts before save/submit.
	"""
	exchange_gain_loss_row = next((d for d in doc.get("deductions") if d.is_exchange_gain_loss), None)
	if not exchange_gain_loss_row:
		return

	split_rows = [
		d
		for d in doc.get("deductions")
		if d.custom_split_of_exchange_gain_loss and not d.is_exchange_gain_loss
	]
	if not split_rows:
		return

	split_total = sum(flt(d.amount) for d in split_rows)
	if not split_total:
		return

	precision = doc.precision("amount", "deductions")
	remaining = flt(exchange_gain_loss_row.amount) - split_total

	if flt(remaining, precision) < 0:
		frappe.throw(
			frappe._(
				"The amount split across rows marked {label} ({split_total}) is more than "
				"the total Exchange Gain/Loss ({total}). Reduce the split amount so it does "
				"not exceed the total."
			).format(
				label=frappe.bold("Split of Exchange Gain/Loss"),
				split_total=frappe.format_value(split_total, {"fieldtype": "Currency"}),
				total=frappe.format_value(exchange_gain_loss_row.amount, {"fieldtype": "Currency"}),
			),
			title=frappe._("Split Exceeds Total"),
		)

	exchange_gain_loss_row.amount = flt(remaining, precision)

	# core's set_unallocated_amount() treats any deduction row NOT flagged
	# is_exchange_gain_loss as a genuinely separate deduction, which inflates
	# unallocated_amount (and therefore difference_amount) for our split
	# rows too - they're not extra money, just a reclassification of the
	# same exchange gain/loss. Borrow core's own flag briefly so its own
	# calculation excludes them correctly, then put it back: leaving it set
	# would make set_exchange_gain_loss() delete these rows as "extra"
	# exchange-gain-loss rows on the next save.
	for row in split_rows:
		row.is_exchange_gain_loss = 1
	doc.set_unallocated_amount()
	doc.set_difference_amount()
	for row in split_rows:
		row.is_exchange_gain_loss = 0


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
