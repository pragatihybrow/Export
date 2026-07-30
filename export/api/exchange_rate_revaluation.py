import frappe
from frappe import _, qb
from frappe.utils import get_link_to_form, getdate, nowdate


@frappe.whitelist()
def make_reverse_journal_draft(docname, posting_date=None):
	"""
	Create the reversal Journal Entry(s) for an Exchange Rate Revaluation using a
	user-chosen posting date, left as a Draft for review instead of auto-submitting.

	Mirrors the lookup logic in erpnext.accounts.doctype.exchange_rate_revaluation
	.exchange_rate_revaluation.ExchangeRateRevaluation.make_reverse_journal, which
	hardcodes posting_date to today and calls reversal.submit() unconditionally.
	"""
	frappe.has_permission("Journal Entry", "write", throw=True)

	posting_date = getdate(posting_date) if posting_date else getdate(nowdate())

	je = qb.DocType("Journal Entry")
	jea = qb.DocType("Journal Entry Account")
	journals = (
		qb.from_(je)
		.join(jea)
		.on(je.name == jea.parent)
		.select(je.name)
		.distinct()
		.where(
			(jea.reference_type == "Exchange Rate Revaluation")
			& (jea.reference_name == docname)
			& (jea.docstatus == 1)
			& (je.reversal_of.isnull())
		)
		.run(pluck="name")
	)

	if not journals:
		frappe.msgprint(_("No journal entries found to reverse."))
		return []

	from erpnext.accounts.doctype.journal_entry.journal_entry import make_reverse_journal_entry

	created = []
	for x in journals:
		reversal = make_reverse_journal_entry(x)
		reversal.posting_date = posting_date
		reversal.insert(ignore_permissions=True)
		created.append(reversal.name)
		frappe.msgprint(
			_("Reversal journal for {0} has been created as a draft: {1}").format(
				frappe.bold(x), get_link_to_form("Journal Entry", reversal.name)
			)
		)

	return created
