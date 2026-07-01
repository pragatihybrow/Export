import frappe
from frappe.utils import cstr, flt


def round_exchange_gain_loss_amounts(doc, method=None):
	"""
	Core ERPNext skips rounding of debit/credit for Exchange Gain Or Loss
	journal entries (see set_amounts_in_company_currency in
	erpnext/accounts/doctype/journal_entry/journal_entry.py), so the raw
	floating point difference gets written straight to the ledger.
	Re-round here, after core validate() has already run, so these entries
	land on clean 2-decimal values like every other journal entry.
	"""
	if doc.voucher_type != "Exchange Gain Or Loss":
		return

	precision = doc.precision("debit", "accounts")
	for row in doc.accounts:
		row.debit = flt(row.debit, precision)
		row.credit = flt(row.credit, precision)
		row.debit_in_account_currency = flt(row.debit_in_account_currency, precision)
		row.credit_in_account_currency = flt(row.credit_in_account_currency, precision)


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_against_jv(doctype, txt, searchfield, start, page_len, filters):
	if not frappe.db.has_column("Journal Entry", searchfield):
		return []

	return frappe.db.sql(
		f"""
		SELECT jv.name, jv.posting_date, jv.bill_no, jv.user_remark
		FROM `tabJournal Entry` jv, `tabJournal Entry Account` jv_detail
		WHERE jv_detail.parent = jv.name
			AND jv_detail.account = %(account)s
			AND IFNULL(jv_detail.party, '') = %(party)s
			AND (
				jv_detail.reference_type IS NULL
				OR jv_detail.reference_type = ''
			)
			AND jv.docstatus = 1
			AND (
				jv.`{searchfield}` LIKE %(txt)s
				OR jv.bill_no LIKE %(txt)s
			)
		ORDER BY jv.name DESC
		LIMIT %(limit)s OFFSET %(offset)s
		""",
		dict(
			account=filters.get("account"),
			party=cstr(filters.get("party")),
			txt=f"%{txt}%",
			offset=start,
			limit=page_len,
		),
	)
