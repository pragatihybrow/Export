import frappe


def _resolve_party(account, party_type_hint=None):
	"""
	Given either a Chart of Accounts account name (e.g. "Mahesh Kumar Goenka HUF
	(Loan) - GME") or a bare Supplier/Customer name (as used by the GL report's
	"Party" filter), find the matching Supplier/Customer master and return
	(party_type, party_name).
	"""
	if not account:
		return None, None

	account = account.strip()
	stripped = account.rsplit(" - ", 1)[0].strip()

	# Most accounts are named "Party - CompanyAbbr" (party name is the stripped
	# form), but some parties in this system are set up with the company
	# abbreviation baked into their own name too, so the account name matches
	# the party name exactly. Try both, longest/most-specific first.
	candidates = [account] if account == stripped else [account, stripped]

	party_types = ("Supplier", "Customer")
	if party_type_hint in party_types:
		party_types = (party_type_hint,) + tuple(t for t in party_types if t != party_type_hint)

	for party_name in candidates:
		for party_type in party_types:
			if frappe.db.exists(party_type, party_name):
				return party_type, party_name

	return None, None


@frappe.whitelist()
def get_party_print_details(account, party_type=None):
	"""
	For JS-type Report print formats (templates compile to plain synchronous JS
	with no access to an async server round-trip), resolve the party behind an
	account (or a bare party name, from the report's "Party" filter) and return
	the details they need to render in one call: default address (as HTML, with
	<br> line breaks) and PAN.
	"""
	party_type, party_name = _resolve_party(account, party_type)
	if not party_type:
		return {"address": "", "pan": ""}

	address_name = frappe.db.get_value(
		"Dynamic Link",
		{
			"link_doctype": party_type,
			"link_name": party_name,
			"parenttype": "Address",
		},
		"parent",
	)

	address_html = ""
	if address_name:
		from frappe.contacts.doctype.address.address import get_address_display

		address = frappe.get_doc("Address", address_name).as_dict()
		address_html = (get_address_display(address) or "").strip()

	pan = frappe.db.get_value(party_type, party_name, "pan") or ""

	return {"address": address_html, "pan": pan}
