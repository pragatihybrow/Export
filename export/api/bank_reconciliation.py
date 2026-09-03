import frappe
from frappe.utils import flt

from erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool import (
	get_linked_payments as _core_get_linked_payments,
)


@frappe.whitelist()
def get_linked_payments_with_deductions(
	bank_transaction_name,
	document_types=None,
	from_date=None,
	to_date=None,
	filter_by_reference_date=None,
	from_reference_date=None,
	to_reference_date=None,
):
	"""
	Override for erpnext.accounts.doctype.bank_reconciliation_tool
	.bank_reconciliation_tool.get_linked_payments.

	Core computes the "Remaining" amount shown for a Payment Entry candidate from
	base_paid_amount_after_tax, which only ever accounts for the "Advance Taxes
	and Charges" table (see PaymentEntry.set_amounts_after_tax). It never
	subtracts the "Deductions or Loss" table, so any Payment Entry with GST /
	bank-charge amounts entered there (rather than in Advance Taxes and Charges)
	shows an overstated "Remaining" that never matches the actual bank statement
	amount.

	This calls the core function unchanged (so ranking, filters and every other
	document type keep working exactly as before) and only adjusts Payment Entry
	rows afterwards, subtracting each entry's full deductions total from its
	"Remaining" amount. Every deduction row (including ones flagged
	is_exchange_gain_loss) reduces the actual net amount posted to the bank
	account, so all of them are subtracted here - unlike
	PaymentEntry.allocate_amount_to_references, which excludes exchange-gain-loss
	rows for a different purpose (allocating cash against invoice outstanding).
	"""
	vouchers = _core_get_linked_payments(
		bank_transaction_name,
		document_types,
		from_date,
		to_date,
		filter_by_reference_date,
		from_reference_date,
		to_reference_date,
	)

	pe_names = list({v["name"] for v in vouchers if v.get("doctype") == "Payment Entry"})
	if not pe_names:
		return vouchers

	deduction_totals = {}
	for row in frappe.get_all(
		"Payment Entry Deduction",
		filters={"parent": ["in", pe_names]},
		fields=["parent", "amount"],
	):
		deduction_totals[row.parent] = deduction_totals.get(row.parent, 0) + flt(row.amount)

	for voucher in vouchers:
		if voucher.get("doctype") != "Payment Entry":
			continue
		total_deduction = deduction_totals.get(voucher["name"])
		if total_deduction:
			voucher["paid_amount"] = flt(voucher["paid_amount"]) - total_deduction

	return vouchers
